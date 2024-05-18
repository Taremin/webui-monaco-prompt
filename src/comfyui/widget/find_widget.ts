
import * as utils from "../utils"
import { link } from "../link"
import * as Monaco from 'monaco-editor/esm/vs/editor/editor.api' // for typing

import {default as style} from "./index.css"

interface FindWidgetElements {
    header: HTMLDivElement
    inputContainer: HTMLDivElement
    input: HTMLInputElement
    container: HTMLDivElement
    tableContainer: HTMLDivElement
    table: HTMLTableElement
    tbody: HTMLTableSectionElement
    thead: HTMLTableSectionElement
}
type LitegraphNode = any

class FindWidget {
    _app: any
    _onNodeCreatedOriginal?: any
    elements: FindWidgetElements
    isInitialized: boolean

    constructor(app: any) {
        this._app = app
        this.elements = {} as FindWidgetElements
        this.isInitialized = false
    }
    static fromNodeType(app:any, nodeType: any) {
        const widget = new this(app)

        widget._onNodeCreatedOriginal = nodeType.prototype.onNodeCreated
        nodeType.prototype.onNodeCreated = function(this: LitegraphNode) {
            widget.onNodeCreated(this)
            widget.isInitialized = true
            this.find = widget
        }
    }
    static fromNode(app: any, node: LitegraphNode) {
        const widget = new this(app)

        widget.onNodeCreated(node)
        widget.isInitialized = true
        node.find = widget
    }
    onNodeCreated(node: LitegraphNode) {
        this.callOriginalCallback.apply(node, arguments as any)
        this.initializeWidget(node)
    }
    callOriginalCallback() {
        if (this._onNodeCreatedOriginal) {
            this._onNodeCreatedOriginal.apply(this, arguments)
        }
    }
    initializeWidget(node: LitegraphNode) {
        // custom widget
        const containerEl = this.elements.container = document.createElement("div")
        containerEl.classList.add(style["webui-monaco-prompt-container"])

        this.createWidgetHeader()
        this.createWidgetBody()

        const widget = node.addDOMWidget("webui-monaco-prompt-find", "webui-monaco-prompt-find-widget", containerEl, {})
        widget.containerEl = containerEl
    }
    createWidgetBody() {
        const tableContainerEl = this.elements.tableContainer = document.createElement("div")
        tableContainerEl.classList.add(style["webui-monaco-prompt-table-container"])

        const tableEl = this.elements.table = document.createElement("table")
        tableEl.classList.add(style["webui-monaco-prompt-table"])

        const theadEl = this.elements.thead =  document.createElement("thead")
        tableEl.appendChild(theadEl)
        theadEl.innerHTML = `
            <th class="${style["webui-monaco-prompt-td"]}">ID</th>
            <th class="${style["webui-monaco-prompt-td-expand"]}">Title</th>
            <th class="${style["webui-monaco-prompt-td"]}">Pos</th>
        `
        
        const tbodyEl = this.elements.tbody = document.createElement("tbody")
        tableEl.appendChild(tbodyEl)

        tableContainerEl.appendChild(tableEl)

        const containerEl = this.elements.container
        containerEl.appendChild(tableContainerEl)
    }

    createWidgetHeader() {
        const headEl = this.elements.header = document.createElement("div")
        headEl.classList.add(style["webui-monaco-prompt-header"])

        const inputContainerEl = this.elements.inputContainer = document.createElement("div")
        inputContainerEl.classList.add(style["webui-monaco-prompt-input"])

        const inputEl = this.elements.input = document.createElement("input")
        inputEl.type = "text"
        inputEl.placeholder = "Find"
        inputEl.classList.add(style["webui-monaco-prompt-input-text"])
        inputEl.addEventListener("keydown", (ev) => {
            return this.findInputHandler(ev)
        })
        inputContainerEl.appendChild(inputEl)
        
        const controlsEl = document.createElement("div")
        controlsEl.classList.add("controls", style["webui-monaco-prompt-control"])
        controlsEl.innerHTML = `
            <div class="monaco-custom-toggle codicon codicon-case-sensitive ${style["webui-monaco-prompt-toggle"]}" style="color: inherit;"></div>
            <div class="monaco-custom-toggle codicon codicon-whole-word ${style["webui-monaco-prompt-toggle"]}" style="color: inherit;"></div>
            <div class="monaco-custom-toggle codicon codicon-regex ${style["webui-monaco-prompt-toggle"]}" style="color: inherit;"></div>
        `
        controlsEl.querySelectorAll<HTMLElement>("." + style["webui-monaco-prompt-toggle"]).forEach((element: HTMLElement) => {
            element.addEventListener("click", (ev) => {
                const cssClass = style["webui-monaco-prompt-toggle-checked"]
                element.classList.toggle(cssClass)
                element.dataset.checked = element.classList.contains(cssClass) ? "on" : "off"
            })
        })
        inputContainerEl.appendChild(controlsEl)
        headEl.appendChild(inputContainerEl)

        const containerEl = this.elements.container
        containerEl.appendChild(headEl)
    }

