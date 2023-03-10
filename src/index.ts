import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { initVimMode } from 'monaco-vim'
import { sdPrompt, sdDynamicPrompt } from './languages'
import { provider, addCSV, loadCSV, getCount, addData, clearCSV, getReplaceUnderscore, updateReplaceUnderscore } from './completion'
import style from "./styles/index.css"

// define prompt language
for (const {id, lang} of [
    {id: "sd-prompt", lang: sdPrompt},
    {id: "sd-dynamic-prompt", lang: sdDynamicPrompt}
]) {
    monaco.languages.register({id: id})
    monaco.languages.setMonarchTokensProvider(id, lang.language)
    monaco.languages.setLanguageConfiguration(id, lang.conf)
    monaco.languages.registerCompletionItemProvider(id, provider)
}

interface PromptEditorGlobal {
    instances: PromptEditor[]
}

// global settings
const settings: PromptEditorGlobal = {
    instances: [],
}

interface PromptEditorOptions {
    focus: boolean;
    autoLayout: boolean;
    handleTextAreaValue: boolean;
}

interface PromptEditorSettings {
    minimap: boolean,
    lineNumbers: boolean,
    replaceUnderscore: boolean,
    mode: PromptEditorMode,
    theme: string,
    language: string,
}

interface PromptEditorElements {
    container: ShadowRoot
    header: HTMLElement
    main: HTMLElement
    footer: HTMLElement
    inner: HTMLDivElement
    monaco: HTMLDivElement
    language: HTMLSelectElement
    theme: HTMLSelectElement
    keyBindings: HTMLSelectElement
    status: HTMLDivElement
    lineNumbers: HTMLInputElement
    minimap: HTMLInputElement
    replaceUnderscore: HTMLInputElement
}

interface PromptEditorCheckboxParam {
    label: string
    title?: string
    isEnabledCallback: () => boolean
    callback: (label: HTMLLabelElement, input: HTMLInputElement) => void
    toggleCallback: (ev: Event) => void
}

enum PromptEditorMode {
    NORMAL = 'NORMAL',
    VIM = 'VIM',
}

class PromptEditor extends HTMLElement {
    elements: Partial<PromptEditorElements> = {}
    mode: PromptEditorMode = PromptEditorMode.NORMAL
    monaco: monaco.editor.IStandaloneCodeEditor
    theme: string
    vim: any // monaco-vim instance
    textareaDescriptor: PropertyDescriptor
    textareaDisplay: string
    onChangeShowLineNumbersCallback?: () => void
    onChangeShowMinimapCallback?: () => void
    onChangeReplaceUnderscoreCallback?: () => void
    onChangeThemeCallback?: () => void
    onChangeModeCallback?: () => void
    onChangeLanguageCallback?: () => void
    
    constructor(textarea: HTMLTextAreaElement, options: Partial<PromptEditorOptions>={}) {
        super()

        this.textareaDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value')!

        const container = this.elements.container = this.attachShadow({mode: 'open'})
        const headerElement = this.elements.header = document.createElement('header')
        const mainElement= this.elements.main = document.createElement('main')
        const footerElement = this.elements.footer = document.createElement('footer')
        const innerElement = this.elements.inner = document.createElement('div')
        const monacoElement= this.elements.monaco = document.createElement('div')
        const statusElement = this.elements.status = document.createElement('div')

        mainElement.appendChild(monacoElement)
        footerElement.appendChild(statusElement)

        innerElement.appendChild(headerElement)
        innerElement.appendChild(mainElement)
        innerElement.appendChild(footerElement)

        container.appendChild(innerElement)

        innerElement.classList.add(style.inner)
        mainElement.classList.add(style.main)
        headerElement.classList.add(style.header)
        footerElement.classList.add(style.footer)
        monacoElement.classList.add(style.monaco)
        statusElement.classList.add(style.status)

        const editor = this.monaco = monaco.editor.create(monacoElement, {
            value: textarea.value,
            //language: languageId,
            bracketPairColorization: {
                enabled: true,
            },
            automaticLayout: true,
            wordWrap: 'on',
        } as any)
        this.polyfillMonacoEditorConfiguration()

        this.theme = this.getThemeId()

        this.changeMode(PromptEditorMode.VIM)

        if (options.focus) {
            editor.focus()
        }

        editor.getModel()?.onDidChangeContent((e) => {
            this.textareaDescriptor.set?.call(textarea, this.monaco.getValue())

            // fire fake input event
            const input = new InputEvent('input')
            Object.defineProperty(input, 'target', {writable: false, value: textarea})
            textarea.dispatchEvent(input)
        })
    
        if (options.handleTextAreaValue) {
            this.hookTextAreaElement(textarea)
        }

        this.initHeader()
        if (options.autoLayout) {
            this.handleResize()
        }
        this.copyStyleToShadow()

        this.textareaDisplay = textarea.style.display
        textarea.style.display = 'none'

        settings.instances.push(this)
    }

