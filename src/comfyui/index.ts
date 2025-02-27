import * as utils from "./utils"
import * as WebuiMonacoPrompt from "../index" // for typing
import { link } from "./link"
import { FindWidget, ReplaceWidget } from "./widget"
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
        models.forEach(model => {
            const label = typeof model === "string" ? model : model.name
            items.push({
                label: label,
                kind: WebuiMonacoPrompt.CompletionItemKind.File,
                insertText: label,
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

await refreshCSV()
await loadSetting()

function onCreateTextarea(textarea: HTMLTextAreaElement, node: any) {
    if (textarea.readOnly) {
        console.log("[WebuiMonacoPrompt] Skip: TextArea is read-only:", textarea)
        return
    }

    const editor = new MonacoPrompt.PromptEditor(textarea, {
        autoLayout: true,
        handleTextAreaValue: true,
    })
    for(const {keybinding, model} of models) {
        editor.addCustomSuggest(model)
    }
    editor.addCustomSuggest("snippet")

    // style 同期
    const observer = new MutationObserver((mutations, observer) => {
        for (const mutation of mutations) {
            if (mutation.target !== textarea) {
                continue
            }
            editor.style.cssText = (mutation.target as HTMLTextAreaElement).style.cssText
        }
    })
    observer.observe(textarea, {
        attributes: true,
        attributeFilter: ["style"]
    })
    editor.style.cssText = textarea.style.cssText

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

    editor.addEventListener('keydown', (ev: KeyboardEvent) => {
        switch (ev.key) {
            case 'Esc':
            case 'Escape':
                ev.stopPropagation()
                break
            default:
                break
        }
    })
    const mouseHandler = (ev: MouseEvent) => {
        const id = (ev.target as typeof editor).dataset.webuiMonacoPromptTextareaId!
        const node = link[id].node
        utils.setActiveNode(app, node)
    }
    editor.addEventListener("contextmenu", mouseHandler, {capture: true})
    editor.addEventListener("click", mouseHandler, {capture: true})

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
        if (widget.element instanceof HTMLTextAreaElement) {
            onCreateTextarea(widget.element, node)
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
        widget: FindWidget,
    },
    replace: {
        nodeType: "WebuiMonacoPromptReplace",
        widget: ReplaceWidget,
    },
}

const CustomNodeFromNodeType = Object.fromEntries(
    Object.entries(CustomNode).map(([key, value]) => {
        return [value.nodeType, value]
    })
)

// 既存ノードの textarea 置き換えと検索ノードの初期化
for (const node of app.graph._nodes) {
    // textarea 置き換え
    hookNodeWidgets(node)

    // 検索ノード初期化
    /*
    const nodeTypes: {[key: string]: CustomNodeWidget} = {}
    const keys = Object.keys(CustomNode) as (keyof typeof CustomNode)[]
    keys.forEach((type: keyof typeof CustomNode) => {
        nodeTypes[CustomNode[type].nodeType] = CustomNode[type]
    })
    if (nodeTypes[node.type] && nodeTypes[node.type].widget) {
        console.log("widget:", node.type, node)
        nodeTypes[node.type].widget.fromNode(app, node)
    }
    */
    const customNode = CustomNodeFromNodeType[node.comfyClass]
    if (!customNode) {
        continue
    }
    customNode.widget.fromNode(app, node)
}

// これから追加されるノードの設定
const register = (app: any) => {
    //const classNames = Object.values(CustomNode).map(node => node.nodeType)
    app.registerExtension({
        name: ["Taremin", "WebuiMonacoPrompt"].join('.'),
        nodeCreated(node:any, app: any) {
            // 既存ノードの widget 置き換え(textarea)
            hookNodeWidgets(node)

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
register(app)