    findInputHandler(ev: KeyboardEvent) {
        if (ev.key !== "Enter") {
            return
        }
        this.execute()
    }

    getMatchFlags() {
        const headEl = this.elements.header as HTMLDivElement

        const matchCase = headEl.querySelector<HTMLElement>(".codicon-case-sensitive")?.dataset.checked === "on"
        const matchWordOnly = headEl.querySelector<HTMLElement>(".codicon-whole-word")?.dataset.checked === "on"
        const isRegex = headEl.querySelector<HTMLElement>(".codicon-regex")?.dataset.checked === "on"

        return {
            matchCase,
            matchWordOnly,
            isRegex,
        }
    }

    execute() {
        const inputEl = this.elements.input as HTMLInputElement
        const matchFlags = this.getMatchFlags()

        const nodeFindMatches = utils.find(inputEl.value, matchFlags.isRegex, matchFlags.matchCase, matchFlags.matchWordOnly)

        const tbodyEl = this.elements.tbody
        tbodyEl.classList.add("comfy-list-item")

        this.clearElements(tbodyEl)

        for (const nodeFindMatch of nodeFindMatches) {
            const app = this._app
            const webuiMonacoPromptId = nodeFindMatch.instanceId
            const node = link[webuiMonacoPromptId].node

            const trEl = document.createElement("tr")
            trEl.dataset.nodeId = node.id
            trEl.dataset.instanceId = "" + webuiMonacoPromptId
            trEl.dataset.startLine = "" + nodeFindMatch.match.range.startLineNumber
            trEl.dataset.startCol = "" + nodeFindMatch.match.range.startColumn

            for (const {cssClass, value, elementStyle} of [
                {
                    cssClass: style["webui-monaco-prompt-td"],
                    value: node.id,
                    elementStyle: {textAlign: "right"}, 
                },
                {
                    cssClass: style["webui-monaco-prompt-td-expand"],
                    value: node.title
                },
                {
                    cssClass: style["webui-monaco-prompt-td"],
                    value: `Ln ${nodeFindMatch.match.range.startLineNumber}, Col ${nodeFindMatch.match.range.startColumn}`,
                    elementStyle: {textAlign: "right"}, 
                },
            ]) {
                const tdEl = document.createElement("td")
                tdEl.classList.add(cssClass)
                tdEl.textContent = value
                if (elementStyle) {
                    Object.assign(tdEl.style, elementStyle)
                }
                trEl.appendChild(tdEl)
            }

            trEl.addEventListener("click", (ev) => {
                const nodeId = trEl.dataset.nodeId
                const node = app.graph.getNodeById(nodeId)
                const monaco = link[trEl.dataset.instanceId!].monaco.monaco
                const lineNumber = (trEl.dataset.startLine as unknown as number) | 0
                const column = (trEl.dataset.startCol as unknown as number) | 0

                ev.stopPropagation()

                // 描画範囲外にいるときにエディタのスクロールなどの設定が無効化されることがあるため
                // ノードが描画範囲にはいるように移動後、次の描画タイミングでスクロール等を設定
                const setPosition = () => {
                    monaco.focus()
                    monaco.setPosition({
                        lineNumber: lineNumber,
                        column: column,
                    })
                    monaco.revealLine(lineNumber, Monaco.editor.ScrollType.Immediate)
                }

                // 上記タイミングで実行するため litegraph の canvas 更新後に実行される onDrawOverlay コールバックを使用
                // コールバックでさらに requestAnimationFrame で遅延させるのは
                //   (現在) -> canvasの更新(ここで描画位置が変更されるが反映はされていない) -> 描画されている状態でスクロールなどを更新
                // とするため
                const onDrawOverlay = this._app.canvas.onDrawOverlay
                app.canvas.onDrawOverlay = function(ctx: any) {
                    if (onDrawOverlay) {
                        onDrawOverlay.apply(this, arguments)
                    }

                    requestAnimationFrame(setPosition)

                    app.canvas.onDrawOverlay = onDrawOverlay
                }

                // ノードが描画領域の中心にくるように移動
                app.canvas.centerOnNode(node)
                utils.setActiveNode(app, node)
            })

            tbodyEl.appendChild(trEl)
        }
    }

    clearElements(element: HTMLElement) {
        while (element.hasChildNodes()) {
            element.removeChild(element.firstChild!)
        }
    }
}

export {
    FindWidget,
    FindWidgetElements,
}