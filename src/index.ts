import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { initVimMode } from 'monaco-vim'
import { sdPrompt, sdDynamicPrompt } from './languages'
import { provider, addCSV, loadCSV, getCount, addData, clearCSV, getReplaceUnderscore, updateReplaceUnderscore } from './completion'
import { addActionWithCommandOption, addActionWithSubMenu } from './monaco_utils'
// @ts-ignore
import { ContextKeyExpr } from 'monaco-editor/esm/vs/platform/contextkey/common/contextkey'

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

const ContextPrefix = "monacoPromptEditor"

interface PromptEditorGlobal {
    instances: {[key: number]: PromptEditor}
}

// global settings
const settings: PromptEditorGlobal = {
    instances: {},
}
let id = 0

interface PromptEditorOptions {
    focus: boolean;
    autoLayout: boolean;
    handleTextAreaValue: boolean;
    overlayZIndex: number;
}

interface PromptEditorSettings {
    minimap: boolean,
    lineNumbers: boolean,
    replaceUnderscore: boolean,
    mode: PromptEditorMode,
    theme: string,
    language: string,
    showHeader: boolean,
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
    overlay: HTMLDivElement
}

interface PromptEditorCheckboxParam {
    label: string
    title?: string
    isEnabledCallback: () => boolean
    callback: (label: HTMLLabelElement, input: HTMLInputElement) => void
    toggleCallback: (ev: Event) => void
}

const PromptEditorMode = {
    NORMAL: 'NORMAL',
    VIM: 'VIM',
}
type PromptEditorMode = typeof PromptEditorMode[keyof typeof PromptEditorMode]

class PromptEditor extends HTMLElement {
    elements: Partial<PromptEditorElements> = {}
    mode: PromptEditorMode = PromptEditorMode.NORMAL
    monaco: monaco.editor.IStandaloneCodeEditor
    theme: string
    showHeader: boolean
    vim: any // monaco-vim instance
    textareaDescriptor: PropertyDescriptor
    textareaDisplay: string
    onChangeShowHeaderCallbacks: Array<() => void>
    onChangeShowLineNumbersCallbacks: Array<() => void>
    onChangeShowMinimapCallbacks: Array<() => void>
    onChangeReplaceUnderscoreCallbacks: Array<() => void>
    onChangeThemeCallbacks: Array<() => void>
    onChangeModeCallbacks: Array<() => void>
    onChangeLanguageCallbacks: Array<() => void>
    _id: number
    
    constructor(textarea: HTMLTextAreaElement, options: Partial<PromptEditorOptions>={}) {
        super()

        this._id = id++
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

        this.onChangeShowHeaderCallbacks = []
        this.onChangeShowLineNumbersCallbacks = []
        this.onChangeShowMinimapCallbacks = []
        this.onChangeReplaceUnderscoreCallbacks = []
        this.onChangeThemeCallbacks = []
        this.onChangeModeCallbacks = []
        this.onChangeLanguageCallbacks = []

        const editor = this.monaco = monaco.editor.create(monacoElement, {
            value: textarea.value,
            //language: languageId,
            bracketPairColorization: {
                enabled: true,
            },
            automaticLayout: true,
            wordWrap: 'on',
            //fixedOverflowWidgets: true,
        } as any)
        this.polyfillMonacoEditorConfiguration()

        this.showHeader = true
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

        const overlay = this.elements.main!.querySelector('.overflowingContentWidgets')! as HTMLDivElement
        this.elements.overlay = overlay
        this.fixedOverflowWidgetWorkaround(options)

        this.setContextMenu()

        // init context
        this.setSettings(this.getSettings(), true)

        settings.instances[this._id] = this
    }

    dispose() {
        if (this.monaco) {
            const model = this.monaco.getModel()
            if (model) {
                model.dispose()
            }
            this.monaco.dispose()
        }
        delete settings.instances[this._id]
    }

    // fixedOverflowWidget相当のworkaroundを行う
    fixedOverflowWidgetWorkaround(options: Partial<PromptEditorOptions>) {
        const overlay = this.elements.overlay!
        const overlayParent = overlay.parentElement!

        overlayParent.removeChild(overlay)
        overlayParent.prepend(overlay)
        overlay.style.position = 'fixed'

        if (typeof(options.overlayZIndex) === "number") {
            this.setOverlayZIndex(options.overlayZIndex)
        }
    }

    createContextKey(key: string) {
        return [ContextPrefix, key].join('.')
    }

