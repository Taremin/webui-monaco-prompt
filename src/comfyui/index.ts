import * as utils from "./utils"
import * as WebuiMonacoPrompt from "../index" // for typing
import { link } from "./link"
import { FindWidget, ReplaceWidget } from "./widget"
import { app } from "./api"
import { loadSetting, saveSettings, updateInstanceSettings } from "./settings"

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
    const editor = new MonacoPrompt.PromptEditor(textarea, {
        autoLayout: true,
        handleTextAreaValue: true,
    })

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
        refreshComboInNodes: async function(nodeDef: any, app: any) {
            // refresh で csv一覧 リロード
            refreshCSV()
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
