import * as utils from "./utils"
import * as WebuiMonacoPrompt from "../index" // for typing
import { link } from "./link"
import { FindWidget, ReplaceWidget, MultiTextWidget, FilterWidget } from "./widget"
import { app, api } from "./api"
import { loadSetting, saveSettings, updateInstanceSettings } from "./settings"
import { comfyPrompt, comfyDynamicPrompt } from "./languages"
import { escapeHTML } from "../utils"

declare let __webpack_public_path__: any;

interface Window {
    WebuiMonacoPromptBaseURL: string
    WebuiMonacoPrompt: typeof WebuiMonacoPrompt
}
declare var window: Window

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
async function loadCSV (files: string[]) {
    MonacoPrompt.clearCSV()

    for (const filename of files) {
        if (!filename) continue
        const path = [dir, filename].join('/')
        const filenameParts = filename.split('.')
        if (filenameParts.length > 2) {
            throw new Error("Invalid filename (too many '.')")
        }
        const basename = filenameParts[0]
        const value = await fetch(path).then(res => res.text())

        MonacoPrompt.addCSV(basename, value)
    }
}

async function refreshCSV() {
    csvfiles = await fetch("/webui-monaco-prompt/csv").then(res => res.json())
    await loadCSV(csvfiles)
}


function getCSSRules(target: string[]) {
    const targetSet = new Set(target)
    const result: {[key: string]: CSSStyleDeclaration[]} = {}

    for (const  styleSheet of  document.styleSheets) {
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
const graphDialogZIndex = getZIndex(rules[".graphdialog"])

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
        if (!isReplace) {
            return
        }
    }

    if (textarea.dataset.webuiMonacoPromptTextareaId) {
        return
    }
    if (textarea.readOnly) {
        console.log("[WebuiMonacoPrompt] Skip: TextArea is read-only:", textarea)
        return
    }

    const editor = new WebuiMonacoPrompt.PromptEditor(textarea, {
        autoLayout: true,
        handleTextAreaValue: true,
    })

    // style 同期
    const observer = new MutationObserver((mutations, observer) => {
        for (const mutation of mutations) {
            if (mutation.target !== textarea) {
                continue
            }
            editor.style.cssText = styleToString((mutation.target as HTMLTextAreaElement).style, [])
        }
    })
    editor.style.zIndex = "" + (graphDialogZIndex - 1)
    observer.observe(textarea, {
        attributes: true,
        attributeFilter: ["style"]
    })
    editor.style.cssText = styleToString(textarea.style, ["display"])

    Object.assign(editor.elements.header!.style, {
        backgroundColor: "#444",
        fontSize: "small",
    })
    Object.assign(editor.elements.footer!.style, {
        backgroundColor: "#444",
        fontSize: "small",
    })
    
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

    if (textarea.parentElement) {
        textarea.parentElement.append(editor)
    }
    
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
    if (typeof(id) !== 'string') {
        return
    }

    const ctx = link[id]
    ctx.observer.disconnect()
    const editor = ctx.monaco
    editor.dispose()
    if (editor.parentElement) {
        editor.parentElement.removeChild(ctx.monaco)
    }
    delete link[id]
}