    setContextMenu() {
        addActionWithCommandOption(this.monaco, {
            id: 'header',
            label: 'Show Header',
            order: 0,
            groupId: "monaco-prompt-editor",
            run: () => {
                this.changeShowHeader(!this.getContext(this.createContextKey("showHeader")))
                this.syncShowHeader()
            },
            commandOptions: {
                toggled: {
                    condition: ContextKeyExpr.deserialize(this.createContextKey("showHeader"))
                }
            },
        })
        addActionWithCommandOption(this.monaco, {
            id: 'minimap',
            label: 'Show Minimap',
            order: 1,
            groupId: "monaco-prompt-editor",
            run: () => {
                this.changeShowMinimap(!this.getContext(this.createContextKey("minimap")))
                this.syncMinimap()
            },
            commandOptions: {
                toggled: {
                    condition: ContextKeyExpr.deserialize(this.createContextKey("minimap"))
                }
            },
        })
        addActionWithCommandOption(this.monaco, {
            id: 'line_numbers_show',
            label: 'LineNum',
            order: 2,
            groupId: "monaco-prompt-editor",
            run: () => {
                this.changeShowLineNumbers(!this.getContext(this.createContextKey("lineNumbers")))
                this.syncLineNumbers()
            },
            commandOptions: {
                toggled: {
                    condition: ContextKeyExpr.deserialize(this.createContextKey("lineNumbers"))
                }
            },
        })
        addActionWithCommandOption(this.monaco, {
            id: 'underscore_replace',
            label: 'Replace Underscore',
            order: 3,
            groupId: "monaco-prompt-editor",
            run: () => {
                this.changeReplaceUnderscore(!this.getContext(this.createContextKey("replaceUnderscore")))
                this.syncReplaceUnderscore()
            },
            commandOptions: {
                toggled: {
                    condition: ContextKeyExpr.deserialize(this.createContextKey("replaceUnderscore"))
                }
            },
        })
        addActionWithSubMenu(this.monaco, {
            title: "Language",
            context: ["MonacoPromptEditorLanguage", this._id].join("_"),
            group: 'monaco-prompt-editor',
            order: 4,
            actions: monaco.languages.getLanguages().map(lang => {
                return {
                    id: ["language", lang.id].join("_"),
                    label: lang.id,
                    run: () => {
                        this.changeLanguage(lang.id)
                        this.syncLanguage()
                    },
                    commandOptions: {
                        toggled: {
                            condition: ContextKeyExpr.deserialize(`${[ContextPrefix, "language"].join('.')} == ${lang.id}`)
                        }
                    }
                }
            })
        })
        addActionWithSubMenu(this.monaco, {
            title: "KeyBindings",
            context: ["MonacoPromptEditorKeyBindings", this._id].join("_"),
            group: 'monaco-prompt-editor',
            order: 5,
            actions: Object.values(PromptEditorMode).map(value => {
                return {
                    id: ["keybinding", value].join("_"),
                    label: value,
                    run: () => {
                        this.changeMode(value)
                        this.syncKeyBindings()
                    },
                    commandOptions: {
                        toggled: {
                            condition: ContextKeyExpr.deserialize(`${[ContextPrefix, "keybinding"].join('.')} == ${value}`)
                        }
                    }
                }
            })
        })
        addActionWithSubMenu(this.monaco, {
            title: "Theme",
            context: ["MonacoPromptEditorTheme", this._id].join("_"),
            group: 'monaco-prompt-editor',
            order: 6,
            actions: Object.keys(this._mapToObject((this.monaco as any)._themeService._knownThemes)).map(value => {
                return {
                    id: ["theme", value].join("_"),
                    label: value,
                    run: () => {
                        this.changeTheme(value)
                        this.syncTheme()
                    },
                    commandOptions: {
                        toggled: {
                            condition: ContextKeyExpr.deserialize(`${[ContextPrefix, "theme"].join('.')} == ${value}`)
                        }
                    }
                }
            })
        })
    }

    setOverlayZIndex(zIndex: number) {
        if (!this.elements.overlay) {
            return
        }
        this.elements.overlay.style.zIndex = "" + zIndex
    }

    setContext(key:string, value: any) {
        // @ts-ignore
        const contextKeyService = this.monaco._contextKeyService 
        const contextValueContainer = contextKeyService.getContextValuesContainer(contextKeyService._myContextId)
        contextValueContainer.setValue(key, value)
    }