    changeMode(newMode: PromptEditorMode) {
        if (this.mode === newMode) {
            return
        }

        // From VIM
        if (this.mode === PromptEditorMode.VIM) {
            this.vim.dispose()
            this.vim = null
        }
        // To VIM
        if (newMode === PromptEditorMode.VIM) {
            this.vim = initVimMode(this.monaco, this.elements.status!)
        }

        this.mode = newMode

        if (this.elements.keyBindings) {
            this.elements.keyBindings.value = newMode
        }

        if (this.onChangeModeCallback) {
            this.onChangeModeCallback()
        }
    }

    changeTheme(newThemeId: string) {
        this.theme = newThemeId

        if (this.elements.theme) {
            this.elements.theme.value = newThemeId
        }
        
        (this.monaco as any)._themeService.setTheme(this.theme)
        if (this.onChangeThemeCallback) {
            this.onChangeThemeCallback()
        }
    }

    changeLanguage(languageId: string) {
        if (this.elements.language) {
            this.elements.language.value = languageId
        }

        const model = this.monaco.getModel()
        monaco.editor.setModelLanguage(model!, languageId)
        if (this.onChangeLanguageCallback) {
            this.onChangeLanguageCallback()
        }
    }

    changeShowLineNumbers(show: boolean) {
        if (this.elements.lineNumbers) {
            this.elements.lineNumbers.checked = show
        }
        this.monaco.updateOptions({
            lineNumbers: show ? 'on' : 'off'
        })
        if (this.onChangeShowLineNumbersCallback) {
            this.onChangeShowLineNumbersCallback()
        }
    }

    changeShowMinimap(show: boolean) {
        if (this.elements.minimap) {
            this.elements.minimap.checked = show
        }
        this.monaco.updateOptions({
            minimap: {
                enabled: show
            }
        })
        if (this.onChangeShowMinimapCallback) {
            this.onChangeShowMinimapCallback()
        }
    }

    changeReplaceUnderscore(isReplace: boolean) {
        if (this.elements.replaceUnderscore) {
            this.elements.replaceUnderscore.checked = isReplace
        }
        updateReplaceUnderscore(isReplace)
        if (this.onChangeReplaceUnderscoreCallback) {
            this.onChangeReplaceUnderscoreCallback()
        }
    }

    polyfillMonacoEditorConfiguration() {
        if (typeof (this.monaco as any)["getConfiguration"] === 'function') {
            return
        }
        (this.monaco as any)["getConfiguration"] = () => {
            const configuration: any = {}

            for (const [name, option] of Object.entries(monaco.editor.EditorOptions)) {
                const value = this.monaco.getOption(option.id)
                configuration[name] = value
                if (name === 'cursorWidth') {
                    configuration["viewInfo"] ||= {}
                    configuration["viewInfo"][name] = value
                }
            }
            return configuration
        }
    }

    getThemeId() {
        return (this.monaco as any)._themeService._theme.id
    }

    setValue(value: string) {
        if (value === this.monaco.getValue()) {
            return
        }
        const pos = this.monaco.getPosition()!
        this.monaco.setValue(value)
        this.monaco.setPosition(pos)
    }

    hookTextAreaElement(textarea: HTMLTextAreaElement) {
        const promptEditor = this

        const defaultDescriptor = this.textareaDescriptor
        Object.defineProperty(textarea, 'value', {
            set: function(val) {
                promptEditor.setValue(val)
                return defaultDescriptor.set!.call(this, val)
            },
            get: defaultDescriptor.get,
        })
    }