function hookNodeWidgets(node: any) {
    if (!node.widgets) {
        return
    }
    for (const widget of node.widgets) {
        if (!widget.element) {
            continue
        }
        // Skip hooking the internal data widget for MultiText node
        if (node.comfyClass === "WebuiMonacoPromptMultiText" && widget.name === "text") {
            continue
        }
        if (widget.element instanceof HTMLTextAreaElement) {
            const isReplace = app.ui.settings.getSettingValue("WebuiMonacoPrompt.ReplaceTextarea")
            if (isReplace) {
                onCreateTextarea(widget.element, node, true)
            }
        }
    }
    const onRemovedOriginal = node.onRemoved
    node.onRemoved = function() {
        if (onRemovedOriginal) {
            onRemovedOriginal.apply(this, arguments)
        }

        for (const widget of node.widgets) {
            if (!widget.element) {
                continue
            }
            if (node.comfyClass === "WebuiMonacoPromptMultiText" && widget.name === "text") {
                continue
            }
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
    find: {
        nodeType: "WebuiMonacoPromptFind",
        widget: FindWidget as any,
    },
    replace: {
        nodeType: "WebuiMonacoPromptReplace",
        widget: ReplaceWidget as any,
    },
    multitext: {
        nodeType: "WebuiMonacoPromptMultiText",
        widget: MultiTextWidget as any,
    },
    json_filter: {
        nodeType: "WebuiMonacoPromptJsonFilter",
        widget: class {
            static fromNode(app: any, node: any) {
                const rulesWidget = node.widgets.find((w: any) => w.name === "rules");
                if (rulesWidget) {
                    rulesWidget.type = "hidden";
                    
                    // シリアライズ処理の直前に呼ばれる
                    rulesWidget.beforeQueued = function() {
                        const rules = node.properties.rules || [];
                        console.log(`[FilterWidget] beforeQueued - Syncing rules objects to widget:`, rules);
                        this.value = rules;
                    };

                    // シリアライズ時に値を供給する
                    rulesWidget.serializeValue = function() {
                        const rules = node.properties.rules || [];
                        console.log(`[FilterWidget] serializeValue called - returning:`, rules);
                        return rules;
                    };
                }
                const filterWidget = new FilterWidget(node);
                const domWidget = node.addDOMWidget("webui-monaco-prompt-filter", "filter", filterWidget.container, {
                    hideOnZoom: true,
                    serialize: false,
                });
                
                // サイズ計算のフック
                (domWidget as any)._node = node;
                (domWidget as any).computeSize = function(this: any, width: number) {
                    const n = this._node || node;
                    if (!n || !n.size) return [width, 200];
                    const outputHeight = n.outputs ? n.outputs.length * 20 : 0;
                    const targetHeight = Math.max(50, n.size[1] - 36 - outputHeight);
                    return [width, targetHeight];
                };
            }
        } as any,
    },
}

const CustomNodeFromNodeType = Object.fromEntries(
    Object.entries(CustomNode).map(([key, value]) => {
        return [value.nodeType, value]
    })
)


// これから追加されるノードの設定
const register = (app: any) => {
    const multiTextNodes = new Set<any>()
    app.registerExtension({
        name: ["Taremin", "WebuiMonacoPrompt"].join('.'),
        async beforeRegisterNodeDef(nodeType: any, nodeData: any, app: any) {
            const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
            nodeType.prototype.getExtraMenuOptions = function(canvas: any, options: any[]) {
                if (originalGetExtraMenuOptions) {
                    originalGetExtraMenuOptions.apply(this, arguments);
                }

                if (multiTextNodes.size > 0) {
                    options.push({
                        content: "Add to MultiText",
                        has_submenu: true,
                        callback: (value: any, options: any, e: MouseEvent, menu: any, node: any) => {
                            const targetNodes = Array.from(multiTextNodes);
                            const submenu = new (window as any).LiteGraph.ContextMenu(
                                targetNodes.map((tn: any) => ({
                                    content: `#${tn.id}: ${tn.title || tn.type}`,
                                    callback: () => {
                                        const selectedNodes = Object.values(app.canvas.selected_nodes);
                                        for (const sn of selectedNodes as any[]) {
                                            // 複数のウィジェットがある可能性があるが、最初の HTMLTextAreaElement を持つものを対象とする
                                            const widget = sn.widgets?.find((w: any) => w.element instanceof HTMLTextAreaElement);
                                            const text = widget ? widget.value : "";
                                            if (tn.multitext_widget) {
                                                tn.multitext_widget.addItemWithName('file', sn.title || sn.type, null, text);
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
            const addSetting = (id: string, name: string, type: string, defaultValue: any, tooltip?: string, options?: any) => {
                const settingDefinition: any = {
                    id,
                    name,
                    type,
                    defaultValue,
                    tooltip,
                    onChange: (value: any) => {
                        const map: Record<string, string> = {
                            "WebuiMonacoPrompt.Minimap": "minimap",
                            "WebuiMonacoPrompt.LineNumbers": "lineNumbers",
                            "WebuiMonacoPrompt.ReplaceUnderscore": "replaceUnderscore",
                            "WebuiMonacoPrompt.KeyBindings": "mode",
                            "WebuiMonacoPrompt.Theme": "theme",
                            "WebuiMonacoPrompt.Language": "language",
                            "WebuiMonacoPrompt.ShowHeader": "showHeader",
                            "WebuiMonacoPrompt.FontSize": "fontSize",
                            "WebuiMonacoPrompt.FontFamily": "fontFamily",
                            "WebuiMonacoPrompt.CsvToggle": "csvToggle",
                        }
                        const key = map[id]
                        if (key) {
                            WebuiMonacoPrompt.runAllInstances((instance) => {
                                instance.setSettings({ [key]: value }, true)
                            })
                        }
                    }
                }
                if (options) {
                    Object.assign(settingDefinition, options)
                }
                app.ui.settings.addSetting(settingDefinition)
            }

            addSetting("WebuiMonacoPrompt.ShowHeader", "Show Header", "boolean", false, "Show the Monaco Editor header")
            addSetting("WebuiMonacoPrompt.Minimap", "Show Minimap", "boolean", true, "Show the Monaco Editor minimap")
            addSetting("WebuiMonacoPrompt.LineNumbers", "Show Line Numbers", "boolean", true, "Show line numbers")
            addSetting("WebuiMonacoPrompt.ReplaceUnderscore", "Replace Underscore", "boolean", false, "Replace underscores with spaces in autocomplete")
            addSetting("WebuiMonacoPrompt.FontSize", "Font Size", "slider", 12, "Font size of the editor", { attrs: { min: 8, max: 48, step: 1 } })
            addSetting("WebuiMonacoPrompt.FontFamily", "Font Family", "text", "", "Font family of the editor")
            addSetting("WebuiMonacoPrompt.Language", "Language", "combo", "comfy-prompt", "Default language", { options: MonacoPrompt.getLanguages() })
            addSetting("WebuiMonacoPrompt.KeyBindings", "Key Bindings", "combo", "VIM", "Keybindings", { options: ["NORMAL", "VIM"] })
            addSetting("WebuiMonacoPrompt.Theme", "Theme", "combo", "vsc-dark", "Theme", { options: ["vs", "vs-dark", "hc-black", "hc-light"] })
            addSetting("WebuiMonacoPrompt.CsvToggle", "CSV Toggle", "hidden", {})

            await refreshCSV()
            await loadSetting()

            // hook refresh button
            if (app.refreshComboInNodes) {
                const originalRefreshComboInNodes = app.refreshComboInNodes
                app.refreshComboInNodes = async function() {
                    const res = originalRefreshComboInNodes.apply(this, arguments)
                    await refreshCSV()
                    await loadSetting()
                    return res
                }
            }

            // 既存ノードの textarea 置き換えと検索ノードの初期化
            const nodes = app.graph._nodes
            if (app.graph.subgraphs) {
                for (const [k, v] of app.graph.subgraphs.entries()) {
                    nodes.push(...v._nodes)
                }
            }
            for (const node of nodes) {
                // textarea 置き換え
                hookNodeWidgets(node)

                // MultiTextキャッシュ管理
                if (node.comfyClass === "WebuiMonacoPromptMultiText") {
                    multiTextNodes.add(node);
                    const originalOnRemoved = node.onRemoved;
                    node.onRemoved = function() {
                        if (originalOnRemoved) originalOnRemoved.apply(this, arguments);
                        multiTextNodes.delete(node);
                    }
                }

                // 検索ノード初期化
                const customNode = CustomNodeFromNodeType[node.comfyClass]
                if (customNode) {
                    customNode.widget.fromNode(app, node)
                }
            }

            const observer = new MutationObserver((mutations, observer) => {
                for (const mutation of mutations) {
                    if (mutation.type !== "childList") {
                        continue
                    }
                    for (const node of mutation.addedNodes) {
                        if (!(node instanceof HTMLTextAreaElement)) {
                            continue
                        }
                        const id = node.dataset.webuiMonacoPromptTextareaId
                        if (!id) {
                            continue
                        }
                        if (!node.parentNode) {
                            continue
                        }
                        const parent = node.parentElement
                        if (!parent) {
                            continue
                        }
                        if (parent.contains(link[id].monaco)) {
                            continue
                        }
                        parent.append(link[id].monaco)
                    }
                }
            })
            const canvasContainer = document.getElementById("graph-canvas-container")
            if (canvasContainer) {
                observer.observe(canvasContainer, {
                    subtree: true,
                    childList: true
                })
            }

            app.ui.settings.addSetting({
                id: "WebuiMonacoPrompt.ReplaceTextarea",
                name: "Replace Textarea",
                type: "boolean",
                default: true,
                onChange: (value: boolean) => {
                    const nodes = app.graph._nodes
                    if (app.graph.subgraphs) {
                        for (const [k, v] of app.graph.subgraphs.entries()) {
                            nodes.push(...v._nodes)
                        }
                    }
                    for (const node of nodes) {
                        if (!node.widgets) continue;
                        for (const widget of node.widgets) {
                            if (node.comfyClass === "WebuiMonacoPromptMultiText" && widget.name === "text") {
                                continue;
                            }
                            if (widget.element instanceof HTMLTextAreaElement) {
                                if (value) {
                                    onCreateTextarea(widget.element, node, true);
                                } else {
                                    onRemoveTextarea(widget.element);
                                }
                            }
                        }
                    }
                },
            });

            // setup完了に伴い、すでに追加されたエディタへ設定を遅延適用する
            WebuiMonacoPrompt.runAllInstances((instance) => {
                updateInstanceSettings(instance);
            });
        },
        nodeCreated(node:any, app: any) {
            // 既存ノードの widget 置き換え(textarea)
            hookNodeWidgets(node)

            // MultiTextキャッシュ管理
            if (node.comfyClass === "WebuiMonacoPromptMultiText") {
                multiTextNodes.add(node);
                const originalOnRemoved = node.onRemoved;
                node.onRemoved = function() {
                    if (originalOnRemoved) originalOnRemoved.apply(this, arguments);
                    multiTextNodes.delete(node);
                }
            }

            // Find / Replace widget
            const customNode = CustomNodeFromNodeType[node.comfyClass]
            if (!customNode) {
                return
            }
            customNode.widget.fromNode(app, node)
        },
        // refresh button
        refreshComboInNodes: async function(nodeDef: any, app: any) {
            refreshCSV()
            refreshSnippets()
        }
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

// 登録実行
if (app) {
    register(app)
} else {
    console.error("ComfyUI app instance not found")
}