    getContext(key:string) {
        // @ts-ignore
        const contextKeyService = this.monaco._contextKeyService 
        const contextValueContainer = contextKeyService.getContextValuesContainer(contextKeyService._myContextId)
        return contextValueContainer.getValue(key)
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
        this.setContext(this.createContextKey("keybinding"), this.mode)

        if (this.elements.keyBindings) {
            this.elements.keyBindings.value = newMode
        }

        for (const callback of this.onChangeModeCallbacks) {
            callback()
        }
    }

    changeTheme(newThemeId: string) {
        this.theme = newThemeId

        if (this.elements.theme) {
            this.elements.theme.value = newThemeId
        }
        
        (this.monaco as any)._themeService.setTheme(this.theme)
        this.setContext(this.createContextKey("theme"), this.theme)

        for (const callback of this.onChangeThemeCallbacks) {
            callback()
        }
    }

    changeLanguage(languageId: string) {
        if (this.elements.language) {
            this.elements.language.value = languageId
        }

        const model = this.monaco.getModel()
        monaco.editor.setModelLanguage(model!, languageId)
        this.setContext(this.createContextKey("language"), languageId)

        for (const callback of this.onChangeLanguageCallbacks) {
            callback()
        }
    }

    changeShowHeader(show: boolean) {
        this.showHeader = show
        this.setContext(this.createContextKey("showHeader"), show)

        this.toggleHeader()

        for (const callback of this.onChangeShowHeaderCallbacks) {
            callback()
        }
    }

    changeShowLineNumbers(show: boolean) {
        if (this.elements.lineNumbers) {
            this.elements.lineNumbers.checked = show
        }
        this.monaco.updateOptions({
            lineNumbers: show ? 'on' : 'off'
        })
        this.setContext(this.createContextKey("lineNumbers"), show)

        for (const callback of this.onChangeShowLineNumbersCallbacks) {
            callback()
        }
    }

    changeShowMinimap(show: boolean, noCallback: boolean=false) {
        if (this.elements.minimap) {
            this.elements.minimap.checked = show
        }
        this.monaco.updateOptions({
            minimap: {
                enabled: show
            }
        })
        this.setContext(this.createContextKey("minimap"), show)

        for (const callback of this.onChangeShowMinimapCallbacks) {
            callback()
        }
    }