    initHeader() {
        const headerElement = this.elements.header!

        // Monaco Options
        for (const {label, title, callback, isEnabledCallback, toggleCallback} of [
            {
                label: "Minimap",
                callback: (label: HTMLLabelElement, checkbox: HTMLInputElement) => {
                    this.elements.minimap = checkbox
                },
                isEnabledCallback: () => this.monaco.getOption(monaco.editor.EditorOption.minimap).enabled,
                toggleCallback: (ev: Event) => {
                    this.syncMinimap()
                }
            },
            {
                label: "LineNum",
                callback: (label: HTMLLabelElement, checkbox: HTMLInputElement) => {
                    this.elements.lineNumbers = checkbox
                },
                isEnabledCallback: () => {
                    return this.monaco.getOption(monaco.editor.EditorOption.lineNumbers).renderType !== monaco.editor.RenderLineNumbersType.Off
                },
                toggleCallback: (ev: Event) => {
                    this.syncLineNumbers()
                }
            },
            {
                label: "Underscore",
                title: "Replace Underscore -> Space (Completion)",
                callback: (label: HTMLLabelElement, checkbox: HTMLInputElement) => {
                    this.elements.replaceUnderscore = checkbox
                },
                isEnabledCallback: () => {
                    return getReplaceUnderscore()
                },
                toggleCallback: (ev: Event) => {
                    this.syncReplaceUnderscore()
                }
            },
        ] as PromptEditorCheckboxParam[]) {
            headerElement.appendChild(this.createCheckbox(label, callback, isEnabledCallback, toggleCallback, title))
        }

        for (const {label, data, callback, isSelectedCallback, changeCallback, getValue} of [
            {
                label: "Language",
                data: this._arrayToObject(monaco.languages.getLanguages().map(lang => lang.id)),
                callback: (label: HTMLLabelElement, select: HTMLSelectElement) => {
                    this.elements.language = select
                },
                isSelectedCallback: (dataValue: string) => {
                    return dataValue === this.monaco.getModel()!.getLanguageId()
                },
                changeCallback: (ev: Event) => {
                    const value = (ev.target as HTMLSelectElement).value
                    this.syncLanguage()
                    //this.changeLanguage(value)
                }
            },
            {
                label: "KeyBindings",
                data: PromptEditorMode,
                callback: (label: HTMLLabelElement, select: HTMLSelectElement) => {
                    this.elements.keyBindings = select
                },
                isSelectedCallback: (dataValue: PromptEditorMode) => {
                    return dataValue === this.mode
                },
                changeCallback: (ev: Event) => {
                    const value = (ev.target as HTMLSelectElement).value as PromptEditorMode
                    this.syncKeyBindings()
                }
            },
            {
                label: "Theme",
                data: this._mapToObject((this.monaco as any)._themeService._knownThemes),
                callback: (label: HTMLLabelElement, select: HTMLSelectElement) => {
                    this.elements.theme = select
                },
                isSelectedCallback: (dataValue: monaco.editor.ThemeColor) => {
                    return dataValue.id === this.theme
                },
                changeCallback: (ev: Event) => {
                    const value = (ev.target as HTMLSelectElement).value as PromptEditorMode
                    if (this.getThemeId() !== value) {
                        this.syncTheme()
                    }
                },
                getValue: (value: any) => {
                    return value.id
                }
            },
        ]) {
            headerElement.appendChild(this.createSelect(
                label, data, callback, isSelectedCallback, changeCallback, getValue
            ))
        }

        headerElement.querySelectorAll('header > *').forEach((item) => {
            (item as HTMLElement).style.marginRight = "1rem"
        })
    }

    syncLanguage() {
        if (!this.elements.language) {
            return
        }
        const value = this.elements.language.value
        for (const instance of settings.instances) {
            instance.changeLanguage(value)
        }
    }

    syncKeyBindings() {
        if (!this.elements.keyBindings) {
            return
        }
        const value = this.elements.keyBindings.value as PromptEditorMode
        for (const instance of settings.instances) {
            instance.changeMode(value)
        }
        this.monaco.focus()
    }

    syncTheme() {
        if (!this.elements.theme) {
            return
        }
        const value = this.elements.theme.value
        for (const instance of settings.instances) {
            instance.changeTheme(value)
        }
    }

    syncLineNumbers() {
        if (!this.elements.lineNumbers) {
            return
        }
        const value = this.elements.lineNumbers.checked
        for (const instance of settings.instances) {
            instance.changeShowLineNumbers(value)
        }
    }

    syncMinimap() {
        if (!this.elements.minimap) {
            return
        }
        const value = this.elements.minimap.checked
        for (const instance of settings.instances) {
            instance.changeShowMinimap(value)
        }
    }

