import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { initVimMode } from 'monaco-vim'
import { sdPrompt, sdDynamicPrompt } from './languages'
import { provider, createDynamicSuggest, addCSV, loadCSV, getCount, addData, clearCSV, getReplaceUnderscore, updateReplaceUnderscore, getLoadedCSV, addLoadedCSV, getEnabledCSV } from './completion'
import { addActionWithCommandOption, addActionWithSubMenu, ActionsPartialDescripter, getMenuId, updateSubMenu, removeSubMenu } from './monaco_utils'
import { MultipleSelectInstance, multipleSelect} from 'multiple-select-vanilla'
// @ts-ignore
import { ContextKeyExpr } from 'monaco-editor/esm/vs/platform/contextkey/common/contextkey'
// @ts-ignore
import { IQuickInputService } from 'monaco-editor/esm/vs/platform/quickinput/common/quickinput'
// @ts-ignore
import { StandaloneThemeService } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneThemeService'
// @ts-ignore
import { StringBuilder } from 'monaco-editor/esm/vs/editor/common/core/stringBuilder'
// @ts-ignore
import { ViewLineOptions } from 'monaco-editor/esm/vs/editor/browser/viewParts/lines/viewLine'
// @ts-ignore
import { RenderLineInput, renderViewLine } from 'monaco-editor/esm/vs/editor/common/viewLayout/viewLineRenderer'
// @ts-ignore
import { EditorFontLigatures } from 'monaco-editor/esm/vs/editor/common/config/editorOptions'
// @ts-ignore
import { InlineDecoration } from 'monaco-editor/esm/vs/editor/common/viewModel'
// @ts-ignore
import { ViewportData } from 'monaco-editor/esm/vs/editor/common/viewLayout/viewLinesViewportData'
// @ts-ignore
import { LineDecoration } from 'monaco-editor/esm/vs/editor/common/viewLayout/lineDecorations'
// @ts-ignore
import { View } from 'monaco-editor/esm/vs/editor/browser/view'
// @ts-ignore
import { SuggestController } from 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController'

// copy from viewModel.ts
const enum InlineDecorationType {
	Regular = 0,
	Before = 1,
	After = 2,
	RegularAffectingLetterSpacing = 3
}

import "multiple-select-vanilla/dist/styles/css/multiple-select.css"


import style from "./styles/index.css"
import { deepEqual } from 'fast-equals'


// define prompt language
const sdLanguages = [
    {id: "sd-prompt", lang: sdPrompt},
    {id: "sd-dynamic-prompt", lang: sdDynamicPrompt}
]
const addLanguages = (languages: typeof sdLanguages) => {
    for (const {id, lang} of languages) {
        monaco.languages.register({id: id})
        monaco.languages.setMonarchTokensProvider(id, lang.language)
        monaco.languages.setLanguageConfiguration(id, lang.conf)
        monaco.languages.registerCompletionItemProvider(id, provider)
    }
}
addLanguages(sdLanguages)

const ContextPrefix = "monacoPromptEditor"
const FontSizePreset = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48]

interface PromptEditorGlobal {
    instances: {[key: number]: PromptEditor}
}

type CodeEditor = monaco.editor.IStandaloneCodeEditor & {
    _themeService: StandaloneThemeService,
    getConfiguration: () => typeof monaco.editor.EditorOptions,
    _modelData: {
        view: View
    },
}

