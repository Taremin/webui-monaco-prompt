import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { initVimMode } from 'monaco-vim'
import { sdPrompt, sdDynamicPrompt } from './languages'
import { baseConf, baseLanguage } from './languages/sd-prompt'
import { allFeatures, getFeature, LanguageFeatureToggle } from './languages/features'
import { composeLanguage } from './languages/composer'
import { builtinPresets, getAllPresets, getPreset, addUserPreset, removeUserPreset, loadUserPresets, getUserPresets, LanguagePreset } from './languages/presets'
import { PresetDialog } from './preset_dialog'
import { provider, createDynamicSuggest, addCSV, loadCSV, getCount, addData, clearCSV, getReplaceUnderscore, updateReplaceUnderscore, getLoadedCSV, addLoadedCSV, getEnabledCSV } from './completion'
import { addActionWithCommandOption, addActionWithSubMenu, ActionsPartialDescripter, getMenuId, updateSubMenu, removeSubMenu } from './monaco_utils'
import { MultipleSelectInstance, multipleSelect} from 'multiple-select-vanilla'
import * as utils from './utils'
import { PromptEditorManager } from './PromptEditorManager'
// @ts-ignore
import { ContextKeyExpr } from 'monaco-editor/esm/vs/platform/contextkey/common/contextkey'
// @ts-ignore
import { IQuickInputService } from 'monaco-editor/esm/vs/platform/quickinput/common/quickInput'
// @ts-ignore
import { StandaloneThemeService } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneThemeService'
// @ts-ignore
import { StringBuilder } from 'monaco-editor/esm/vs/editor/common/core/stringBuilder'
// @ts-ignore
import { ViewLineOptions } from 'monaco-editor/esm/vs/editor/browser/viewParts/viewLines/viewLineOptions'
// @ts-ignore
import { RenderLineInput, renderViewLine } from 'monaco-editor/esm/vs/editor/common/viewLayout/viewLineRenderer'
// @ts-ignore
import { EditorFontLigatures } from 'monaco-editor/esm/vs/editor/common/config/editorOptions'
// @ts-ignore
import { InlineDecoration } from 'monaco-editor/esm/vs/editor/common/viewModel/inlineDecorations'
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


