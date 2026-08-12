import * as utils from "./utils"
import * as WebuiMonacoPrompt from "../index" // for typing
import { link } from "./link"
import { FindWidget, ReplaceWidget, MultiTextWidget, FilterWidget } from "./widget"
import * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { app, api } from "./api"
import { loadSetting, saveSettings, updateInstanceSettings } from "./settings"
import { comfyPrompt, comfyDynamicPrompt } from "./languages"
import { escapeHTML } from "../utils"
import { PresetDialog } from "../preset_dialog"

declare let __webpack_public_path__: any;

interface Window {
    WebuiMonacoPromptBaseURL: string
    WebuiMonacoPrompt: typeof WebuiMonacoPrompt
    WebuiMonacoPromptUtils: typeof utils
}
declare var window: Window
declare var LGraphCanvas: any

// set dynamic path
const srcURL = new URL(document.currentScript ? (document.currentScript as HTMLScriptElement).src : import.meta.url)
const dir = srcURL.pathname.split('/').slice(0, -1).join('/');
window.WebuiMonacoPromptBaseURL = dir + "/";
__webpack_public_path__ = dir + "/"

// codicon
utils.loadCodicon(dir)
utils.loadStyle(dir, "multitext.css")

// import は __webpack_public_path__ を使う場合は処理順の関係で使えない
const MonacoPrompt = require("../index") as typeof WebuiMonacoPrompt
window.WebuiMonacoPrompt = MonacoPrompt
window.WebuiMonacoPromptUtils = utils

// テスト用に露出
if (typeof window !== "undefined") {
    (window as any).WebuiMonacoPrompt = {
        ...(window as any).WebuiMonacoPrompt,
        getPresetDialog: () => getPresetDialog(),
        showPresetManager: () => showPresetManager(),
    }
}

const languages = [
    {id: "comfy-prompt", lang: comfyPrompt},
    {id: "comfy-dynamic-prompt", lang: comfyDynamicPrompt},
]
MonacoPrompt.addLanguages(languages)

const models = [
    {
        keybinding: WebuiMonacoPrompt.KeyMod.chord(
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM,
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM
        ),
        model: "checkpoints"
    },
    {
        keybinding: WebuiMonacoPrompt.KeyMod.chord(
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM,
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyL
        ),
        model: "loras"
    },
    {
        keybinding: WebuiMonacoPrompt.KeyMod.chord(
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM,
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyE
        ),
        model: "embeddings"
    },
    {
        keybinding: WebuiMonacoPrompt.KeyMod.chord(
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM,
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyH
        ),
        model: "hypernetworks"
    },
    {
        keybinding: WebuiMonacoPrompt.KeyMod.chord(
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM,
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyA
        ),
        model: "vae"
    },
]
type ComfyAPIModels = string[] | {name: string, pathIndex: number}[]
for (const {keybinding, model} of models) {
    MonacoPrompt.addCustomSuggest(model, keybinding, async () => {
        const items: Partial<WebuiMonacoPrompt.CompletionItem>[] = []
        const models = await api.getModels(model) as ComfyAPIModels
        const modelNames = new Set<string>()

        models.forEach(model => {
            const name = typeof model === "string" ? model : model.name
            modelNames.add(name)
        })

        modelNames.forEach(modelName => {
            items.push({
                label: modelName,
                kind: WebuiMonacoPrompt.CompletionItemKind.File,
                insertText: modelName,
            })
        })
        return items
    })
}

// snippet
MonacoPrompt.addCustomSuggest(
    "snippet",
    WebuiMonacoPrompt.KeyMod.chord(
        WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM,
        WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyS,
    ),
    async () => {
        const items: Partial<WebuiMonacoPrompt.CompletionItem>[] = []
        const snippets = await api.fetchApi("/webui-monaco-prompt/snippet").then((res: Response) => res.json())

        for (const snippet of snippets) {
            const usage = `**${escapeHTML(snippet.insertText)}**`
            items.push({
                label: snippet.label,
                kind: WebuiMonacoPrompt.CompletionItemKind.Snippet,
                insertText: snippet.insertText,
                insertTextRules: WebuiMonacoPrompt.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: snippet.path,
                documentation: {
                    supportHtml: true,
                    value: snippet.documentation ?
                        [
                            usage,
                            snippet.documentation
                        ].join("<br><br>") :
                        usage
                },
            })
        }

        return items
    }
)
async function refreshSnippets() {
    await api.fetchApi("/webui-monaco-prompt/snippet-refresh").then((res: Response) => res.json())
    return
}

let csvfiles: string[]
async function loadCSVContent (files: string[]) {
    MonacoPrompt.clearCSV()

    for (const filename of files) {
        if (!filename) continue
        const path = [dir, filename].join('/')
        const filenameParts = filename.split('.')
        const basename = filenameParts[0]
        const value = await fetch(path + '?t=' + Date.now()).then(res => res.text())
        MonacoPrompt.addCSV(basename, value)
    }
}

async function refreshCSV() {
    csvfiles = await fetch("/webui-monaco-prompt/csv").then(res => res.json())
    // 内部的な CSV 内容の読み込み
    await loadCSVContent(csvfiles)
}