    syncReplaceUnderscore() {
        if (!this.elements.replaceUnderscore) {
            return
        }
        const value = this.elements.replaceUnderscore.checked
        for (const instance of settings.instances) {
            instance.changeReplaceUnderscore(value)
        }
    }

    createCheckbox(
        labelText: string,
        callback: (label: HTMLLabelElement, input: HTMLInputElement) => void,
        isEnabledCallback: () => boolean,
        toggleCallback: (ev: Event) => void,
        title?: string,
    ) {
        const label = document.createElement('label')
        const input = document.createElement('input')

        Object.assign(label.style, {
            display: "flex",
        })

        input.checked = isEnabledCallback()
        input.type = 'checkbox'
        input.addEventListener('change', toggleCallback)

        label.textContent = labelText
        label.prepend(input)
        if (title) {
            label.title = title
        }

        callback(label, input)

        return label
    }

    createSelect(
        labelText: string,
        data: object,
        callback: (label: HTMLLabelElement, select: HTMLSelectElement) => void,
        isSelectedCallback: (dataValue: any) => boolean,
        changeCallback: (ev: Event) => void,
        getValue?: (value: any) => string
    ) {
        const labelElement = document.createElement('label')
        Object.assign(labelElement.style, {
            display: "flex",
        })
        const selectElement = document.createElement('select')
        Object.assign(selectElement.style, {
            marginLeft: "0.5rem",
        })
        for (const [key, value] of Object.entries(data)){
            const option = document.createElement('option')
            option.textContent = key
            option.value = typeof getValue === 'function' ? getValue(value) :  value

            if (isSelectedCallback(value)) {
                option.selected = true
            }
            selectElement.appendChild(option)
        }
        selectElement.addEventListener('change', changeCallback)
        labelElement.textContent = labelText
        labelElement.appendChild(selectElement)

        callback(labelElement, selectElement)
        return labelElement
    }

    _mapToObject(map: Map<string, any>) {
        const obj: {[key: string]: any} = {}
        map.forEach((value, key) => {
            obj[key] = value
        })
        return obj
    }

    _arrayToObject(array: string[]) {
        const obj: {[key: string]: string} = {}
        array.forEach((value) => {
            obj[value] = value
        })
        return obj
    }

    handleResize() {
        const observer = new MutationObserver((mutations, observer) => {
            this.monaco.layout()
        })
        observer.observe(this.elements.container!, {attributes: true, attributeFilter: ["style"]})
    }

    copyStyleToShadow() {
        document.head.querySelectorAll('style').forEach((style) => {
            this.elements.container!.appendChild(style.cloneNode(true))
        })
    }

    getSettings() {
        return {
            minimap: this.elements.minimap?.checked,
            lineNumbers: this.elements.lineNumbers?.checked,
            replaceUnderscore: getReplaceUnderscore(),
            language: this.monaco.getModel()!.getLanguageId(),
            theme: this.theme,
            mode: this.mode,
        } as PromptEditorSettings
    }

    setSettings(settings: PromptEditorSettings) {
        if (settings.minimap !== void 0) {
            this.changeShowMinimap(settings.minimap)
        }
        if (settings.lineNumbers !== void 0) {
            this.changeShowLineNumbers(settings.lineNumbers)
        }
        if (settings.replaceUnderscore!== void 0) {
            this.changeReplaceUnderscore(settings.replaceUnderscore)
        }
        this.changeLanguage(settings.language)
        this.changeTheme(settings.theme)
        this.changeMode(settings.mode)
    }

    onChangeShowLineNumbers(callback: () => void) {
        this.onChangeShowLineNumbersCallback = callback
    }

    onChangeShowMinimap(callback: () => void) {
        this.onChangeShowMinimapCallback = callback
    }

    onChangeReplaceUnderscore(callback: () => void) {
        this.onChangeReplaceUnderscoreCallback = callback
    }


    onChangeTheme(callback: () => void) {
        this.onChangeThemeCallback = callback
    }

    onChangeMode(callback: () => void) {
        this.onChangeModeCallback = callback
    }

    onChangeLanguage(callback: () => void) {
        this.onChangeLanguageCallback = callback
    }
}
window.customElements.define('prompt-editor', PromptEditor);

const runAllInstances = (callback: (instance: PromptEditor) => boolean|void) => {
    for (const instance of settings.instances) {
        if (callback(instance)) {
            break
        }
    }
}

export {
    PromptEditor,
    getCount,
    loadCSV,
    addCSV,
    addData,
    clearCSV,
    runAllInstances,
    PromptEditorSettings,
}