const sdLanguages = [
    {id: "sd-prompt", lang: sdPrompt},
    {id: "sd-dynamic-prompt", lang: sdDynamicPrompt},
    {id: "composed-prompt", lang: { conf: baseConf, language: baseLanguage }} // Initial state
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

/**
 * Rebuild global language definition.
 * (Deprecated: Use PromptEditorManager.getGroup().rebuildLanguage() instead)
 */
function rebuildGlobalLanguage() {
    PromptEditorManager.getGroup().rebuildLanguage()
}

interface PromptEditorOptions {
    focus?: boolean
    mode?: PromptEditorMode
    autoLayout?: boolean
    handleTextAreaValue?: boolean
    groupId?: string
    overlayZIndex?: number
}

interface PromptEditorSettings {
    minimap: boolean,
    lineNumbers: boolean,
    replaceUnderscore: boolean,
    mode: PromptEditorMode,
    theme: string,
    language: string,
    languageFeatures: LanguageFeatureToggle,
    languagePreset: string,
    showHeader: boolean,
    fontSize: number,
    fontFamily: string,
    csvToggle: {
        [key: string]: boolean
    },
    userPresets: LanguagePreset[],
}

interface PromptEditorElements {
    container: ShadowRoot
    header: HTMLElement
    main: HTMLElement
    footer: HTMLElement
    inner: HTMLDivElement
    monaco: HTMLDivElement
    language: HTMLSelectElement
    preset: HTMLSelectElement
    featureToggles: Record<string, HTMLInputElement>
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
    textarea!: HTMLTextAreaElement
    elements: Partial<PromptEditorElements> = {}
    mode: PromptEditorMode = PromptEditorMode.NORMAL
    monaco!: CodeEditor
    theme!: string
    showHeader: boolean = false
    vim: any // monaco-vim instance
    languageFeatures: LanguageFeatureToggle = {}
    currentPreset: string = 'comfy-dynamic-prompt'
    textareaDescriptor!: PropertyDescriptor
    textareaDisplay!: string
    options!: Partial<PromptEditorOptions>
    private _initialized: boolean = false
    
    onChangeShowHeaderCallbacks!: Array<() => void>
    onChangeShowHeaderBeforeSyncCallbacks!: Array<() => void>
    onChangeShowLineNumbersCallbacks!: Array<() => void>
    onChangeShowLineNumbersBeforeSyncCallbacks!: Array<() => void>
    onChangeShowMinimapCallbacks!: Array<() => void>
    onChangeShowMinimapBeforeSyncCallbacks!: Array<() => void>
    onChangeReplaceUnderscoreCallbacks!: Array<() => void>
    onChangeReplaceUnderscoreBeforeSyncCallbacks!: Array<() => void>
    onChangeThemeCallbacks!: Array<() => void>
    onChangeThemeBeforeSyncCallbacks!: Array<() => void>
    onChangeModeCallbacks!: Array<() => void>
    onChangeModeBeforeSyncCallbacks!: Array<() => void>
    onChangeLanguageCallbacks!: Array<() => void>
    onChangeLanguageBeforeSyncCallbacks!: Array<() => void>
    onChangeLanguagePresetCallbacks!: Array<() => void>
    onChangeLanguagePresetBeforeSyncCallbacks!: Array<() => void>
    onChangeLanguageFeaturesCallbacks!: Array<() => void>
    onChangeLanguageFeaturesBeforeSyncCallbacks!: Array<() => void>
    onChangeFontSizeCallbacks!: Array<() => void>
    onChangeFontSizeBeforeSyncCallbacks!: Array<() => void>
    onChangeFontFamilyCallbacks!: Array<() => void>
    onChangeFontFamilyBeforeSyncCallbacks!: Array<() => void>
    onChangeLanguageUserPresetsCallbacks!: Array<() => void>
    onChangeLanguageUserPresetsBeforeSyncCallbacks!: Array<() => void>
    onChangeAutoCompleteToggleCallbacks!: Array<() => void>
    onChangeAutoCompleteToggleBeforeSyncCallbacks!: Array<() => void>
    
    onOpenPresetDialog?: (instance: PromptEditor) => void
    onSettingChange?: (settings: Partial<PromptEditorSettings>, force?: boolean) => void
    _id: number
    groupId: string = "default"
    getTemplateFiles?: () => string[]
    
    constructor(textarea?: HTMLTextAreaElement, options: Partial<PromptEditorOptions>={}) {
        super()
        this._id = id++
        this.options = options
        this.groupId = options.groupId || "default"

        const container = this.elements.container = this.attachShadow({mode: 'open'})

        // 基本スタイルの注入
        const styleElement = document.createElement('style')
        styleElement.textContent = `
            :host { display: block; width: 100%; height: 100%; position: relative; min-height: 50px; }
            main { flex-grow: 1; display: block; position: relative; width: 100%; height: 100%; }
        `
        container.appendChild(styleElement)
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

        this.initCallbacks()

        this.monaco = monaco.editor.create(monacoElement, {
            value: textarea ? textarea.value : "",
            bracketPairColorization: {
                enabled: true,
            },
            automaticLayout: true,
            wordWrap: 'on',
        } as any) as CodeEditor

        this.monaco.onDidFocusEditorWidget(() => {
            currentFocusInstance = this.getInstanceId()
        })

        if (options.focus) {
            this.monaco.focus()
        }

        this.initHeader()
        this.copyStyleToShadow()
        this.polyfillMonacoEditorConfiguration()
        this.showHeader = false
        this.updateHeaderVisibility()
        this.theme = this.getThemeId()

        settings.instances[this._id] = this
        PromptEditorManager.getGroup(this.groupId).register(this)

        // 初回設定の適用
        const managerSettings = PromptEditorManager.getGroup(this.groupId).getSettings()
        const initialCsvToggle = Object.fromEntries(getEnabledCSV().map(csvName => [this.createContextKey("csv", csvName), true]))
        const combinedSettings = Object.assign({}, managerSettings, {
            csvToggle: Object.assign({}, initialCsvToggle, managerSettings.csvToggle || {})
        })
        this.applySettings(combinedSettings)

        if (textarea) {
            this.init(textarea)
        }

        // 1. 要素がDOMツリーにアタッチ（appendChild等）され、実際のサイズが確定するのを待つため（handleResize用）。
        // 2. Monaco Editorが内部的に生成するDOM要素（.overflow-guard等）がアクセス可能になるのを待つため。
        // 3. multiple-select-vanilla等のUIコンポーネントが、正しいレイアウト（親要素のサイズ確定後）で初期化されるようにするため。
        setTimeout(() => {
            this.initializeLayoutWorkarounds(options)
            this.updateAutoComplete()
            this.setContextMenu()
            this.setEventHandler()
        }, 0)
    }

    init(textarea: HTMLTextAreaElement) {
        this.textarea = textarea
        this.textareaDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value')!
        this.textareaDisplay = textarea.style.display
        textarea.style.display = 'none'

        if (this.options.handleTextAreaValue) {
            this.hookTextAreaElement(textarea)
        }

        this.monaco.getModel()?.onDidChangeContent((e) => {
            this.textareaDescriptor.set?.call(this.textarea, this.monaco.getValue())
            const input = new InputEvent('input')
            Object.defineProperty(input, 'target', {writable: false, value: this.textarea})
            this.textarea.dispatchEvent(input)
        })

        if (this.monaco.getValue() !== textarea.value) {
            this.monaco.setValue(textarea.value)
        }
    }

    private initializeLayoutWorkarounds(options: Partial<PromptEditorOptions>) {
        if (options.autoLayout) {
            this.handleResize()
        }
        // Monaco の DOM 構造に依存する処理は、防御的に実行
        try {
            const overflowGuard = this.elements.main!.querySelector('.overflow-guard') as HTMLDivElement
            if (overflowGuard) {
                this.elements.overflowGuard = overflowGuard
                const overflowContent = this.elements.main!.querySelector('.overflowingContentWidgets') as HTMLDivElement
                if (overflowContent) {
                    this.elements.overflowContent = overflowContent
                }
                const overflowOverlay = this.elements.main!.querySelector('.overflowingOverlayWidgets') as HTMLDivElement
                if (overflowOverlay) {
                    this.elements.overflowOverlay = overflowOverlay
                }
                if (this.elements.overflowContent && this.elements.overflowOverlay) {
                    this.fixedOverflowWidgetWorkaround([this.elements.overflowContent, this.elements.overflowOverlay], options)
                }
            }
        } catch (e) {
            console.warn("Failed to apply layout workarounds:", e)
        }
    }

    connectedCallback() {
        // HTMLElement のインターフェースとして残すが、初期化は constructor 内の非同期処理で完結
    }

    private initCallbacks() {
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
        this.onChangeLanguagePresetCallbacks = []
        this.onChangeLanguagePresetBeforeSyncCallbacks = []
        this.onChangeLanguageFeaturesCallbacks = []
        this.onChangeLanguageFeaturesBeforeSyncCallbacks = []
        this.onChangeFontSizeCallbacks = []
        this.onChangeFontSizeBeforeSyncCallbacks = []
        this.onChangeFontFamilyCallbacks = []
        this.onChangeFontFamilyBeforeSyncCallbacks = []
        this.onChangeLanguageUserPresetsCallbacks = []
        this.onChangeLanguageUserPresetsBeforeSyncCallbacks = []
        this.onChangeAutoCompleteToggleCallbacks = []
        this.onChangeAutoCompleteToggleBeforeSyncCallbacks = []
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

    restore() {
        if (this.textarea) {
            this.textarea.style.display = this.textareaDisplay;
            delete this.textarea.dataset.webuiMonacoPromptTextareaId;
            Object.defineProperty(this.textarea, 'value', this.textareaDescriptor)
        }
    }

    dispose() {
        this.restore()
        if (this.monaco) {
            const model = this.monaco.getModel()
            if (model) {
                model.dispose()
            }
            this.monaco.dispose()
        }
        delete settings.instances[this._id]
        // マネージャーからも登録解除
        PromptEditorManager.getGroup(this.groupId).unregister(this);
    }

    disconnectedCallback() {
        this.dispose()
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

    private toContextKeyFromCsvToggleKey(rawKey: string) {
        const prefix = `${ContextPrefix}.csv.`
        if (rawKey.startsWith(prefix)) {
            return rawKey
        }
        if (rawKey.startsWith("csv.")) {
            return this.createContextKey("csv", rawKey.slice(4))
        }
        return this.createContextKey("csv", rawKey)
    }

    private normalizeCsvToggleForStorage(values: Record<string, boolean>) {
        const result: Record<string, boolean> = {}
        const prefix = `${ContextPrefix}.csv.`
        for (const [rawKey, enabled] of Object.entries(values)) {
            let key = rawKey
            if (rawKey.startsWith(prefix)) {
                key = `csv.${rawKey.slice(prefix.length)}`
            } else if (!rawKey.startsWith("csv.")) {
                key = `csv.${rawKey}`
            }
            result[key] = enabled
        }
        return result
    }

    setContextMenu() {
        addActionWithCommandOption(this.monaco, {
            id: 'header',
            label: 'Show Header',
            order: 0,
            groupId: "monaco-prompt-editor",
            run: () => {
                this.changeShowHeader(!this.getContext(this.createContextKey("showHeader")))
                this.onSettingChange?.({ showHeader: this.showHeader })
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
                this.onSettingChange?.({ minimap: this.getContext(this.createContextKey("minimap")) })
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
                this.onSettingChange?.({ lineNumbers: this.getContext(this.createContextKey("lineNumbers")) })
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
                this.onSettingChange?.({ replaceUnderscore: this.getContext(this.createContextKey("replaceUnderscore")) })
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
                        this.onSettingChange?.({ fontSize: size })
                    },
                    commandOptions: {
                        toggled: {
                            condition: ContextKeyExpr.deserialize(`${this.createContextKey("fontSize")} == '${size}'`)
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
                        this.onSettingChange?.({ fontFamily: inputBox.value })
                        inputBox.dispose()
                    })

                    inputBox.show()
                })
            },
            contextMenuOrder: 5,
            contextMenuGroupId: 'monaco-prompt-editor',
        })

        // Language menu is removed in favor of presets
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
                        this.onSettingChange?.({ mode: value })
                        this.monaco.focus()
                    },
                    commandOptions: {
                        toggled: {
                            condition: ContextKeyExpr.deserialize(`${this.createContextKey("keybinding")} == '${value}'`)
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
                        this.onSettingChange?.({ theme: value })
                    },
                    commandOptions: {
                        toggled: {
                            condition: ContextKeyExpr.deserialize(`${this.createContextKey("theme")} == '${value}'`)
                        }
                    }
                }
            })
        })

        addActionWithSubMenu(this.monaco, {
            title: "Language Preset",
            context: ["MonacoPromptEditorLanguagePreset", this._id].join("_"),
            group: 'monaco-prompt-editor',
            order: 9,
            actions: getAllPresets().map(preset => {
                return {
                    id: ["preset", preset.id].join("_"),
                    label: preset.label,
                    run: () => {
                        this.applyPreset(preset.id)
                        this.onSettingChange?.({ languagePreset: preset.id, languageFeatures: this.languageFeatures })
                    },
                    commandOptions: {
                        toggled: {
                            condition: ContextKeyExpr.deserialize(`${this.createContextKey("languagePreset")} == '${preset.id}'`)
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
        
        // Ensure context keys are initialized for new CSVs
        for (const filename of csvfiles) {
            const basename = filename.split(".", 2)[0]
            const contextKey = this.createContextKey("csv", basename)
            if (this.getContext(contextKey) === undefined) {
                this.setContext(contextKey, true)
            }
        }

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
                    this.onSettingChange?.({ csvToggle: { ...this.getLocalContextValues<boolean>("csv") } })
                },
                commandOptions: {
                    toggled: {
                        condition: ContextKeyExpr.equals(contextKey, true)
                    }
                }
            }
        }))

        this.updateAutoCompleteHeader()
    }

    getCurrentEnableAutoCompleteToggle() {
        return Object.entries(this.getLocalContextValues<boolean>("csv"))
            .filter(([key, value]) => value && key.includes("."))
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

    updateContext() {
        const model = this.monaco.getModel()
        if (model) {
            if (model.getLanguageId() !== this.getContext(this.createContextKey("language"))) {
                this.setContext(this.createContextKey("language"), model.getLanguageId())
            }
        }
        this.setContext(this.createContextKey("theme"), this.theme)
        this.setContext(this.createContextKey("fontSize"), this.monaco.getOption(monaco.editor.EditorOption.fontSize))
        this.setContext(this.createContextKey("fontFamily"), this.monaco.getOption(monaco.editor.EditorOption.fontFamily))
        this.setContext(this.createContextKey("showHeader"), this.showHeader)
        this.setContext(this.createContextKey("lineNumbers"), this.monaco.getOption(monaco.editor.EditorOption.lineNumbers).renderType !== monaco.editor.RenderLineNumbersType.Off)
        this.setContext(this.createContextKey("minimap"), this.monaco.getOption(monaco.editor.EditorOption.minimap).enabled)
        this.setContext(this.createContextKey("replaceUnderscore"), getReplaceUnderscore())
        this.setContext(this.createContextKey("keybinding"), this.mode)
        this.setContext(this.createContextKey("languagePreset"), this.currentPreset)

        this.updateAutoCompleteHeaderToggle()
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
        if (model) {
            monaco.editor.setModelLanguage(model, languageId)
        }
        this.setContext(this.createContextKey("language"), languageId)

        for (const callback of this.onChangeLanguageCallbacks) {
            callback()
        }
    }

    changeShowHeader(show: boolean) {
        this.showHeader = show
        this.setContext(this.createContextKey("showHeader"), show)

        this.updateHeaderVisibility()

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

    focus() {
        this.monaco.focus()
    }

    triggerSuggest() {
        if (this.monaco) {
            this.monaco.trigger('test', 'editor.action.triggerSuggest', {})
        }
    }

    isSuggestVisible(): boolean {
        return this.getSuggestList().length > 0
    }

    getSuggestList(): string[] {
        const controller = this.monaco.getContribution('editor.contrib.suggestController') as any
        const model = controller ? (controller.model || controller._model) : null
        if (model && model._completionModel) {
            const items = model._completionModel.items
            if (Array.isArray(items)) {
                return items.map(item => item.textLabel || "")
            }
        }
        return []
    }

    getValue() {
        return this.monaco.getValue()
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
            configurable: true,
            enumerable: true,
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
                    const show = (ev.target as HTMLInputElement).checked
                    this.changeShowMinimap(show)
                    this.onSettingChange?.({ minimap: show })
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
                    const show = (ev.target as HTMLInputElement).checked
                    this.changeShowLineNumbers(show)
                    this.onSettingChange?.({ lineNumbers: show })
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
                    const isReplace = (ev.target as HTMLInputElement).checked
                    this.changeReplaceUnderscore(isReplace)
                    this.onSettingChange?.({ replaceUnderscore: isReplace })
                }
            },
            ...allFeatures.map(feature => ({
                label: feature.label,
                callback: (label: HTMLLabelElement, checkbox: HTMLInputElement) => {
                    if (!this.elements.featureToggles) this.elements.featureToggles = {}
                    this.elements.featureToggles[feature.id] = checkbox
                },
                isEnabledCallback: () => !!this.languageFeatures[feature.id],
                toggleCallback: (ev: Event) => {
                    const enabled = !this.languageFeatures[feature.id]
                    this.changeLanguageFeature(feature.id, enabled)
                    this.onSettingChange?.({ languageFeatures: this.languageFeatures })
                }
            }))
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
                    this.onSettingChange?.({ fontSize: value })
                }
            },
            {
                label: "Preset",
                data: getAllPresets().reduce((acc: any, p) => { acc[p.label] = p.id; return acc }, {}),
                callback: (label: HTMLLabelElement, select: HTMLSelectElement) => {
                    this.elements.preset = select
                    
                    // Custom用のダミーオプションも追加しておく
                    const opt = document.createElement('option')
                    opt.textContent = "Custom"
                    opt.value = "custom"
                    select.appendChild(opt)
                },
                isSelectedCallback: (dataValue: string) => {
                    return dataValue === this.currentPreset
                },
                changeCallback: (ev: Event) => {
                    const value = (ev.target as HTMLSelectElement).value
                    this.applyPreset(value)
                    this.onSettingChange?.({ languagePreset: value, languageFeatures: this.languageFeatures })
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
                    this.changeMode(value)
                    this.onSettingChange?.({ mode: value })
                    this.monaco.focus()
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
                    const value = (ev.target as HTMLSelectElement).value
                    if (this.getThemeId() !== value) {
                        this.changeTheme(value)
                        this.onSettingChange?.({ theme: value })
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

        const manageBtn = document.createElement('button')
        manageBtn.textContent = 'Manage Presets'
        manageBtn.style.cursor = 'pointer'
        manageBtn.addEventListener('click', () => {
             this.showPresetDialog()
        })
        headerElement.appendChild(manageBtn)

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
        
        const app = (window as any).app;
        if (!app || !app.ui || !app.ui.settings) {
            runAllInstances((instance) => {
                instance.changeLanguage(value)
            })
        }
    }

    rebuildLanguage() {
        PromptEditorManager.getGroup(this.groupId).rebuildLanguage()
    }

    changeLanguageFeature(featureId: string, enabled: boolean, options?: { skipPresetUpdate?: boolean, skipRebuild?: boolean }) {
        this.languageFeatures[featureId] = enabled
        if (this.elements.featureToggles && this.elements.featureToggles[featureId]) {
            this.elements.featureToggles[featureId].checked = enabled
        }
        if (!options?.skipPresetUpdate) {
            this.updatePresetSelection()
        }
        if (!options?.skipRebuild) {
            this.rebuildLanguage()
        }
    }

    showPresetDialog() {
        if (this.onOpenPresetDialog) {
            this.onOpenPresetDialog(this)
        }
    }

    applyPreset(presetId: string) {
        if (presetId === 'custom') return
        const preset = getPreset(presetId)
        if (!preset) return
        this.currentPreset = presetId
        if (this.elements.preset) {
            this.elements.preset.value = presetId
        }
        this.setContext(this.createContextKey("languagePreset"), presetId)
        for (const [featureId, enabled] of Object.entries(preset.features)) {
            this.languageFeatures[featureId] = enabled
            if (this.elements.featureToggles && this.elements.featureToggles[featureId]) {
                this.elements.featureToggles[featureId].checked = enabled
            }
        }
        this.rebuildLanguage()
    }

    saveCustomPreset(name: string, features?: LanguageFeatureToggle) {
        const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-')
        addUserPreset({
            id,
            label: name,
            features: features ? { ...features } : { ...this.languageFeatures },
            isBuiltin: false,
        })
        this.updatePresetOptions()
        this.applyPreset(id)
        this.onSettingChange?.({ languagePreset: id, languageFeatures: this.languageFeatures })
    }

    updatePresetOptions() {
        if (this.elements.preset) {
            const select = this.elements.preset
            const currentVal = select.value
            select.innerHTML = ''
            const all = getAllPresets()
            for (const p of all) {
                const opt = document.createElement('option')
                opt.textContent = p.label
                opt.value = p.id
                select.appendChild(opt)
            }
            const customOpt = document.createElement('option')
            customOpt.textContent = "Custom"
            customOpt.value = "custom"
            select.appendChild(customOpt)
            select.value = currentVal
        }
    }

    updatePresetSelection() {
        const all = getAllPresets()
        let matchedId = 'custom'
        for (const preset of all) {
            if (deepEqual(preset.features, this.languageFeatures)) {
                matchedId = preset.id
                break
            }
        }
        this.currentPreset = matchedId
        if (this.elements.preset) {
            this.elements.preset.value = matchedId
        }
    }

    syncLanguageFeatures() {
        for (const callback of this.onChangeLanguageFeaturesBeforeSyncCallbacks) {
            callback()
        }
        for (const callback of this.onChangeLanguagePresetBeforeSyncCallbacks) {
            callback()
        }

        const app = (window as any).app;
        if (!app || !app.ui || !app.ui.settings) {
            runAllInstances((instance) => {
                instance.languageFeatures = { ...this.languageFeatures }
                instance.currentPreset = this.currentPreset
                instance.updatePresetSelection()
                instance.rebuildLanguage()
            })
        }
    }

    syncKeyBindings() {
        if (!this.elements.keyBindings) {
            return
        }
        const value = this.elements.keyBindings.value as PromptEditorMode
        for (const callback of this.onChangeModeBeforeSyncCallbacks) {
            callback()
        }
        
        const app = (window as any).app;
        if (!app || !app.ui || !app.ui.settings) {
            runAllInstances((instance) => {
                instance.changeMode(value)
            })
        }
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
        
        const app = (window as any).app;
        if (!app || !app.ui || !app.ui.settings) {
            runAllInstances((instance) => {
                instance.changeTheme(value)
            })
        }
    }

    syncShowHeader() {
        for (const callback of this.onChangeShowHeaderBeforeSyncCallbacks) {
            callback()
        }
        
        const app = (window as any).app;
        if (!app || !app.ui || !app.ui.settings) {
            runAllInstances((instance) => {
                instance.changeShowHeader(this.showHeader)
            })
        }
    }

    syncLineNumbers() {
        if (!this.elements.lineNumbers) {
            return
        }
        const value = this.elements.lineNumbers.checked
        for (const callback of this.onChangeShowLineNumbersBeforeSyncCallbacks) {
            callback()
        }
        
        const app = (window as any).app;
        if (!app || !app.ui || !app.ui.settings) {
            runAllInstances((instance) => {
                instance.changeShowLineNumbers(value)
            })
        }
    }

    syncMinimap() {
        if (!this.elements.minimap) {
            return
        }
        const value = this.elements.minimap.checked
        for (const callback of this.onChangeShowMinimapBeforeSyncCallbacks) {
            callback()
        }
        
        const app = (window as any).app;
        if (!app || !app.ui || !app.ui.settings) {
            runAllInstances((instance) => {
                instance.changeShowMinimap(value)
            })
        }
    }

    syncReplaceUnderscore() {
        if (!this.elements.replaceUnderscore) {
            return
        }
        const value = this.elements.replaceUnderscore.checked
        for (const callback of this.onChangeReplaceUnderscoreBeforeSyncCallbacks) {
            callback()
        }
        
        const app = (window as any).app;
        if (!app || !app.ui || !app.ui.settings) {
            runAllInstances((instance) => {
                instance.changeReplaceUnderscore(value)
            })
        }
    }

    syncFontSize() {
        const value = this.getContext(this.createContextKey("fontSize"))
        for (const callback of this.onChangeFontSizeBeforeSyncCallbacks) {
            callback()
        }
        
        const app = (window as any).app;
        if (!app || !app.ui || !app.ui.settings) {
            runAllInstances((instance) => {
                instance.changeFontSize(value)
            })
        }
    }

    syncFontFamily() {
        const value = this.getContext(this.createContextKey("fontFamily"))
        for (const callback of this.onChangeFontFamilyBeforeSyncCallbacks) {
            callback()
        }
        
        const app = (window as any).app;
        if (!app || !app.ui || !app.ui.settings) {
            runAllInstances((instance) => {
                instance.changeFontFamily(value)
            })
        }
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
        this.updateAutoCompleteToggle()
    }

    getEnabledFeatures() {
        return { ...this.languageFeatures }
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
        const callback = () => {
            const main = this.elements.main
            if (!main) {
                return
            }
            this.updateHeaderVisibility()
            //main.style.maxHeight = this.clientHeight + "px"
            if (this.parentElement) {
                main.style.height = this.parentElement.clientHeight + "px"
            }
            this.monaco.layout()
        }
        
        if (typeof ResizeObserver !== 'undefined') {
            const resizeObserver = new ResizeObserver(callback)
            resizeObserver.observe(this)
        }
        
        const mutation = new MutationObserver(callback)
        const intersection = new IntersectionObserver(callback, {
            root: document.documentElement
        })
        mutation.observe(this, {attributes: true, attributeFilter: ["style"]})
        intersection.observe(this)
    }

    updateHeaderVisibility() {
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

        if (!this.isConnected) {
            return
        }

        const parentRect = parent.getBoundingClientRect()

        // エディタの幅や高さが極小（折りたたまれた状態など）の場合はヘッダーを非表示にする
        // それ以外（通常サイズ）の場合は表示状態（デフォルト）にする
        if (parentRect.width >= 100 && parentRect.height >= 50) {
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
        const model = this.monaco.getModel()
        return {
            minimap: this.elements.minimap?.checked,
            showHeader: this.showHeader,
            lineNumbers: this.elements.lineNumbers?.checked,
            replaceUnderscore: getReplaceUnderscore(),
            language: model ? model.getLanguageId() : "plaintext",
            languageFeatures: { ...this.languageFeatures },
            languagePreset: this.currentPreset,
            theme: this.theme,
            mode: this.mode,
            fontSize: this.getContext(this.createContextKey("fontSize")),
            fontFamily: this.getContext(this.createContextKey("fontFamily")),
            csvToggle: this.getLocalContextValues<boolean>("csv"),
            userPresets: getUserPresets(),
        } as PromptEditorSettings
    }


    /**
     * 変更を実際に適用する（マネージャーまたは自身からの決定事項を受け取る）
     * このメソッドからは onSettingChange は発火させない
     */
    applySettings(settings: Partial<PromptEditorSettings>, force=false, options?: { skipRebuild?: boolean }) {
        const currentSettings = this.getSettings()
        let hasChanged = false
        let languageChanged = false

        if (
            settings.minimap !== void 0 && (
                force ||
                settings.minimap !== currentSettings.minimap
            )
        ) {
            this.changeShowMinimap(settings.minimap)
            this.onChangeShowMinimapBeforeSyncCallbacks.forEach(c => c())
            hasChanged = true
        }
        if (
            settings.showHeader !== void 0 && (
                force ||
                settings.showHeader !== currentSettings.showHeader
            )
        ) {
            this.changeShowHeader(settings.showHeader)
            this.onChangeShowHeaderBeforeSyncCallbacks.forEach(c => c())
            hasChanged = true
        }
        if (
            settings.lineNumbers !== void 0 && (
                force ||
                settings.lineNumbers !== currentSettings.lineNumbers
            )
        ) {
            this.changeShowLineNumbers(settings.lineNumbers)
            this.onChangeShowLineNumbersBeforeSyncCallbacks.forEach(c => c())
            hasChanged = true
        }
        if (
            settings.replaceUnderscore !== void 0 && (
                force ||
                settings.replaceUnderscore !== currentSettings.replaceUnderscore
            )
        ) {
            this.changeReplaceUnderscore(settings.replaceUnderscore)
            this.onChangeReplaceUnderscoreBeforeSyncCallbacks.forEach(c => c())
            hasChanged = true
        }

        if (
            settings.language !== void 0 && (
                force ||
                settings.language !== currentSettings.language
            )
        ) {
            if (settings.languageFeatures === void 0) {
                this.changeLanguage(settings.language)
                this.onChangeLanguageBeforeSyncCallbacks.forEach(c => c())
                hasChanged = true
            }
        }

        const freezePreset = settings.languagePreset !== void 0 && settings.languagePreset !== "custom"
        languageChanged = false

        if (settings.languagePreset !== void 0 && (
            force || settings.languagePreset !== currentSettings.languagePreset
        )) {
            const preset = getPreset(settings.languagePreset)
            if (preset && settings.languagePreset !== 'custom') {
                this.currentPreset = settings.languagePreset
                if (this.elements.preset) {
                    this.elements.preset.value = settings.languagePreset
                }
                this.setContext(this.createContextKey("languagePreset"), settings.languagePreset)
                for (const [featureId, enabled] of Object.entries(preset.features)) {
                    this.languageFeatures[featureId] = enabled
                    if (this.elements.featureToggles && this.elements.featureToggles[featureId]) {
                        this.elements.featureToggles[featureId].checked = enabled
                    }
                }
                this.onChangeLanguagePresetBeforeSyncCallbacks.forEach(c => c())
                languageChanged = true
                hasChanged = true
            }
        }

        if (settings.languageFeatures !== void 0 && (
            force || !deepEqual(settings.languageFeatures, currentSettings.languageFeatures)
        )) {
            for (const [featureId, enabled] of Object.entries(settings.languageFeatures)) {
                this.changeLanguageFeature(featureId, enabled, { skipPresetUpdate: freezePreset, skipRebuild: true })
            }
            this.onChangeLanguageFeaturesBeforeSyncCallbacks.forEach(c => c())
            languageChanged = true
            hasChanged = true
        }

        if (languageChanged && !options?.skipRebuild) {
            this.rebuildLanguage()
        }

        if (freezePreset) {
            const presetId = settings.languagePreset as string
            this.currentPreset = presetId
            if (this.elements.preset) {
                this.elements.preset.value = presetId
            }
            this.setContext(this.createContextKey("languagePreset"), presetId)
        }

        if (
            settings.theme !== void 0 && (
                force ||
                settings.theme !== currentSettings.theme
            )
        ) {
            this.changeTheme(settings.theme)
            this.onChangeThemeBeforeSyncCallbacks.forEach(c => c())
            hasChanged = true
        }
        if (
            settings.mode !== void 0 && (
                force ||
                settings.mode !== currentSettings.mode
            )
        ) {
            this.changeMode(settings.mode)
            this.onChangeModeBeforeSyncCallbacks.forEach(c => c())
            hasChanged = true
        }

        if (
            settings.fontSize !== void 0 && (
                force ||
                settings.fontSize !== currentSettings.fontSize
            )
        ) {
            this.changeFontSize(settings.fontSize)
            this.onChangeFontSizeBeforeSyncCallbacks.forEach(c => c())
            hasChanged = true
        }

        if (
            settings.fontFamily !== void 0 && (
                force ||
                settings.fontFamily !== currentSettings.fontFamily
            )
        ) {
            this.changeFontFamily(settings.fontFamily)
            this.onChangeFontFamilyBeforeSyncCallbacks.forEach(c => c())
            hasChanged = true
        }

        if (settings.csvToggle !== void 0 && (force || !deepEqual(settings.csvToggle, currentSettings.csvToggle))) {
            if (typeof settings.csvToggle === 'object' && settings.csvToggle !== null && !Array.isArray(settings.csvToggle)) {
                for (const [key, enabled] of Object.entries(settings.csvToggle)) {
                    this.setContext(this.createContextKey(key), enabled)
                }
            } else {
                console.warn("[WebuiMonacoPrompt] applySettings: csvToggle is not an object", settings.csvToggle)
            }
            this.updateAutoCompleteToggle()
            this.onChangeAutoCompleteToggleBeforeSyncCallbacks.forEach(c => c())
            hasChanged = true
        }

        if (settings.userPresets !== void 0) {
            if (Array.isArray(settings.userPresets)) {
                loadUserPresets(settings.userPresets)
            } else {
                console.warn("[WebuiMonacoPrompt] applySettings: userPresets is not an array", settings.userPresets)
            }
            this.onChangeLanguageUserPresetsBeforeSyncCallbacks.forEach(c => c())
            hasChanged = true
        }

        // UI（セレクトボックス等）を最新のレジストリと同期させる
        this.updatePresetOptions()

        return hasChanged
    }

    /**
     * 変更を依頼する、または直接適用する（エントリポイント）
     */
    setSettings(settings: Partial<PromptEditorSettings>, force=false, options?: { skipRebuild?: boolean }) {
        if (this.onSettingChange) {
            // マネージャが登録されている場合は依頼を出すのみ
            this.onSettingChange(settings, force);
        } else {
            // スタンドアロンの場合は直接適用する
            this.applySettings(settings, force, options);
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

    onChangeLanguagePresetBeforeSync(callback: () => void) {
        this.onChangeLanguagePresetBeforeSyncCallbacks.push(callback)
    }

    onChangeLanguageFeaturesBeforeSync(callback: () => void) {
        this.onChangeLanguageFeaturesBeforeSyncCallbacks.push(callback)
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
        this.onChangeLanguagePresetBeforeSync(callback)
        this.onChangeLanguageFeaturesBeforeSync(callback)
        this.onChangeFontSizeBeforeSync(callback)
        this.onChangeFontFamilyBeforeSync(callback)
        this.onChangeAutoCompleteToggleBeforeSync(callback)
    }

    getLinesTable(start: number, active: number, end: number, model?: monaco.editor.ITextModel) {
        const targetModel = model || this.monaco.getModel()
        if (!targetModel) {
            throw new Error("Model not found in Monaco Editor")
        }

        // 非アクティブなモデルの場合、トークン化が完了していない可能性があるため強制的に実行する
        if ((targetModel as any).tokenization) {
            (targetModel as any).tokenization.forceTokenization(targetModel.getLineCount());
        }

        const currentModel = this.monaco.getModel()
        const isCurrentModel = targetModel === currentModel
        const lineCount = Math.min(end, targetModel.getLineCount())
        const container = document.createElement("div")
        const styleContainer = document.createElement("style")
        const table = document.createElement("table")

        container.appendChild(styleContainer)
        table.classList.add(style["find-lines-table"], "monaco-editor")

        const findmatchClass = utils.getThemeClassName()
        const theme = this.monaco._themeService.getColorTheme()
        const findmatchColor = theme.getColor("editor.findMatchBackground", true)
        const findmatchBorder = theme.getColor("editor.findMatchBorder", true)
        let findmatchStyles = ""
        if (findmatchColor) findmatchStyles += `background-color: ${findmatchColor.toString()};`
        if (findmatchBorder) findmatchStyles += `border-color: ${findmatchBorder.toString()};`

        styleContainer.textContent = `@scope { 
            ${ this.monaco._themeService._themeCSS }
            .${findmatchClass} { ${findmatchStyles} }
        }`

        const options = new ViewLineOptions({ options: this.monaco.getOptions() }, this.getThemeId())
        for (let currentLineNum = Math.max(start, 1); currentLineNum <= lineCount; ++currentLineNum) {
            const trEl = document.createElement("tr")
            const lineNumberContainer = document.createElement("td")
            const lineContentContainer = document.createElement("td")

            lineNumberContainer.textContent = currentLineNum as unknown as string
            lineNumberContainer.classList.add(style["find-line-number"])
            lineContentContainer.classList.add(style["find-line-content"])

            // monaco.editor.colorize* は Decoration の処理をしないため View Line を元に自力でHTMLを生成する必要がある
            const lineDecorations = targetModel.getLineDecorations(currentLineNum)

            const inlineDecorations = lineDecorations.map(lineDecoration => new InlineDecoration(
                lineDecoration.range,
                lineDecoration.options.inlineClassName,
                lineDecoration.options.inlineClassNameAffectsLetterSpacing ? InlineDecorationType.RegularAffectingLetterSpacing : InlineDecorationType.Regular
            ))
            const lineContent = targetModel.getLineContent(currentLineNum)

            let lineData: any
            if (isCurrentModel) {
                const view = this.monaco._modelData.view
                const partialViewportData = Object.assign(view._context.viewLayout.getLinesViewportData(), {
                    startLineNumber: currentLineNum,
                    endLineNumber: currentLineNum+1,
                })
                const viewportData = new ViewportData(view._selections, partialViewportData, view._context.viewLayout.getWhitespaceViewportData(), view._context.viewModel)
                lineData = viewportData.getViewLineRenderingData(currentLineNum)
            } else {
                // 非アクティブなモデルの場合、ViewDataを自前で構築するかデフォルト値を使用する
                lineData = {
                    continuesWithWrappedLine: false,
                    isBasicASCII: /^[\x00-\x7F]*$/.test(lineContent),
                    containsRTL: false,
                    tabSize: targetModel.getOptions().tabSize,
                    startVisibleColumn: 0,
                }
            }

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
                (targetModel as any).tokenization.getLineTokens(currentLineNum),
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
    // マネージャー経由で全てのグループのインスタンスを走査するように変更
    PromptEditorManager.runAllInstances(callback as (instance: PromptEditor) => boolean|void);
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
    const retval = loadCSV(filename, csv)
    updateAutoComplete()
    return retval
}

const _addCSV = (filename: string, csv: string) => {
    const retval = addCSV(filename, csv)
    updateAutoComplete()
    return retval
}

const _clearCSV = () => {
    const retval = clearCSV()
    updateAutoComplete()
    return retval
}

const getLanguages = () => monaco.languages.getLanguages().map(lang => lang.id)
const getAllFeatures = () => allFeatures

const showPresetManager = () => {
    const instance = PromptEditor.prototype.getCurrentFocus()
    new PresetDialog({
        onSave: (name, features) => {
            addUserPreset({
                id: name,
                label: name,
                features: features,
                isBuiltin: false
            })
            if (instance) {
                instance.setSettings({ userPresets: getUserPresets() })
                instance.syncLanguageFeatures()
            }
        },
        onApply: (presetId) => {
            if (instance) {
                instance.applyPreset(presetId)
                instance.syncLanguageFeatures()
            }
        },
        onDelete: (presetId) => {
            removeUserPreset(presetId)
            if (instance) {
                instance.setSettings({ userPresets: getUserPresets() })
                instance.syncLanguageFeatures()
            }
        },
        getCurrentFeatures: () => {
            if (instance) return instance.getEnabledFeatures()
            return {}
        }
    }).show()
}

const KeyMod = monaco.KeyMod
const KeyCode = monaco.KeyCode
type CompletionItem = monaco.languages.CompletionItem
const CompletionItemKind = monaco.languages.CompletionItemKind
const CompletionItemInsertTextRule = monaco.languages.CompletionItemInsertTextRule

export {
    PromptEditor,
    PromptEditorManager,
    PromptEditorMode,
    PromptEditorOptions,
    getCount,
    _loadCSV as loadCSV,
    _addCSV as addCSV,
    _clearCSV as clearCSV,
    getLoadedCSV,
    addLoadedCSV,
    addData,
    addCustomSuggest,
    addLanguages,
    getLanguages,
    runAllInstances,
    PromptEditorSettings,
    ContextKeyExpr,
    KeyMod,
    KeyCode,
    CompletionItem,
    CompletionItemKind,
    CompletionItemInsertTextRule,
    getAllPresets,
    getPreset,
    loadUserPresets,
    getUserPresets,
    addUserPreset,
    removeUserPreset,
    LanguageFeatureToggle,
    LanguagePreset,
    getAllFeatures,
    showPresetManager,
    PresetDialog,
}