function getCSSRules(target: string[]) {
    const targetSet = new Set(target)
    const result: {[key: string]: CSSStyleDeclaration[]} = {}

    for (const  styleSheet of  document.styleSheets) {
        try {
            for (const rule of styleSheet.cssRules) {
                if (rule instanceof CSSStyleRule) {
                    if (targetSet.has(rule.selectorText)) {
                        if (!Array.isArray(result[rule.selectorText])) {
                            result[rule.selectorText] = []
                        }
                        result[rule.selectorText].push(rule.style)
                    }
                }
            }
        } catch(e) { /* ignore CORS */ }
    }

    return result
}

function getZIndex(styles: CSSStyleDeclaration[] = []) {
    for (const style of styles) {
        const zIndex = style.getPropertyValue("z-index")
        if (zIndex) {
            return ((zIndex as unknown as number) | 0)
        }
    }

    return 0
}

const rules = getCSSRules([".graphdialog"])
const graphDialogZIndex = getZIndex(rules[".graphdialog"]) || 1000

function styleToString(s: CSSStyleDeclaration, list: string[], isExclude=true) {
    const result = []
    const listset = new Set(list)

    for (let i = 0, il = s.length; i < il; ++i) {
        const prop = s[i]
        if (listset.has(prop) === isExclude) {
           continue
        }
        const priority = s.getPropertyPriority(s[i])
        result.push(`${prop}: ${s.getPropertyValue(prop)}${priority === "" ? "" : " !" + priority};`)
    }

    return result.join("\n")
}

function onCreateTextarea(textarea: HTMLTextAreaElement, node: any, force = false) {
    if (!force) {
        const isReplace = app.ui.settings.getSettingValue("WebuiMonacoPrompt.ReplaceTextarea")
        if (isReplace === false) {
            return
        }
    }

    if (textarea.dataset.webuiMonacoPromptTextareaId) {
        return
    }
    if (textarea.readOnly) {
        return
    }

    let editor: any
    try {
        editor = new WebuiMonacoPrompt.PromptEditor(textarea, {
            autoLayout: true,
            handleTextAreaValue: true,
            groupId: "comfyui",
        })
    } catch (e) {
        console.error("[WebuiMonacoPrompt] Failed to create PromptEditor", e)
        return
    }

    // 対象のウィジェットオブジェクトを特定する
    const widget = node.widgets?.find((w: any) => w.element === textarea)
    // エディタの表示状態を更新するヘルパー関数
    const updateEditorVisibility = () => {
        if (widget && widget.type === "hidden") {
            editor.style.display = "none"
        } else {
            editor.style.display = ""
        }
    }

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.target !== textarea) continue
            // Never mirror textarea display:none onto the editor
            editor.style.cssText = styleToString((mutation.target as HTMLTextAreaElement).style, ["display"])
            // 非表示状態を最優先で適用する
            updateEditorVisibility()
        }
    })
    editor.style.zIndex = "" + (graphDialogZIndex - 1)
    observer.observe(textarea, {
        attributes: true,
        attributeFilter: ["style"]
    })
    editor.style.cssText = styleToString(textarea.style, ["display"])

    // ウィジェットの type プロパティを動的にフックする
    if (widget) {
        let widgetType = widget.type
        Object.defineProperty(widget, "type", {
            get() {
                return widgetType
            },
            set(val) {
                widgetType = val
                updateEditorVisibility()
            },
            configurable: true
        })
        // 初期状態の反映
        updateEditorVisibility()
    }

    Object.assign(editor.elements.header!.style, { backgroundColor: "#444", fontSize: "small" })
    Object.assign(editor.elements.footer!.style, { backgroundColor: "#444", fontSize: "small" })
    
    const id = editor.getInstanceId()
    textarea.dataset.webuiMonacoPromptTextareaId = "" + id
    editor.dataset.webuiMonacoPromptTextareaId = "" + id
    link[id] = {
        textarea: textarea,
        monaco: editor,
        observer: observer,
        node: node,
    }

    utils.applyCommonEditorSetup(app, editor, node)
    const attachEditor = () => {
        const parent = textarea.parentElement
        if (parent && (!editor.isConnected || editor.parentElement !== parent)) {
            parent.append(editor)
            return true
        }
        return false
    }
    const attachObserver = new MutationObserver(() => {
        if (!editor.isConnected) {
            attachEditor()
        }
    })
    attachObserver.observe(document.body, { childList: true, subtree: true })
    attachEditor()
    ;(editor as any)._attachObserver = attachObserver
    const attachInterval = setInterval(() => {
        if (!editor.isConnected) {
            attachEditor()
        }
    }, 500)
    ;(editor as any)._attachIntervalId = attachInterval

    registerPromptEditor(editor)
    editor.onChangeTheme(() => {
        editor.monaco._themeService.onDidColorThemeChange(() => {
            utils.updateThemeStyle(editor)
        })
    })

    updateInstanceSettings(editor)
    utils.updateThemeStyle(editor)
    editor.onChangeBeforeSync(() => saveSettings(editor))

    return editor
}