// global settings
const settings: PromptEditorGlobal = {
    instances: {},
}
let id = 0
let currentFocusInstance: number | null = null

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
    fontSize: number,
    fontFamily: string,
    csvToggle: {
        [key: string]: boolean
    },
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
    overflowGuard: HTMLDivElement
    overflowContent: HTMLDivElement
    overflowOverlay: HTMLDivElement
    fontsize: HTMLSelectElement
    autocomplete: MultipleSelectInstance
    autocompleteElement: HTMLLabelElement
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
    monaco: CodeEditor
    theme: string
    showHeader: boolean
    vim: any // monaco-vim instance
    textareaDescriptor: PropertyDescriptor
    textareaDisplay: string
    onChangeShowHeaderCallbacks: Array<() => void>
    onChangeShowHeaderBeforeSyncCallbacks: Array<() => void>
    onChangeShowLineNumbersCallbacks: Array<() => void>
    onChangeShowLineNumbersBeforeSyncCallbacks: Array<() => void>
    onChangeShowMinimapCallbacks: Array<() => void>
    onChangeShowMinimapBeforeSyncCallbacks: Array<() => void>
    onChangeReplaceUnderscoreCallbacks: Array<() => void>
    onChangeReplaceUnderscoreBeforeSyncCallbacks: Array<() => void>
    onChangeThemeCallbacks: Array<() => void>
    onChangeThemeBeforeSyncCallbacks: Array<() => void>
    onChangeModeCallbacks: Array<() => void>
    onChangeModeBeforeSyncCallbacks: Array<() => void>
    onChangeLanguageCallbacks: Array<() => void>
    onChangeLanguageBeforeSyncCallbacks: Array<() => void>
    onChangeFontSizeCallbacks: Array<() => void>
    onChangeFontSizeBeforeSyncCallbacks: Array<() => void>
    onChangeFontFamilyCallbacks: Array<() => void>
    onChangeFontFamilyBeforeSyncCallbacks: Array<() => void>
    onChangeAutoCompleteToggleCallbacks: Array<() => void>
    onChangeAutoCompleteToggleBeforeSyncCallbacks: Array<() => void>
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
        this.onChangeShowHeaderBeforeSyncCallbacks = []
        this.onChangeShowLineNumbersCallbacks = []
        this.onChangeShowLineNumbersBeforeSyncCallbacks = []
        this.onChangeShowMinimapCallbacks = []
        this.onChangeShowMinimapBeforeSyncCallbacks = []
        this.onChangeReplaceUnderscoreCallbacks = []
        this.onChangeReplaceUnderscoreBeforeSyncCallbacks = []
        this.onChangeThemeCallbacks = []
        this.onChangeThemeBeforeSyncCallbacks = []
        this.onChangeModeCallbacks = []
        this.onChangeModeBeforeSyncCallbacks = []
        this.onChangeLanguageCallbacks = []
        this.onChangeLanguageBeforeSyncCallbacks = []
        this.onChangeFontSizeCallbacks = []
        this.onChangeFontSizeBeforeSyncCallbacks = []
        this.onChangeFontFamilyCallbacks = []
        this.onChangeFontFamilyBeforeSyncCallbacks = []
        this.onChangeAutoCompleteToggleCallbacks = []
        this.onChangeAutoCompleteToggleBeforeSyncCallbacks = []

        const editor = this.monaco = monaco.editor.create(monacoElement, {
            value: textarea.value,
            //language: languageId,
            bracketPairColorization: {
                enabled: true,
            },
            automaticLayout: true,
            wordWrap: 'on',
            //fixedOverflowWidgets: true,
        } as any) as CodeEditor
        this.polyfillMonacoEditorConfiguration()

        this.showHeader = true
        this.theme = this.getThemeId()

        this.changeMode(PromptEditorMode.VIM)

        editor.onDidFocusEditorWidget(() => {
            currentFocusInstance = this.getInstanceId()
        })

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

        const overflowGuard = this.elements.main!.querySelector('.overflow-guard')! as HTMLDivElement
        this.elements.overflowGuard = overflowGuard
        const overflowContent = this.elements.main!.querySelector('.overflowingContentWidgets')! as HTMLDivElement
        this.elements.overflowContent = overflowContent
        const overflowOverlay = this.elements.main!.querySelector('.overflowingOverlayWidgets')! as HTMLDivElement
        this.elements.overflowOverlay = overflowOverlay
        this.fixedOverflowWidgetWorkaround([overflowContent, overflowOverlay], options)

        this.updateAutoComplete()
        this.setContextMenu()

        // init context
        this.setSettings(Object.assign({}, this.getSettings(), {
            csvToggle: Object.fromEntries(getEnabledCSV().map(csvName => [this.createContextKey("csv", csvName), true])),
        }), true)

        this.setEventHandler()

        settings.instances[this._id] = this
    }

    getCurrentFocus() {
        if (!settings) {
            return null
        }
        if (!settings.instances) {
            return null
        }
        if (currentFocusInstance === null) {
            return null
        }
        if (!settings.instances[currentFocusInstance]) {
            console.warn("instance not found: ", currentFocusInstance, settings.instances)
            return null
        }

        return settings.instances[currentFocusInstance]
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
    fixedOverflowWidgetWorkaround(elements: HTMLElement[], options: Partial<PromptEditorOptions>) {
        const overflowGuard = this.elements.overflowGuard!
        overflowGuard.style.position = 'absolute'

        for (const overlay of elements) {
            overlay.style.position = 'fixed'
        }

        const scrollbar = overflowGuard.querySelector(".scrollbar.vertical") as HTMLElement
        if (scrollbar) {
            scrollbar.style.zIndex = "6"
        }

        this.setOverlayZIndex(10) // default z-index
        if (typeof(options.overlayZIndex) === "number") {
            this.setOverlayZIndex(options.overlayZIndex)
        }
    }

    createContextKey(...args: string[]) {
        return [ContextPrefix, ...args].join('.')
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
            title: "FontSize",
            context: ["MonacoPromptEditorFontSize", this._id].join("_"),
            group: 'monaco-prompt-editor',
            order: 4,
            actions: FontSizePreset.map(size => {
                return {
                    id: ["fontsize", size].join("_"),
                    label: ""+size,
                    run: () => {
                        this.changeFontSize(size)
                        this.syncFontSize()
                    },
                    commandOptions: {
                        toggled: {
                            condition: ContextKeyExpr.deserialize(`${this.createContextKey("fontSize")} == ${size}`)
                        }
                    }
                }
            })
        })
        this.monaco.addAction({
            id: "fontfamily",
            label: "FontFamily",
            run: () => {
                (this.monaco as any).invokeWithinContext(async (accessor:any) => {
                    const service = accessor.get(IQuickInputService)
                    const inputBox = service.createInputBox()

                    inputBox.placeholder = "input font family"
                    inputBox.value = this.monaco.getOption(monaco.editor.EditorOption.fontFamily)
                    inputBox.onDidAccept(() => {
                        this.changeFontFamily(inputBox.value)
                        this.syncFontFamily()
                        inputBox.dispose()
                    })

                    inputBox.show()
                })
            },
            contextMenuOrder: 5,
            contextMenuGroupId: 'monaco-prompt-editor',
        })

        addActionWithSubMenu(this.monaco, {
            title: "Language",
            context: ["MonacoPromptEditorLanguage", this._id].join("_"),
            group: 'monaco-prompt-editor',
            order: 6,
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
                            condition: ContextKeyExpr.deserialize(`${this.createContextKey("language")} == ${lang.id}`)
                        }
                    }
                }
            })
        })
        addActionWithSubMenu(this.monaco, {
            title: "KeyBindings",
            context: ["MonacoPromptEditorKeyBindings", this._id].join("_"),
            group: 'monaco-prompt-editor',
            order: 7,
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
                            condition: ContextKeyExpr.deserialize(`${this.createContextKey("keybinding")} == ${value}`)
                        }
                    }
                }
            })
        })
        addActionWithSubMenu(this.monaco, {
            title: "Theme",
            context: ["MonacoPromptEditorTheme", this._id].join("_"),
            group: 'monaco-prompt-editor',
            order: 8,
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
                            condition: ContextKeyExpr.deserialize(`${this.createContextKey("theme")} == ${value}`)
                        }
                    }
                }
            })
        })
    }

    createOrUpdateSubMenu(title: string, id: string, group: string, order: number, actions: ActionsPartialDescripter[]) {
        const menuContext = [id, this.getInstanceId()].join("_")
        const subMenu = {
            title: title,
            context: menuContext,
            group: group,
            order: order,
            actions: actions,
        }

        if (!getMenuId(menuContext)) {
            addActionWithSubMenu(this.monaco, subMenu)
        } else {
            // updateSubMenu(this.monaco, subMenu)
        }

        return menuContext
    }

    removeSubMenu(id: string) {
        removeSubMenu(id)
    }

    updateAutoComplete() {
        const csvfiles = getLoadedCSV()

        // context menu
        const order = 9
        this.createOrUpdateSubMenu("Autocomplete", "AutoComplete", "AutoComplete", order, csvfiles.map((filename) => {
            const basename = filename.split(".", 2)[0]
            const contextKey = this.createContextKey("csv", basename)
            return {
                id: ["autocomplete", basename].join("_"),
                label: basename,
                run: () => {
                    const current = this.getContext(contextKey)
                    this.changeAutoCompleteToggle(contextKey, !current, true)
                    this.syncAutoCompleteToggle()
                },
                commandOptions: {
                    toggled: {
                        condition: ContextKeyExpr.equals(contextKey, true)
                        //condition: ContextKeyExpr.deserialize(`${contextKey}`)
                    }
                }
            }
        }))

        this.updateAutoCompleteHeader()
    }

    getCurrentEnableAutoCompleteToggle() {
        return Object.entries(this.getLocalContextValues<boolean>("csv"))
            .filter(([key, value]) => value)
            .map(([key, value]) => key.split(".").pop())
    }

    updateAutoCompleteHeader() {
        const csvfiles = getLoadedCSV()
        const currentSelected = this.getCurrentEnableAutoCompleteToggle()
        let multipleSelectInstance: MultipleSelectInstance

        if (!this.elements.autocomplete) {
            // create
            const labelElement = document.createElement("label")
            const divElement = document.createElement("div")
            const selectElement = document.createElement("select")

            labelElement.textContent = "AutoComplete"
            divElement.appendChild(selectElement)
            divElement.style.display = "inline-block"
            divElement.style.marginLeft = "0.5rem"
            labelElement.appendChild(divElement)

            this.elements.header!.appendChild(labelElement)
            this.elements.autocompleteElement = labelElement

            selectElement.classList.add("multiple-select")

            const multipleSelectInit = (multipleSelectInstance: MultipleSelectInstance) => {
                const parent = multipleSelectInstance.getParentElement()
                const button = parent.querySelector('.ms-choice')!
                button.classList.add(style["ms-choice"])
            }
            
            multipleSelectInstance = multipleSelect(selectElement, {
                filter: true,
                single: false,
                showSearchClear: true,
                data: csvfiles,
                width: "24rem",
                selectAll: false,
                onClick: (view) => {
                    const contextKey = this.createContextKey("csv", view.value)
                    const newValue = (view as any).selected

                    this.changeAutoCompleteToggle(contextKey, newValue, true)
                    this.syncAutoCompleteToggle()
                },
                onAfterCreate: () => {
                    if (!this.elements.autocomplete) {
                        return
                    }
                    multipleSelectInit(this.elements.autocomplete)
                },
            }) as MultipleSelectInstance

            multipleSelectInit(multipleSelectInstance)
            this.elements.autocomplete = multipleSelectInstance
            
        } else {
            // update
            multipleSelectInstance = this.elements.autocomplete

            multipleSelectInstance.refreshOptions({
                data: csvfiles,
            })
        }

        multipleSelectInstance.setSelects(currentSelected)
    }
    updateAutoCompleteHeaderToggle() {
        const multipleSelectInstance = this.elements.autocomplete
        if (!multipleSelectInstance) {
            return
        }
        multipleSelectInstance.setSelects(this.getCurrentEnableAutoCompleteToggle())
    }

    setEventHandler() {
        this.monaco.onDidChangeConfiguration((e) => {
            if (e.hasChanged(monaco.editor.EditorOption.fontSize)) {
                this.changeFontSize(this.monaco.getOption(monaco.editor.EditorOption.fontSize), false)
            }
            if (e.hasChanged(monaco.editor.EditorOption.fontFamily)) {
                this.changeFontFamily(this.monaco.getOption(monaco.editor.EditorOption.fontFamily), false)
            }
        })
    }

    setOverlayZIndex(zIndex: number) {
        if (!this.elements.overflowContent) {
            return
        } else {
            this.elements.overflowContent.style.zIndex = "" + zIndex
        }
        if (!this.elements.overflowOverlay) {
            return
        } else {
            this.elements.overflowOverlay.style.zIndex = "" + (zIndex + 1)
        }
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

    getContextValues() {
        // @ts-ignore
        const contextKeyService = this.monaco._contextKeyService
        const contextValueContainer = contextKeyService.getContextValuesContainer(contextKeyService._myContextId)
        return contextValueContainer.value
    }

    getLocalContextValues<T = unknown>(...args: string[]) {
        const values = this.getContextValues()
        const start = this.createContextKey(...args) + "."
        return Object.fromEntries<T>(Object.entries<T>(values).filter(([key, value]) => key.startsWith(start)))
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

    changeFontSize(size: number, updateEditorOption=true) {
        if (this.elements.fontsize) {
            this.elements.fontsize.value = ""+size
        }

        // avoid update loop
        if (updateEditorOption) {
            this.monaco.updateOptions({
                "fontSize": size
            })
        }
        this.setContext(this.createContextKey("fontSize"), size)

        for (const callback of this.onChangeFontSizeCallbacks) {
            callback()
        }
    }

    changeFontFamily(fontFamily: string, updateEditorOption=true) {
        if (updateEditorOption) {
            this.monaco.updateOptions({
                fontFamily: fontFamily
            })
        }
        this.setContext(this.createContextKey("fontFamily"), fontFamily)

        for (const callback of this.onChangeFontFamilyCallbacks) {
            callback()
        }
    }

    changeAutoCompleteToggle(filename: string, value: boolean, isContextKey = false) {
        const contextKey = isContextKey ? filename : this.createContextKey("csv", filename)

        this.setContext(contextKey, value)
        //this.updateAutoCompleteHeader()
        this.updateAutoCompleteHeaderToggle()

        for (const callback of this.onChangeAutoCompleteToggleCallbacks) {
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

    getInstanceId() {
        return this._id
    }

    setValue(value: string) {
        if (value === void 0) {
            return
        }
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
                title: "Replace Underscore -> Space (AutoComplete)",
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
                label: "FontSize",
                data: this._arrayToObject(FontSizePreset),
                callback: (label: HTMLLabelElement, select: HTMLSelectElement) => {
                    this.elements.fontsize = select
                },
                isSelectedCallback: (dataValue: string) => {
                    return +dataValue === this.monaco.getOption(monaco.editor.EditorOption.fontSize)
                },
                changeCallback: (ev: Event) => {
                    const value = +(ev.target as HTMLSelectElement).value
                    this.changeFontSize(value)
                    this.syncFontSize()
                }
            },
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

        headerElement.addEventListener("contextmenu", (ev: MouseEvent) => {
            ev.stopPropagation()
            ev.preventDefault()
        })

        headerElement.querySelectorAll('header > *').forEach((item) => {
            (item as HTMLElement).style.marginRight = "1rem"
        })
    }

    syncLanguage() {
        if (!this.elements.language) {
            return
        }
        const value = this.elements.language.value
        for (const callback of this.onChangeLanguageBeforeSyncCallbacks) {
            callback()
        }
        runAllInstances((instance) => {
            instance.changeLanguage(value)
        })
    }

    syncKeyBindings() {
        if (!this.elements.keyBindings) {
            return
        }
        const value = this.elements.keyBindings.value as PromptEditorMode
        for (const callback of this.onChangeModeBeforeSyncCallbacks) {
            callback()
        }
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
        for (const callback of this.onChangeThemeBeforeSyncCallbacks) {
            callback()
        }
        runAllInstances((instance) => {
            instance.changeTheme(value)
        })
    }

    syncShowHeader() {
        for (const callback of this.onChangeShowHeaderBeforeSyncCallbacks) {
            callback()
        }
        runAllInstances((instance) => {
            instance.changeShowHeader(this.showHeader)
        })
    }

    syncLineNumbers() {
        if (!this.elements.lineNumbers) {
            return
        }
        const value = this.elements.lineNumbers.checked
        for (const callback of this.onChangeShowLineNumbersBeforeSyncCallbacks) {
            callback()
        }
        runAllInstances((instance) => {
            instance.changeShowLineNumbers(value)
        })
    }

    syncMinimap() {
        if (!this.elements.minimap) {
            return
        }
        const value = this.elements.minimap.checked
        for (const callback of this.onChangeShowMinimapBeforeSyncCallbacks) {
            callback()
        }
        runAllInstances((instance) => {
            instance.changeShowMinimap(value)
        })
    }

    syncReplaceUnderscore() {
        if (!this.elements.replaceUnderscore) {
            return
        }
        const value = this.elements.replaceUnderscore.checked
        for (const callback of this.onChangeReplaceUnderscoreBeforeSyncCallbacks) {
            callback()
        }
        runAllInstances((instance) => {
            instance.changeReplaceUnderscore(value)
        })
    }

    syncFontSize() {
        const value = this.getContext(this.createContextKey("fontSize"))
        for (const callback of this.onChangeFontSizeBeforeSyncCallbacks) {
            callback()
        }
        runAllInstances((instance) => {
            instance.changeFontSize(value)
        })
    }

    syncFontFamily() {
        const value = this.getContext(this.createContextKey("fontFamily"))
        for (const callback of this.onChangeFontFamilyBeforeSyncCallbacks) {
            callback()
        }
        runAllInstances((instance) => {
            instance.changeFontFamily(value)
        })
    }

    updateAutoCompleteToggle() {
        const values = this.getLocalContextValues<boolean>("csv")
        const enables = Object.entries(values).filter(([contextKey, value]) => {
            return value
        }).map(([contextKey, value]) => {
            return contextKey.split('.').slice(-1)[0]
        })

        addLoadedCSV(enables)
    }

    syncAutoCompleteToggle() {
        const values = this.getLocalContextValues<boolean>("csv")

        this.updateAutoCompleteToggle()

        for (const callback of this.onChangeAutoCompleteToggleBeforeSyncCallbacks) {
            callback()
        }

        runAllInstances((instance) => {
            for (const [contextKey, value] of Object.entries(values)) {
                instance.changeAutoCompleteToggle(contextKey, value, true)
            }
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
        getValue?: (value: any) => string,
        multiple: boolean = false,
    ) {
        const labelElement = document.createElement('label')
        Object.assign(labelElement.style, {
            display: "flex",
        })
        const selectElement = document.createElement('select')
        if (multiple) {
            selectElement.multiple = true
            selectElement.size = 1
        }
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

    _arrayToObject<T extends string|number>(array: T[]) {
        const obj: {[key in T]: T} = {} as any
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
            fontSize: this.getContext(this.createContextKey("fontSize")),
            fontFamily: this.getContext(this.createContextKey("fontFamily")),
            csvToggle: this.getLocalContextValues<boolean>("csv"),
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

        if (
            settings.fontSize !== void 0 && (
                force ||
                settings.fontSize !== currentSettings.fontSize
            )
        ) {
            this.changeFontSize(settings.fontSize)
        }

        if (
            settings.fontFamily !== void 0 && (
                force ||
                settings.fontFamily !== currentSettings.fontFamily
            )
        ) {
            this.changeFontFamily(settings.fontFamily)
        }

        if (
            settings.csvToggle !== void 0 && (
                force ||
                !deepEqual(settings.csvToggle, currentSettings.csvToggle)
            )
        ) {
            for (const [contextKey, enabled] of Object.entries(settings.csvToggle)) {
                if (currentSettings.csvToggle[contextKey] !== enabled) {
                    this.changeAutoCompleteToggle(contextKey, enabled, true)
                }
            }
            this.updateAutoCompleteToggle()
        }
    }

    onChangeShowHeader(callback: () => void) {
        this.onChangeShowHeaderCallbacks.push(callback)
    }

    onChangeShowHeaderBeforeSync(callback: () => void) {
        this.onChangeShowHeaderBeforeSyncCallbacks.push(callback)
    }

    onChangeShowLineNumbers(callback: () => void) {
        this.onChangeShowLineNumbersCallbacks.push(callback)
    }

    onChangeShowLineNumbersBeforeSync(callback: () => void) {
        this.onChangeShowLineNumbersBeforeSyncCallbacks.push(callback)
    }

    onChangeShowMinimap(callback: () => void) {
        this.onChangeShowMinimapCallbacks.push(callback)
    }

    onChangeShowMinimapBeforeSync(callback: () => void) {
        this.onChangeShowMinimapBeforeSyncCallbacks.push(callback)
    }

    onChangeReplaceUnderscore(callback: () => void) {
        this.onChangeReplaceUnderscoreCallbacks.push(callback)
    }

    onChangeReplaceUnderscoreBeforeSync(callback: () => void) {
        this.onChangeReplaceUnderscoreBeforeSyncCallbacks.push(callback)
    }

    onChangeTheme(callback: () => void) {
        this.onChangeThemeCallbacks.push(callback)
    }

    onChangeThemeBeforeSync(callback: () => void) {
        this.onChangeThemeBeforeSyncCallbacks.push(callback)
    }

    onChangeMode(callback: () => void) {
        this.onChangeModeCallbacks.push(callback)
    }

    onChangeModeBeforeSync(callback: () => void) {
        this.onChangeModeBeforeSyncCallbacks.push(callback)
    }
    onChangeLanguage(callback: () => void) {
        this.onChangeLanguageCallbacks.push(callback)
    }

    onChangeLanguageBeforeSync(callback: () => void) {
        this.onChangeLanguageBeforeSyncCallbacks.push(callback)
    }

    onChangeFontSize(callback: () => void) {
        this.onChangeFontSizeCallbacks.push(callback)
    }

    onChangeFontSizeBeforeSync(callback: () => void) {
        this.onChangeFontSizeBeforeSyncCallbacks.push(callback)
    }

    onChangeFontFamily(callback: () => void) {
        this.onChangeFontFamilyCallbacks.push(callback)
    }

    onChangeFontFamilyBeforeSync(callback: () => void) {
        this.onChangeFontFamilyBeforeSyncCallbacks.push(callback)
    }

    onChangeAutoCompleteToggle(callback: () => void) {
        this.onChangeAutoCompleteToggleCallbacks.push(callback)
    }

    onChangeAutoCompleteToggleBeforeSync(callback: () => void) {
        this.onChangeAutoCompleteToggleBeforeSyncCallbacks.push(callback)
    }

    onChange(callback: () => void) {
        this.onChangeShowHeader(callback)
        this.onChangeShowLineNumbers(callback)
        this.onChangeShowMinimap(callback)
        this.onChangeReplaceUnderscore(callback)
        this.onChangeTheme(callback)
        this.onChangeMode(callback)
        this.onChangeLanguage(callback)
        this.onChangeFontSize(callback)
        this.onChangeFontFamily(callback)
        this.onChangeAutoCompleteToggle(callback)
    }

    onChangeBeforeSync(callback: () => void) {
        this.onChangeShowHeaderBeforeSync(callback)
        this.onChangeShowLineNumbersBeforeSync(callback)
        this.onChangeShowMinimapBeforeSync(callback)
        this.onChangeReplaceUnderscoreBeforeSync(callback)
        this.onChangeThemeBeforeSync(callback)
        this.onChangeModeBeforeSync(callback)
        this.onChangeLanguageBeforeSync(callback)
        this.onChangeFontSizeBeforeSync(callback)
        this.onChangeFontFamilyBeforeSync(callback)
        this.onChangeAutoCompleteToggleBeforeSync(callback)
    }

    getLinesTable(start: number, active: number, end: number) {
        const lines = this.elements.main!.querySelector('.view-lines')! as HTMLDivElement
        const model = this.monaco.getModel()
        if (!model) {
            throw new Error("Model not found in Monaco Editor")
        }
        const lineCount = Math.min(end, model.getLineCount())
        const container = document.createElement("div")
        const styleContainer = document.createElement("style")
        const table = document.createElement("table")

        container.appendChild(styleContainer)
        styleContainer.textContent = `@scope { ${ this.monaco._themeService._themeCSS } }`

        table.classList.add(style["find-lines-table"], "monaco-editor")

        const options = new ViewLineOptions({ options: this.monaco.getOptions() }, this.getThemeId())
        for (let currentLineNum = Math.max(start, 1); currentLineNum <= lineCount; ++currentLineNum) {
            const trEl = document.createElement("tr")
            const lineNumberContainer = document.createElement("td")
            const lineContentContainer = document.createElement("td")

            lineNumberContainer.textContent = currentLineNum as unknown as string
            lineNumberContainer.classList.add(style["find-line-number"])
            lineContentContainer.classList.add(style["find-line-content"])

            // monaco.editor.colorize* は Decoration の処理をしないため ViewLine を元に自力でHTMLを生成する必要がある
            const lineDecorations = model.getLineDecorations(currentLineNum)

            const view = this.monaco._modelData.view
            const partialViewportData = Object.assign(view._context.viewLayout.getLinesViewportData(), {
                startLineNumber: currentLineNum,
                endLineNumber: currentLineNum+1,
            })
            const viewportData = new ViewportData(view._selections, partialViewportData, view._context.viewLayout.getWhitespaceViewportData(), view._context.viewModel)

            const lineData = viewportData.getViewLineRenderingData(currentLineNum)
            const inlineDecorations = lineDecorations.map(lineDecoration => new InlineDecoration(
                lineDecoration.range,
                lineDecoration.options.inlineClassName,
                lineDecoration.options.inlineClassNameAffectsLetterSpacing ? InlineDecorationType.RegularAffectingLetterSpacing : InlineDecorationType.Regular
            ))
            const lineContent = model.getLineContent(currentLineNum)
            const actualInlineDecorations = LineDecoration.filter(inlineDecorations, currentLineNum, 1, lineContent.length + 1);
            const renderLineInput = new RenderLineInput(
                options.useMonospaceOptimizations,
                options.canUseHalfwidthRightwardsArrow,

                lineContent,

                lineData.continuesWithWrappedLine,
                lineData.isBasicASCII,
                lineData.containsRTL,
                0,
                // ITextModel.tokenization はドキュメントに記載されていない
                // see: https://github.com/microsoft/vscode/blob/12c1d4fb1753aeda4b55de73b8a8ee58c607d780/src/vs/editor/common/model/textModel.ts#L286
                (model as any).tokenization.getLineTokens(currentLineNum),
                actualInlineDecorations,
                lineData.tabSize,
                lineData.startVisibleColumn,
                options.spaceWidth,
                options.middotWidth,
                options.wsmiddotWidth,
                options.stopRenderingLineAfter,
                options.renderWhitespace,
                options.renderControlCharacters,
                options.fontLigatures !== EditorFontLigatures.OFF,
                null
            )

            const sb = new StringBuilder(10000)
            const output = renderViewLine(renderLineInput, sb)

            if (lineContent.length === 0) {
                // 行の内容が空だとheightが小さくなってしまうので空白文字を入れる
                lineContentContainer.innerHTML = "&nbsp;"
            } else {
                lineContentContainer.innerHTML = sb.build()
            }
            trEl.appendChild(lineNumberContainer)
            trEl.appendChild(lineContentContainer)
            table.appendChild(trEl)
        }

        container.appendChild(table)
        return container
    }
    addCustomSuggest(id: string) {
        const context = customSuggestContext[id]
        if (!context) {
            throw new Error(`Custom Suggest Context not found: ${id}`)
        }

        const createSuggest = context.createSuggest
        if (!createSuggest) {
            throw new Error(`create suggest function not found: ${id}`)
        }

        const keybinding = context.keybinding

        const command = this.monaco.addCommand(
            keybinding,
            () => {
                // A1111 で最後のインスタンスで command が実行されてしまうため,
                // thisを使用せず最後にフォーカスしたインスタンスで処理を行う
                const instance = this.getCurrentFocus()
                if (instance === null) {
                    return
                }
                if (instance && instance.mode === PromptEditorMode.VIM && instance.vim && instance.vim.state.keyMap !== "vim-insert") {
                    return
                }
                const languageId = instance.getContext(instance.createContextKey("language"))
                const completionItemProvider = createDynamicSuggest(createSuggest, () => {
                    if (provider) {
                        // snippet に choice が含まれていると即時 dispose で候補がサジェストされなくなる
                        setTimeout(() => {
                            provider.dispose()
                        }, 0)
                    }
                })
                const provider = monaco.languages.registerCompletionItemProvider(languageId, completionItemProvider)
                const suggestController = instance.monaco.getContribution<SuggestController>(SuggestController.ID) as SuggestController
                suggestController.triggerSuggest(new Set([completionItemProvider]))
            }
        )
    }
}
window.customElements.define('prompt-editor', PromptEditor);

const runAllInstances = <T extends PromptEditor = PromptEditor>(callback: (instance: T) => boolean|void) => {
    for (const instanceId of (Object.keys(settings.instances) as unknown as number[]).sort()) {
        if (callback(settings.instances[instanceId] as T)) {
            break
        }
    }
}

const customSuggestContext: {[key: string]: {
    keybinding: number,
    createSuggest: () => Promise<Partial<monaco.languages.CompletionItem>[]>,
}} = {}
const addCustomSuggest = (id: string, keybinding: number, createSuggests: () => Promise<Partial<monaco.languages.CompletionItem>[]>) => {
    customSuggestContext[id] = {
        keybinding: keybinding,
        createSuggest: createSuggests,
    }

    runAllInstances((instance) => {
        instance.addCustomSuggest(id)
    })
}

const updateAutoComplete = () => {
    const files = getLoadedCSV()
    runAllInstances((instance) => {
        instance.updateAutoComplete()
        return
    })
} 

const _loadCSV = (filename: string, csv: string) => {
    const retval = loadCSV.call(this, filename, csv)
    updateAutoComplete()
    return retval
}

const _addCSV = (filename: string, csv: string) => {
    const retval = addCSV.call(this, filename, csv)
    updateAutoComplete()
    return retval
}

const _clearCSV = () => {
    const retval = clearCSV.call(this)
    updateAutoComplete()
    return retval
}

const KeyMod = monaco.KeyMod
const KeyCode = monaco.KeyCode
type CompletionItem = monaco.languages.CompletionItem
const CompletionItemKind = monaco.languages.CompletionItemKind
const CompletionItemInsertTextRule = monaco.languages.CompletionItemInsertTextRule

export {
    PromptEditor,
    getCount,
    _loadCSV as loadCSV,
    _addCSV as addCSV,
    _clearCSV as clearCSV,
    getLoadedCSV,
    addLoadedCSV,
    addData,
    addCustomSuggest,
    addLanguages,
    runAllInstances,
    PromptEditorSettings,
    ContextKeyExpr,
    KeyMod,
    KeyCode,
    CompletionItem,
    CompletionItemKind,
    CompletionItemInsertTextRule,
}