    changeReplaceUnderscore(isReplace: boolean) {
        if (this.elements.replaceUnderscore) {
            this.elements.replaceUnderscore.checked = isReplace
        }
        updateReplaceUnderscore(isReplace)
        this.setContext(this.createContextKey("replaceUnderscore"), isReplace)

        for (const callback of this.onChangeReplaceUnderscoreCallbacks) {
            callback()
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
        runAllInstances((instance) => {
            instance.changeLanguage(value)
        })
    }

    syncKeyBindings() {
        if (!this.elements.keyBindings) {
            return
        }
        const value = this.elements.keyBindings.value as PromptEditorMode
        runAllInstances((instance) => {
            instance.changeMode(value)
        })
        this.monaco.focus()
    }

    syncTheme() {
        if (!this.elements.theme) {
            return
        }
        const value = this.elements.theme.value
        runAllInstances((instance) => {
            instance.changeTheme(value)
        })
    }

    syncShowHeader() {
        runAllInstances((instance) => {
            instance.changeShowHeader(this.showHeader)
        })
    }

    syncLineNumbers() {
        if (!this.elements.lineNumbers) {
            return
        }
        const value = this.elements.lineNumbers.checked
        runAllInstances((instance) => {
            instance.changeShowLineNumbers(value)
        })
    }

    syncMinimap() {
        if (!this.elements.minimap) {
            return
        }
        const value = this.elements.minimap.checked
        runAllInstances((instance) => {
            instance.changeShowMinimap(value)
        })
    }

    syncReplaceUnderscore() {
        if (!this.elements.replaceUnderscore) {
            return
        }
        const value = this.elements.replaceUnderscore.checked
        runAllInstances((instance) => {
            instance.changeReplaceUnderscore(value)
        })
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
        const callback = (mutations: (MutationRecord|IntersectionObserverEntry)[], observer: (MutationObserver|IntersectionObserver)) => {
            const main = this.elements.main
            if (!main) {
                return
            }
            this.toggleHeader()
            //main.style.maxHeight = this.clientHeight + "px"
            if (this.parentElement) {
                main.style.height = this.parentElement.clientHeight + "px"
            }
            this.monaco.layout()
        }
        const mutation = new MutationObserver(callback)
        const intersection = new IntersectionObserver(callback, {
            root: document.documentElement
        })
        mutation.observe(this, {attributes: true, attributeFilter: ["style"]})
        intersection.observe(this)
    }

    toggleHeader() {
        const child = this.elements.header
        const parent = this.elements.inner

        if (!child || !parent) {
            return
        }

        if (!this.showHeader) {
            child.style.display = "none"
            return
        }

        child.style.display = "block"

        const childRect = child.getBoundingClientRect()
        const parentRect  = parent.getBoundingClientRect()

        if (
            childRect.width <= parentRect.width &&
            childRect.height <= parentRect.height &&
            childRect.top >= parentRect.top &&
            childRect.left >= parentRect.left &&
            childRect.bottom <= parentRect.bottom &&
            childRect.right <= parentRect.right
        ) {
            child.style.removeProperty("display")
        } else {
            child.style.display = "none"
        }
    }

    copyStyleToShadow() {
        document.head.querySelectorAll('style').forEach((style) => {
            this.elements.container!.appendChild(style.cloneNode(true))
        })
    }

    getSettings() {
        return {
            minimap: this.elements.minimap?.checked,
            showHeader: this.showHeader,
            lineNumbers: this.elements.lineNumbers?.checked,
            replaceUnderscore: getReplaceUnderscore(),
            language: this.monaco.getModel()!.getLanguageId(),
            theme: this.theme,
            mode: this.mode,
        } as PromptEditorSettings
    }

    setSettings(settings: Partial<PromptEditorSettings>, force=false) {
        const currentSettings = this.getSettings()

        if (
            settings.minimap !== void 0 && (
                force ||
                settings.minimap !== currentSettings.minimap
            )
        ) {
            this.changeShowMinimap(settings.minimap)
        }
        if (
            settings.showHeader !== void 0 && (
                force ||
                settings.showHeader !== currentSettings.showHeader
            )
        ) {
            this.changeShowHeader(settings.showHeader)
        }
        if (
            settings.lineNumbers !== void 0 && (
                force ||
                settings.lineNumbers !== currentSettings.lineNumbers
            )
        ) {
            this.changeShowLineNumbers(settings.lineNumbers)
        }
        if (
            settings.replaceUnderscore !== void 0 && (
                force ||
                settings.replaceUnderscore !== currentSettings.replaceUnderscore
            )
        ) {
            this.changeReplaceUnderscore(settings.replaceUnderscore)
        }
        if (
            settings.language !== void 0 && (
                force ||
                settings.language !== currentSettings.language
            )
        ) {
            this.changeLanguage(settings.language)
        }
        if (
            settings.theme !== void 0 && (
                force ||
                settings.theme !== currentSettings.theme
            )
        ) {
            this.changeTheme(settings.theme)
        }
        if (
            settings.mode !== void 0 && (
                force ||
                settings.mode !== currentSettings.mode
            )
        ) {
            this.changeMode(settings.mode)
        }
    }

    onChangeShowHeader(callback: () => void) {
        this.onChangeShowHeaderCallbacks.push(callback)
    }

    onChangeShowLineNumbers(callback: () => void) {
        this.onChangeShowLineNumbersCallbacks.push(callback)
    }

    onChangeShowMinimap(callback: () => void) {
        this.onChangeShowMinimapCallbacks.push(callback)
    }

    onChangeReplaceUnderscore(callback: () => void) {
        this.onChangeReplaceUnderscoreCallbacks.push(callback)
    }

    onChangeTheme(callback: () => void) {
        this.onChangeThemeCallbacks.push(callback)
    }

    onChangeMode(callback: () => void) {
        this.onChangeModeCallbacks.push(callback)
    }

    onChangeLanguage(callback: () => void) {
        this.onChangeLanguageCallbacks.push(callback)
    }

    onChange(callback: () => void) {
        this.onChangeShowHeader(callback)
        this.onChangeShowLineNumbers(callback)
        this.onChangeShowMinimap(callback)
        this.onChangeReplaceUnderscore(callback)
        this.onChangeTheme(callback)
        this.onChangeMode(callback)
        this.onChangeLanguage(callback)
    }
}
window.customElements.define('prompt-editor', PromptEditor);

const runAllInstances = (callback: (instance: PromptEditor) => boolean|void) => {
    for (const instanceId of (Object.keys(settings.instances) as unknown as number[]).sort()) {
        if (callback(settings.instances[instanceId])) {
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