function onRemoveTextarea(textarea: HTMLTextAreaElement) {
    const id = textarea.dataset.webuiMonacoPromptTextareaId
    if (typeof(id) !== 'string') return

    const ctx = link[id]
    ctx.observer.disconnect()
    const editor = ctx.monaco
    const attachObserver = (editor as any)._attachObserver
    if (attachObserver) {
        attachObserver.disconnect()
    }
    const attachIntervalId = (editor as any)._attachIntervalId
    if (attachIntervalId) {
        clearInterval(attachIntervalId)
    }
    editor.dispose()
    if (editor.parentElement) {
        editor.parentElement.removeChild(ctx.monaco)
    }
    MonacoPrompt.PromptEditorManager.getGroup("comfyui").unregister(editor)
    delete link[id]
}

let presetDialog: PresetDialog | null = null

export function showPresetManager() {
    getPresetDialog().show()
}

function getPresetDialog() {
    if (!presetDialog) {
        presetDialog = new PresetDialog({
            onSave: (name, features) => {
                const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-')
                MonacoPrompt.addUserPreset({
                    id,
                    label: name,
                    features: features || {},
                    isBuiltin: false
                })
                MonacoPrompt.PromptEditorManager.getGroup("comfyui").updateSettings({
                    languagePreset: id,
                    languageFeatures: features || {}
                })
                return true
            },
            onApply: (id) => {
                MonacoPrompt.PromptEditorManager.getGroup("comfyui").updateSettings({
                    languagePreset: id
                })
            },
            onDelete: (id) => {
                MonacoPrompt.removeUserPreset(id)
                MonacoPrompt.PromptEditorManager.getGroup("comfyui").rebuildLanguage()
                // 全インスタンスのUI（セレクトボックス）を更新
                MonacoPrompt.PromptEditorManager.runAllInstances((instance) => {
                    instance.updatePresetOptions()
                    // trigger save manually
                    saveSettings(instance as any)
                })
                // Trigger updateSettings to force saving userPresets
                MonacoPrompt.PromptEditorManager.getGroup("comfyui").updateSettings({
                    userPresets: MonacoPrompt.getUserPresets()
                })
            },
            getCurrentFeatures: () => {
                return MonacoPrompt.PromptEditorManager.getGroup("comfyui").getSettings().languageFeatures || {}
            }
        })
    }
    return presetDialog
}

function registerPromptEditor(instance: any) {
    instance.onOpenPresetDialog = () => {
        getPresetDialog().show()
    }
}

function hookNodeWidgets(node: any) {
    if (!node.widgets) return
    const processWidget = (widget: any) => {
        if (widget.element instanceof HTMLTextAreaElement) {
            const isReplace = app.ui.settings.getSettingValue("WebuiMonacoPrompt.ReplaceTextarea")
            if (isReplace !== false) {
                onCreateTextarea(widget.element, node, true)
            }
            return true
        }
        return false
    }

    for (const widget of node.widgets) {
        if (node.comfyClass === "WebuiMonacoPromptMultiText" && widget.name === "text") continue
        if (node.comfyClass === "WebuiMonacoPromptJsonFilter" || node.type === "WebuiMonacoPromptJsonFilter") continue
        
        if (!processWidget(widget)) {
            let timeoutId: any = null;
            const observer = new MutationObserver(() => {
                if (widget.element) {
                    if (processWidget(widget)) {
                        cleanup();
                    }
                }
            });

            const cleanup = () => {
                observer.disconnect();
                if (timeoutId) clearTimeout(timeoutId);
            };

            observer.observe(document.body, { childList: true, subtree: true });
            timeoutId = setTimeout(() => {
                cleanup();
            }, 5000);

            if (widget.element) {
                if (processWidget(widget)) {
                    cleanup();
                }
            }
        }
    }
    const onRemovedOriginal = node.onRemoved
    node.onRemoved = function() {
        if (onRemovedOriginal) onRemovedOriginal.apply(this, arguments)
        for (const widget of node.widgets) {
            if (widget.element instanceof HTMLTextAreaElement) {
                onRemoveTextarea(widget.element)
            }
        }
    }
}

interface CustomNodeWidget {
    nodeType: string
    widget: typeof FindWidget
}

const CustomNode: {[key: string]: CustomNodeWidget} = {
    find: { nodeType: "WebuiMonacoPromptFind", widget: FindWidget as any },
    replace: { nodeType: "WebuiMonacoPromptReplace", widget: ReplaceWidget as any },
    multitext: { nodeType: "WebuiMonacoPromptMultiText", widget: MultiTextWidget as any },
    json_filter: {
        nodeType: "WebuiMonacoPromptJsonFilter",
        widget: class {
            static fromNode(app: any, node: any) {
                const rulesWidget = node.widgets.find((w: any) => w.name === "rules");
                if (rulesWidget) {
                    rulesWidget.type = "hidden";
                    (rulesWidget as any).hidden = true;
                    (rulesWidget as any).draw = () => {};
                    (rulesWidget as any).computeSize = () => [0, 0];
                    rulesWidget.beforeQueued = function() {
                        this.value = node.properties.rules || [];
                    };
                    rulesWidget.serializeValue = function() {
                        return node.properties.rules || [];
                    };
                }
                const filterWidget = new FilterWidget(node);
                const domWidget = node.addDOMWidget("webui-monaco-prompt-filter", "filter", filterWidget.container, {
                    hideOnZoom: true,
                    serialize: false,
                    getValue() {
                        return filterWidget.rules;
                    },
                    setValue(v: any) {
                        if (v) {
                            if (typeof v === "string") {
                                filterWidget.loadRulesFromValue(v);
                            } else if (Array.isArray(v)) {
                                filterWidget.setRules(v);
                            }
                        }
                    },
                });

                const updateDOMWidgetSize = (size: [number, number]) => {
                    if (domWidget.element && size) {
                        const startY = 40; 
                        const availableHeight = Math.max(30, size[1] - startY - 20);
                        const availableWidth = Math.max(100, size[0] - 30);
                        // Apply directly to the element to bypass LiteGraph's container restrictions
                        domWidget.element.style.setProperty("height", `${availableHeight}px`, "important");
                        domWidget.element.style.setProperty("width", `${availableWidth}px`, "important");
                        domWidget.element.style.position = "absolute";
                        domWidget.element.style.left = "0px";
                    }
                };

                const origOnResize = node.onResize;
                node.onResize = function(this: any, size: [number, number]) {
                    if (origOnResize) origOnResize.apply(this, arguments as any);
                    updateDOMWidgetSize(size);
                };

                const origWidgetOnResize = (domWidget as any).onResize;
                (domWidget as any).onResize = function(this: any, w: number, h: number) {
                    if (origWidgetOnResize) origWidgetOnResize.apply(this, arguments as any);
                    const realNode = this._node || node;
                    if (realNode && realNode.size) {
                        updateDOMWidgetSize(realNode.size);
                    }
                };

                const originalDraw = (domWidget as any).draw;
                (domWidget as any).draw = function(this: any, ctx: CanvasRenderingContext2D, n: any, widget_width: number, y: number, H: number, ...args: any[]) {
                    if (originalDraw) {
                        originalDraw.call(this, ctx, n, widget_width, y, H, ...args);
                    }
                    if (this.element) {
                        const nodeHeight = n.size ? n.size[1] : 200;
                        const nodeWidth = n.size ? n.size[0] : 350;
                        const availableHeight = Math.max(30, nodeHeight - y - 20);
                        const availableWidth = Math.max(100, nodeWidth - 30);
                        this.element.style.setProperty("height", `${availableHeight}px`, "important");
                        this.element.style.setProperty("width", `${availableWidth}px`, "important");
                        this.element.style.position = "absolute";
                        this.element.style.left = "0px";
                    }
                };

                (domWidget as any).computeSize = function(this: any, width: number) {
                    // Return the minimum required size for the widget.
                    // Returning a value based on node.size causes LiteGraph to recursively increase the node height.
                    return [350, 170];
                };
            }
        } as any,
    },
}

const CustomNodeFromNodeType = Object.fromEntries(
    Object.entries(CustomNode).map(([key, value]) => [value.nodeType, value])
)

function findEditorByModel(model: any) {
    let found: any = null;
    MonacoPrompt.PromptEditorManager.runAllInstances((instance: any) => {
        if (instance.monaco && instance.monaco.getModel() === model) {
            found = instance;
            return true;
        }
    });
    return found;
}

const templateCompletionProvider = {
    triggerCharacters: ["<"],
    provideCompletionItems: function(model: any, position: any, context: any) {
        const editorInstance = findEditorByModel(model);
        if (!editorInstance || typeof editorInstance.getTemplateFiles !== 'function') {
            return { suggestions: [] };
        }

        const prevChar = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: position.column - 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
        });
        const triggerCharacter = context.triggerCharacter || prevChar;

        if (triggerCharacter !== "<") {
            return { suggestions: [] };
        }

        const files = editorInstance.getTemplateFiles() as string[];
        const suggestions: any[] = [];

        const range = {
            startLineNumber: position.lineNumber,
            startColumn: position.column - 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
        };

        for (const file of files) {
            const paths = [file];
            const extIndex = file.lastIndexOf('.');
            if (extIndex !== -1) {
                paths.push(file.slice(0, extIndex));
            }

            for (const p of paths) {
                for (const mode of ["include", "random"]) {
                    const detail = mode === "include" ? "Template Include" : "Template Random";
                    const value = `${mode}:${p}`;
                    const insertText = `<${value}>`;

                    suggestions.push({
                        label: {
                            label: `${mode}:${p}`,
                            description: detail
                        },
                        filterText: `<${value}`,
                        kind: MonacoPrompt.CompletionItemKind.Folder,
                        insertText: insertText,
                        detail: detail,
                        range: range
                    });
                }
            }
        }

        return { suggestions };
    }
};

const register = (app: any) => {
    const multiTextNodes = new Set<any>()
    app.registerExtension({
        name: ["Taremin", "WebuiMonacoPrompt"].join('.'),
        async beforeRegisterNodeDef(nodeType: any) {
            const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
            nodeType.prototype.getExtraMenuOptions = function(canvas: any, options: any[]) {
                if (originalGetExtraMenuOptions) originalGetExtraMenuOptions.apply(this, arguments);

                if (multiTextNodes.size > 0) {
                    options.push({
                        content: "Add to MultiText",
                        has_submenu: true,
                        callback: (value: any, options: any, e: MouseEvent, menu: any) => {
                            new (window as any).LiteGraph.ContextMenu(
                                Array.from(multiTextNodes).map((tn: any) => ({
                                    content: `#${tn.id}: ${tn.title || tn.type}`,
                                    callback: () => {
                                        for (const sn of Object.values(app.canvas.selected_nodes) as any[]) {
                                            const widget = sn.widgets?.find((w: any) => w.element instanceof HTMLTextAreaElement);
                                            if (tn.multitext_widget) {
                                                tn.multitext_widget.addItemWithName('file', sn.title || sn.type, null, widget ? widget.value : "");
                                                app.canvas.setDirty(true);
                                            }
                                        }
                                    }
                                })),
                                { event: e, parentMenu: menu }
                            );
                        }
                    });
                }
            };
        },
        async setup() {
            let isInternalSyncing = true;
            const addSetting = (id: string, name: string, type: string, defaultValue: any, tooltip?: string, options?: any) => {
                const settingDefinition: any = {
                    id, name, type, defaultValue, tooltip,
                    onChange: (value: any) => {
                        const map: Record<string, string> = {
                            "WebuiMonacoPrompt.Minimap": "minimap",
                            "WebuiMonacoPrompt.LineNumbers": "lineNumbers",
                            "WebuiMonacoPrompt.ReplaceUnderscore": "replaceUnderscore",
                            "WebuiMonacoPrompt.KeyBindings": "mode",
                            "WebuiMonacoPrompt.Theme": "theme",
                            "WebuiMonacoPrompt.LanguagePreset": "languagePreset",
                            "WebuiMonacoPrompt.ShowHeader": "showHeader",
                            "WebuiMonacoPrompt.FontSize": "fontSize",
                            "WebuiMonacoPrompt.FontFamily": "fontFamily",
                            "WebuiMonacoPrompt.CsvToggle": "csvToggle",
                        }
                        const key = map[id]
                        if (key) {
                            WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui").updateSettings({ [key]: value })
                        } else if (id.startsWith("WebuiMonacoPrompt.LanguageFeature.")) {
                            const featureId = id.replace("WebuiMonacoPrompt.LanguageFeature.", "")
                            const boolValue = value === true || value === "true" || value === 1;
                            const currentFeatures = WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui").getSettings().languageFeatures || {}
                            WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui").updateSettings({
                                languageFeatures: { ...currentFeatures, [featureId]: boolValue }
                            })
                        }

                        if (isInternalSyncing || (window as any).WebuiMonacoPrompt_isSaving) return;

                        if (id === "WebuiMonacoPrompt.LanguagePreset") {
                            const preset = WebuiMonacoPrompt.getPreset(value)
                            if (preset) {
                                isInternalSyncing = true;
                                (async () => {
                                    for (const [featureId, enabled] of Object.entries((preset as any).features)) {
                                        await app.ui.settings.setSettingValue(`WebuiMonacoPrompt.LanguageFeature.${featureId}`, enabled)
                                    }
                                    isInternalSyncing = false
                                })()
                            }
                        } else if (id.startsWith("WebuiMonacoPrompt.LanguageFeature.")) {
                            isInternalSyncing = true
                            app.ui.settings.setSettingValue("WebuiMonacoPrompt.LanguagePreset", WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui").getSettings().languagePreset || "custom")
                            isInternalSyncing = false
                        }
                    }
                }
                if (options) {
                    const originalOnChange = settingDefinition.onChange;
                    const optionsOnChange = options.onChange;
                    Object.assign(settingDefinition, options);
                    if (optionsOnChange) {
                        settingDefinition.onChange = (value: any) => {
                            if (originalOnChange) originalOnChange(value);
                            optionsOnChange(value);
                        };
                    }
                }
                return app.ui.settings.addSetting(settingDefinition)
            }

            // ComfyUI 設定画面の初期化完了を待つために少し遅延させる
            await new Promise(resolve => setTimeout(resolve, 500));

            addSetting("WebuiMonacoPrompt.ShowHeader", "Show Header", "boolean", false)      
            addSetting("WebuiMonacoPrompt.Minimap", "Show Minimap", "boolean", true)        
            addSetting("WebuiMonacoPrompt.LineNumbers", "Show Line Numbers", "boolean", true)
            addSetting("WebuiMonacoPrompt.ReplaceUnderscore", "Replace Underscore", "boolean", false)
            addSetting("WebuiMonacoPrompt.FontSize", "Font Size", "slider", 12, "", { attrs: { min: 8, max: 48, step: 1 } })
            addSetting("WebuiMonacoPrompt.FontFamily", "Font Family", "text", "")
            addSetting("WebuiMonacoPrompt.LanguagePreset", "Language Preset", "combo", "comfy-dynamic-prompt", "", { options: [...WebuiMonacoPrompt.getAllPresets().map(p => p.id), "custom"] })
            addSetting("WebuiMonacoPrompt.KeyBindings", "Key Bindings", "combo", "NORMAL", "", { options: ["NORMAL", "VIM"] })
            addSetting("WebuiMonacoPrompt.Theme", "Theme", "combo", "vsc-dark", "", { options: ["vs", "vs-dark", "hc-black", "hc-light"] })
            addSetting("WebuiMonacoPrompt.CsvToggle", "CSV Toggle", "hidden", {})
            addSetting("WebuiMonacoPrompt.LanguageUserPresets", "User Presets", "hidden", [])

            const defaultFeatures = WebuiMonacoPrompt.getPreset('comfy-dynamic-prompt')?.features || {}
            for (const feature of WebuiMonacoPrompt.getAllFeatures()) {
                const featureId = `WebuiMonacoPrompt.LanguageFeature.${feature.id}`
                const existingValue = app.ui.settings.getSettingValue(featureId)
                const presetDefault = feature.id in defaultFeatures ? defaultFeatures[feature.id] : false
                addSetting(featureId, `Language Feature: ${feature.label}`, "boolean", existingValue !== undefined ? existingValue : presetDefault)
            }

            addSetting("WebuiMonacoPrompt.ReplaceTextarea", "Replace Textarea", "boolean", true, "", {
                onChange: (value: boolean) => {
                    const nodes = app.graph._nodes
                    for (const node of nodes) {
                        if (!node.widgets) continue;
                        for (const widget of node.widgets) {
                            if (node.comfyClass === "WebuiMonacoPromptMultiText" && widget.name === "text") continue;
                            if (widget.element instanceof HTMLTextAreaElement) {
                                if (value) onCreateTextarea(widget.element, node, true);
                                else onRemoveTextarea(widget.element);
                            }
                        }
                    }
                }
            })

            // プリセット管理設定ボタン（ComfyUI用）
            addSetting("WebuiMonacoPrompt.ManagePresets", "Manage Language Presets", "custom", null, "", {
                type: (name: string) => {
                    const row = document.createElement("tr");
                    const labelCell = document.createElement("td");
                    labelCell.textContent = name;
                    labelCell.style.padding = "8px";
                    const btnCell = document.createElement("td");
                    btnCell.style.padding = "8px";
                    btnCell.style.textAlign = "right";
                    const btn = document.createElement("button");
                    btn.textContent = "Open Dialog";
                    btn.className = "comfy-btn";
                    btn.style.width = "auto";
                    btn.onclick = () => getPresetDialog().show();
                    btnCell.appendChild(btn);
                    row.append(labelCell, btnCell);
                    return row;
                }
            });

            // CSVファイル一覧の設定（ComfyUI用）
            addSetting("WebuiMonacoPrompt.CSVSettings", "CSV Enabled Files", "custom", null, "", {
                type: (name: string) => {
                    const container = document.createElement("div");
                    container.style.padding = "8px";
                    const list = document.createElement("div");
                    list.style.display = "flex";
                    list.style.flexDirection = "column";
                    list.style.gap = "4px";
                    const csvToggle = app.ui.settings.getSettingValue("WebuiMonacoPrompt.CsvToggle") || {};
                    if (csvfiles && csvfiles.length > 0) {
                        for (const csv of csvfiles) {
                            const row = document.createElement("label");
                            row.style.display = "flex";
                            row.style.alignItems = "center";
                            row.style.gap = "8px";
                            row.style.cursor = "pointer";
                            const cb = document.createElement("input");
                            cb.type = "checkbox";
                            
                            // 拡張子を除いたベース名をキーにする
                            const basename = csv.split('.')[0];
                            const key = `csv.${basename}`;
                            
                            cb.checked = csvToggle[key] !== false;
                            cb.onchange = () => {
                                const current = { ...(app.ui.settings.getSettingValue("WebuiMonacoPrompt.CsvToggle") || {}) };
                                current[key] = cb.checked;
                                WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui").updateSettings({ csvToggle: current });
                                const instances = (WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui") as any).editors;
                                for (const instance of instances) {
                                    saveSettings(instance);
                                }
                            };
                            row.appendChild(cb);
                            row.appendChild(document.createTextNode(csv));
                            list.appendChild(row);
                        }
                    } else {
                        const empty = document.createElement("div");
                        empty.textContent = "No CSV files found or still loading...";
                        empty.style.opacity = "0.5";
                        list.appendChild(empty);
                    }
                    container.appendChild(list);
                    const tr = document.createElement("tr");
                    const td = document.createElement("td");
                    td.colSpan = 2;
                    td.appendChild(container);
                    tr.appendChild(td);
                    return tr;
                }
            });

            try {
                await refreshCSV()
                await loadSetting()
            } catch (e) {
                console.error("[WebuiMonacoPrompt] Error during initial CSV/Settings load:", e)
            }
            (window as any).WebuiMonacoPrompt_settingsRegistered = true;

            // Settings Sync Listener
            const onSettingsChanged = (e: any) => {
                if (isInternalSyncing || (window as any).WebuiMonacoPrompt_isSaving) return;
                const id = e.detail?.id || e.detail;
                if (id && id.startsWith("WebuiMonacoPrompt.")) {
                    const instances = (WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui") as any).editors;
                    for (const instance of instances) {
                        try { updateInstanceSettings(instance); } catch(err) {}
                    }
                }
            };
            (window as any).addEventListener("comfy-settings-changed", onSettingsChanged);
            (window as any).addEventListener("comfy-setting-changed", onSettingsChanged);
            document.addEventListener("comfy-settings-changed", onSettingsChanged);
            document.addEventListener("comfy-setting-changed", onSettingsChanged);

            if (app.refreshComboInNodes) {
                const original = app.refreshComboInNodes
                app.refreshComboInNodes = async function() {
                    const res = original.apply(this, arguments)
                    await refreshCSV()
                    await loadSetting()
                    return res
                }
            }

            // Replace existing textareas
            for (const node of app.graph._nodes) {
                hookNodeWidgets(node)
                // hookNodeWidgets 内部で register されているはずだが、念のため
                const instances = (WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui") as any).editors;
                for (const instance of instances) {
                    registerPromptEditor(instance);
                }

                const nodeType = node.type || node.comfyClass;
                if (nodeType === "WebuiMonacoPromptMultiText") {
                    multiTextNodes.add(node);
                    const originalOnRemoved = node.onRemoved;
                    node.onRemoved = function() {
                        if (originalOnRemoved) originalOnRemoved.apply(this, arguments);
                        multiTextNodes.delete(node);
                    }
                }
                const customNode = CustomNodeFromNodeType[nodeType]
                if (customNode) customNode.widget.fromNode(app, node)
            }

            // Initial delay apply
            const initialInstances = (WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui") as any).editors;
            for (const instance of initialInstances) {
                updateInstanceSettings(instance);
            }

            // Monaco にテンプレートファイル用の補完プロバイダを登録
            const monacoAPI = (window as any).monaco || Monaco;
            if (monacoAPI && monacoAPI.languages) {
                for (const lang of ["comfy-prompt", "comfy-dynamic-prompt", "composed-prompt"]) {
                    monacoAPI.languages.registerCompletionItemProvider(lang, templateCompletionProvider);
                }
            }

            // ComfyUI の標準エラーダイアログの表示をフック
            const originalShow = app.ui.dialog.show;
            app.ui.dialog.show = function(content: any) {
                const res = originalShow.apply(this, arguments);

                // 表示文字列から [PromptTemplateError] の存在を検出
                let errorText = "";
                if (typeof content === "string") {
                    errorText = content;
                } else if (content && typeof content.textContent === "string") {
                    errorText = content.textContent;
                } else if (content && typeof content.innerHTML === "string") {
                    errorText = content.innerHTML;
                }

                if (errorText && errorText.includes("[PromptTemplateError]")) {
                    const match = errorText.match(/\[PromptTemplateError\] In file '([^']+)': (.*)/);
                    if (match) {
                        const filename = match[1];
                        const errorMessage = match[2];

                        setTimeout(() => {
                            const dialogEl = app.ui.dialog.element;
                            if (!dialogEl) return;

                            // エラー元のファイル名をリンクに置き換える
                            const targetText = `In file '${filename}'`;
                            
                            const findAndReplaceText = (node: Node) => {
                                if (node.nodeType === Node.TEXT_NODE) {
                                    const text = node.nodeValue || "";
                                    if (text.includes(targetText)) {
                                        const parent = node.parentNode as HTMLElement;
                                        if (parent && parent.tagName !== "A" && !parent.dataset.templated) {
                                            parent.dataset.templated = "true";
                                            const linkHTML = `In file '<a href="#" class="monaco-template-error-link" style="color: #58a6ff; text-decoration: underline; cursor: pointer;">${filename}</a>'`;
                                            parent.innerHTML = parent.innerHTML.replace(targetText, linkHTML);
                                        }
                                    }
                                } else {
                                    for (let child of Array.from(node.childNodes)) {
                                        findAndReplaceText(child);
                                    }
                                }
                            };
                            findAndReplaceText(dialogEl);

                            // リンクがクリックされたときのアクションをバインド
                            const links = dialogEl.querySelectorAll(".monaco-template-error-link");
                            links.forEach((link: any) => {
                                link.onclick = (e: MouseEvent) => {
                                    e.preventDefault();
                                    app.ui.dialog.close();

                                    // ワークフロー上のすべての WebuiMonacoPromptMultiText ノードを走査し、
                                    // 該当ファイルを持っているノードの multitext_widget を探して handleTemplateError を呼ぶ
                                    const nodes = app.graph._nodes || [];
                                    for (const node of nodes) {
                                        const nodeType = node.type || node.comfyClass;
                                        if (nodeType === "WebuiMonacoPromptMultiText" && node.multitext_widget) {
                                            const widget = node.multitext_widget;
                                            const hasFile = (items: any[]): boolean => {
                                                for (const item of items) {
                                                    if (item.type === 'file') {
                                                        const path = widget.getItemPath(item.id);
                                                        const pathNoExt = path.slice(0, path.lastIndexOf('.'));
                                                        if (path === filename || pathNoExt === filename || item.name === filename) {
                                                            return true;
                                                        }
                                                    } else if (item.children) {
                                                        if (hasFile(item.children)) return true;
                                                    }
                                                }
                                                return false;
                                            };

                                            if (hasFile(widget.data.tree)) {
                                                widget.handleTemplateError(filename, errorMessage);
                                                break;
                                            }
                                        }
                                    }
                                };
                            });
                        }, 10);
                    }
                }

                return res;
            };

            // MutationObserver を使ってあらゆる場所でのエラーダイアログの表示を監視 (二重の安全策)
            const errorDialogObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of Array.from(mutation.addedNodes)) {
                        if (node instanceof HTMLElement) {
                            const findAndReplaceText = (targetNode: Node) => {
                                if (targetNode.nodeType === Node.TEXT_NODE) {
                                    const text = targetNode.nodeValue || "";
                                    if (text.includes("[PromptTemplateError]")) {
                                        const match = text.match(/\[PromptTemplateError\] In file '([^']+)': (.*)/);
                                        if (match) {
                                            const filename = match[1];
                                            const errorMessage = match[2];
                                            const parent = targetNode.parentNode as HTMLElement;
                                            if (parent && parent.tagName !== "A" && !parent.dataset.templated) {
                                                parent.dataset.templated = "true";
                                                const targetText = `In file '${filename}'`;
                                                const linkHTML = `In file '<a href="#" class="monaco-template-error-link" style="color: #58a6ff; text-decoration: underline; cursor: pointer;">${filename}</a>'`;
                                                parent.innerHTML = parent.innerHTML.replace(targetText, linkHTML);

                                                const links = parent.querySelectorAll(".monaco-template-error-link");
                                                links.forEach((link: any) => {
                                                    link.onclick = (e: MouseEvent) => {
                                                        e.preventDefault();
                                                        try { app.ui.dialog.close(); } catch (err) {}
                                                        
                                                        // ダイアログの閉じるボタンをシミュレート
                                                        const closeBtn = document.querySelector(".p-dialog-header-close, .comfy-modal-close") as HTMLElement;
                                                        if (closeBtn) {
                                                            closeBtn.click();
                                                        } else {
                                                            const dialogs = document.querySelectorAll(".p-dialog, .comfy-modal");
                                                            dialogs.forEach((d: any) => d.style.display = "none");
                                                        }

                                                        const nodes = app.graph._nodes || [];
                                                        for (const node of nodes) {
                                                            const nodeType = node.type || node.comfyClass;
                                                            if (nodeType === "WebuiMonacoPromptMultiText" && node.multitext_widget) {
                                                                const widget = node.multitext_widget;
                                                                const hasFile = (items: any[]): boolean => {
                                                                    for (const item of items) {
                                                                        if (item.type === 'file') {
                                                                            const path = widget.getItemPath(item.id);
                                                                            const pathNoExt = path.slice(0, path.lastIndexOf('.'));
                                                                            if (path === filename || pathNoExt === filename || item.name === filename) {
                                                                                return true;
                                                                            }
                                                                        } else if (item.children) {
                                                                            if (hasFile(item.children)) return true;
                                                                        }
                                                                    }
                                                                    return false;
                                                                };

                                                                if (hasFile(widget.data.tree)) {
                                                                    widget.handleTemplateError(filename, errorMessage);
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                    };
                                                });
                                            }
                                        }
                                    }
                                } else {
                                    for (let child of Array.from(targetNode.childNodes)) {
                                        findAndReplaceText(child);
                                    }
                                }
                            };
                            findAndReplaceText(node);
                        }
                    }
                }
            });
            errorDialogObserver.observe(document.body, { childList: true, subtree: true });

            isInternalSyncing = false;
        },
        nodeCreated(node:any) {
            hookNodeWidgets(node)
            const nodeType = node.type || node.comfyClass;
            if (nodeType === "WebuiMonacoPromptMultiText") {
                multiTextNodes.add(node);
                const originalOnRemoved = node.onRemoved;
                node.onRemoved = function() {
                    if (originalOnRemoved) originalOnRemoved.apply(this, arguments);
                    multiTextNodes.delete(node);
                }
            }
            const customNode = CustomNodeFromNodeType[nodeType]
            if (customNode) customNode.widget.fromNode(app, node)
        },
    })

    if (app.extensionManager && app.extensionManager.registerSidebarTab) {
        app.extensionManager.registerSidebarTab({
            id: "webuimonacoprompt-search",
            icon: "pi pi-search",
            title: FindWidget.SidebarTitle,
            tooltip: FindWidget.SidebarTooltip,
            type: "custom",
            render: (el: HTMLElement) => {
                FindWidget.sidebar(app, el)
            },
        })
    }
}

if (app) register(app)
