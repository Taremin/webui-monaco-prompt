import * as utils from "../utils"
import { ui } from "../api"
import { link } from "../link"
import * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import * as WebuiMonacoPrompt from "../../index"
import { WebuiMonacoPromptAdapter, PromptEditor, ExtraModel } from "../types"

// 今回のノードの内部データ構造（WorkflowにJSON化して保存）
interface MultiTextData {
    files: {
        [filename: string]: {
            content: string
        }
    }
    activeFile?: string
    openedFiles?: string[]
}

class MultiTextWidget {
    _app: any
    _onNodeCreatedOriginal?: any
    elements: {
        container?: HTMLDivElement
        sidebar?: HTMLDivElement
        fileList?: HTMLUListElement
        addBtn?: HTMLButtonElement
        editorContainer?: HTMLDivElement
        tabsContainer?: HTMLDivElement
    }
    isInitialized: boolean
    private isApplyingData: boolean = false
    editorInstance?: PromptEditor
    models: { [filename: string]: Monaco.editor.ITextModel }
    data: MultiTextData
    node: any

    constructor(app: any, node: any) {
        this._app = app
        this.node = node
        console.log("[MultiText] Constructor called", !!node)
        
        this.elements = {}
        this.isInitialized = false
        this.isApplyingData = false
        this.models = {}
        // 初期状態は最小限。onConfigure または widgets_values からのロードを待つ
        this.data = { files: { "default.txt": { content: "" } }, activeFile: "default.txt" }

        if (node) {
            node.multitext_widget = this
            if (!node.properties) node.properties = {}
            this.initializeWidget(node)

            const originalOnRemoved = node.onRemoved
            node.onRemoved = () => {
                if (originalOnRemoved) {
                    originalOnRemoved.apply(node, arguments as any)
                }
                this.onRemoved()
            }
        }
    }

    static fromNodeType(app: any, nodeType: any) {
        const _onNodeCreatedOriginal = nodeType.prototype.onNodeCreated
        nodeType.prototype.onNodeCreated = function(this: any) {
            if (_onNodeCreatedOriginal) {
                _onNodeCreatedOriginal.apply(this, arguments as any)
            }
            if (!this.multitext_widget) {
                new MultiTextWidget(app, this)
            }
        }
    }

    static fromNode(app: any, node: any) {
        return new this(app, node)
    }

    initializeWidget(node: any) {
        // インスタンス側でも onConfigure をフックして確実にロードされるようにする
        const self = this;
        const originalOnConfigure = node.onConfigure;
        node.onConfigure = function(info: any) {
            if (originalOnConfigure) originalOnConfigure.apply(this, arguments);
            console.log("[MultiText] Instance onConfigure called", info ? "with info" : "no info");
            self.loadDataFromWidget(info);
        };

        // コンテナの構築
        const containerEl = this.elements.container = document.createElement("div")
        containerEl.style.display = "flex"
        containerEl.style.flexDirection = "row"
        containerEl.style.width = "100%"
        containerEl.style.height = "100%"
        containerEl.style.fontFamily = "sans-serif"
        containerEl.style.backgroundColor = "#1e1e1e"

        // サイドバー（ファイルリスト）
        const sidebarEl = this.elements.sidebar = document.createElement("div")
        sidebarEl.style.width = "150px"
        sidebarEl.style.borderRight = "1px solid #444"
        sidebarEl.style.display = "flex"
        sidebarEl.style.flexDirection = "column"
        sidebarEl.style.padding = "5px"
        sidebarEl.style.userSelect = "none"

        const addBtn = this.elements.addBtn = document.createElement("button")
        addBtn.textContent = "+ New Text"
        addBtn.style.marginBottom = "5px"
        addBtn.style.cursor = "pointer"
        addBtn.style.backgroundColor = "#333"
        addBtn.style.color = "#fff"
        addBtn.style.border = "none"
        addBtn.style.padding = "4px"
        addBtn.onclick = () => this.createNewFile()
        sidebarEl.appendChild(addBtn)

        const fileList = this.elements.fileList = document.createElement("ul")
        fileList.style.listStyle = "none"
        fileList.style.margin = "0"
        fileList.style.padding = "0"
        fileList.style.flex = "1"
        fileList.style.overflowY = "auto"
        sidebarEl.appendChild(fileList)

        // エディタ領域
        const editorWrapper = document.createElement("div")
        editorWrapper.style.flex = "1"
        editorWrapper.style.display = "flex"
        editorWrapper.style.flexDirection = "column"
        editorWrapper.style.minWidth = "0"

        const tabsContainer = this.elements.tabsContainer = document.createElement("div")
        tabsContainer.style.height = "30px"
        tabsContainer.style.background = "#252526"
        tabsContainer.style.display = "flex"
        tabsContainer.style.flexDirection = "row"
        tabsContainer.style.borderBottom = "1px solid #444"
        tabsContainer.style.overflowX = "auto"
        editorWrapper.appendChild(tabsContainer)

        const editorContainer = this.elements.editorContainer = document.createElement("div")
        editorContainer.style.flex = "1"
        editorContainer.style.position = "relative"
        editorWrapper.appendChild(editorContainer)

        containerEl.appendChild(sidebarEl)
        containerEl.appendChild(editorWrapper)

        // 標準テキストエリアウィジェットを取得または作成（データ保存用）
        let dataWidget = node.widgets?.find((w: any) => w.name === "text")
        if (!dataWidget) {
            dataWidget = node.addWidget("text", "text", JSON.stringify(this.data), () => {
                this.syncData()
            })
        }
        
        dataWidget.computeSize = () => [0, -4]
        if (dataWidget.element) {
            dataWidget.element.style.display = "none"
        }

        // 初期ロード
        console.log("[MultiText] Initial loadDataFromWidget in initializeWidget")
        this.loadDataFromWidget()

        // LiteGraphノードにDOMウィジェットを追加
        const widget = node.addDOMWidget("webui-monaco-prompt-multitext", "webui-monaco-prompt-multitext-widget", containerEl, {
            serialize: false,
            hideOnZoom: false,
        })
        widget.containerEl = containerEl
        widget.computeSize = function(width: number) {
            const h = node.size[1] - 60
            return [width, Math.max(h, 400)]
        }
        
        const originalOnResize = node.onResize
        node.onResize = (size: any) => {
            if (originalOnResize) originalOnResize.apply(node, [size])
            if (this.editorInstance) {
                this.editorInstance.handleResize()
            }
            this.syncData()
        }

        setTimeout(() => {
            if (node.size[0] < 600 || node.size[1] < 450) {
                node.setSize([600, 450])
            }
        }, 10)

        // Monaco初期化
        setTimeout(() => {
            this.initMonacoEditor()
            this.renderFileList()
            this.renderTabs()
            const firstFile = this.data.activeFile || Object.keys(this.data.files)[0]
            if (firstFile) {
                this.setActiveFile(firstFile)
            }
        }, 100)
    }

    loadDataFromWidget(info?: any) {
        console.log("[MultiText] loadDataFromWidget triggered")
        let dataStr = info?.properties?.multitext_data || this.node.properties?.multitext_data
        let source = "properties"

        if (!dataStr || dataStr === "{}") {
            if (info?.widgets_values && info.widgets_values[0]) {
                dataStr = info.widgets_values[0]
                source = "info.widgets_values"
            }
        }

        if (!dataStr || dataStr === "{}") {
            const dataWidget = this.node.widgets?.find((w: any) => w.name === "text")
            if (dataWidget && dataWidget.value && dataWidget.value !== "{}") {
                dataStr = dataWidget.value
                source = "widget"
            }
        }

        console.log(`[MultiText] Loading data from ${source}. Length: ${dataStr?.length}`)
        this.loadData(dataStr)
    }

    private loadData(dataStr?: string) {
        if (dataStr && typeof dataStr === "string" && dataStr !== "" && dataStr !== "{}") {
            try {
                const parsed = JSON.parse(dataStr)
                if (parsed && parsed.files && Object.keys(parsed.files).length > 0) {
                    // 有意義なデータがある場合のみ initialized とする
                    const hasValidContent = Object.values(parsed.files).some((f: any) => f.content && f.content.length > 0)
                    if (hasValidContent) {
                        this.isInitialized = true
                        console.log("[MultiText] Valid data found, set isInitialized = true")
                    }
                    this.data = parsed
                    console.log("[MultiText] Data loaded into this.data. Active:", this.data.activeFile)
                    
                    if (this.editorInstance) {
                        this.applyDataToModels()
                    } else {
                        console.log("[MultiText] Editor not ready, data remains in this.data for initMonacoEditor")
                    }
                }
            } catch (e) {
                console.error("Failed to parse MultiText data", e)
            }
        }
    }

    private applyDataToModels() {
        if (!this.editorInstance || this.isApplyingData) return
        this.isApplyingData = true
        console.log("[MultiText] applyDataToModels started. Files in this.data:", Object.keys(this.data.files))
        try {
            for (const filename of Object.keys(this.data.files)) {
                const content = this.data.files[filename].content
                console.log(`[MultiText]   Checking file: ${filename}, target length: ${content.length}`)
                if (this.models[filename]) {
                    const currentVal = this.models[filename].getValue()
                    if (currentVal !== content) {
                        console.log(`[MultiText]   Updating existing model: ${filename} (current len: ${currentVal.length}, new len: ${content.length})`)
                        this.models[filename].setValue(content)
                    }
                } else {
                    console.log(`[MultiText]   Creating new model for: ${filename}`)
                    this.createModel(filename, content)
                }
            }
            if (this.data.activeFile) {
                console.log("[MultiText] Setting active file:", this.data.activeFile)
                this.setActiveFile(this.data.activeFile)
            }
            console.log("[MultiText] applyDataToModels finished. Current editor value (first file):", 
                Object.keys(this.models)[0] ? this.models[Object.keys(this.models)[0]].getValue().substring(0, 50) : "no models")
        } finally {
            this.isApplyingData = false
        }
    }

    syncData() {
        if (this.isApplyingData) {
            console.log("[MultiText] syncData ignored (isApplyingData = true)")
            return
        }
        // 現在のモデルからデータを取り込む
        for (const filename of Object.keys(this.models)) {
            if (this.data.files[filename]) {
                this.data.files[filename].content = this.models[filename].getValue()
            }
        }

        const hasValidContent = Object.values(this.data.files).some(f => f.content && f.content.length > 0)
        
        if (!this.isInitialized && !hasValidContent) {
            // まだ初期化（ロード）されておらず、かつ実質的に空の場合は、既存データを破壊しないようスキップ
            console.log("[MultiText] syncData skipped (not initialized/empty)")
            return
        }

        // 有意義なコンテンツがあれば initialized とみなす
        if (!this.isInitialized && hasValidContent) {
            this.isInitialized = true
            console.log("[MultiText] Found valid content during syncData, set isInitialized = true")
        }

        const serialized = JSON.stringify(this.data)
        console.log(`[MultiText] Syncing data. Result length: ${serialized.length}`)
        
        if (this.node.properties) {
            this.node.properties.multitext_data = serialized
        }
        const dataWidget = this.node.widgets?.find((w: any) => w.name === "text")
        if (dataWidget) {
            if (serialized !== dataWidget.value) {
                dataWidget.value = serialized
            }
        }

        if (this.node.graph && this.node.graph.change) {
            this.node.graph.change()
        }
    }

    initMonacoEditor() {
        if (!this.elements.editorContainer) return
        console.log("[MultiText] initMonacoEditor started")

        const dummyTextarea = document.createElement("textarea")
        dummyTextarea.style.display = "none"
        this.elements.editorContainer.appendChild(dummyTextarea)

        const editorInst = new WebuiMonacoPrompt.PromptEditor(dummyTextarea, {
            autoLayout: true,
            handleTextAreaValue: false,
            mode: "NORMAL" as any,
        }) as any as PromptEditor

        this.elements.editorContainer.appendChild(editorInst)
        this.editorInstance = editorInst
        console.log("[MultiText] editorInstance set")
        utils.applyCommonEditorSetup(this._app, editorInst, this.node)

        editorInst.style.display = "block"
        editorInst.style.position = "absolute"
        editorInst.style.top = "0"
        editorInst.style.left = "0"
        editorInst.style.right = "0"
        editorInst.style.bottom = "0"
        editorInst.style.height = "100%"
        editorInst.style.width = "100%"

        console.log("[MultiText] Creating models for initial/loaded files:", Object.keys(this.data.files))
        this.applyDataToModels()

        editorInst.monaco.onDidChangeModelContent(() => {
            if (!this.data.activeFile) return
            const model = this.models[this.data.activeFile]
            if (model) {
                const value = model.getValue()
                if (this.data.files[this.data.activeFile].content !== value) {
                    console.log("[MultiText] Model content changed for", this.data.activeFile)
                    this.data.files[this.data.activeFile].content = value
                    this.syncData()
                }
            }
        })

        const id = editorInst.getInstanceId()
        link[id] = {
            textarea: dummyTextarea,
            monaco: editorInst,
            observer: new MutationObserver(() => {}),
            node: this.node,
        }
        console.log("[MultiText] initMonacoEditor finished")
    }

    createModel(filename: string, content: string) {
        if (this.models[filename]) return this.models[filename]
        console.log(`[MultiText] createModel: ${filename} (length: ${content.length})`)
        const language = "comfy-prompt"
        const model = Monaco.editor.createModel(content, language)
        this.models[filename] = model

        // 検索対象として登録
        if (this.editorInstance) {
            if (!this.editorInstance.extraModels) {
                this.editorInstance.extraModels = []
            }
            this.editorInstance.extraModels.push({
                filename: filename,
                model: model,
                onActivate: () => this.setActiveFile(filename)
            })
        }

        return model
    }

    createNewFile() {
        let i = 1
        let filename = `text${i}.txt`
        while (this.data.files[filename]) {
            i++
            filename = `text${i}.txt`
        }
        this.data.files[filename] = { content: "" }
        this.createModel(filename, "")
        this.syncData()
        this.renderFileList()
        this.renderTabs()
        this.setActiveFile(filename)
    }

    deleteFile(filename: string) {
        if (Object.keys(this.data.files).length <= 1) return
        
        if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
            return
        }

        delete this.data.files[filename]
        if (this.models[filename]) {
            const model = this.models[filename]
            // 検索登録から削除
            if (this.editorInstance && this.editorInstance.extraModels) {
                this.editorInstance.extraModels = this.editorInstance.extraModels.filter(m => m.model !== model)
            }
            model.dispose()
            delete this.models[filename]
        }
        
        if (this.data.openedFiles) {
            this.data.openedFiles = this.data.openedFiles.filter(f => f !== filename)
        }

        if (this.data.activeFile === filename) {
            this.data.activeFile = this.data.openedFiles?.[0] || Object.keys(this.data.files)[0]
        }
        this.syncData()
        this.renderFileList()
        this.renderTabs()
        if (this.data.activeFile) {
            this.setActiveFile(this.data.activeFile)
        }
    }

    closeTab(filename: string) {
        if (!this.data.openedFiles) return
        if (this.data.openedFiles.length <= 1) return // 最後のタブは閉じさせない（または空のモデルにする）

        this.data.openedFiles = this.data.openedFiles.filter(f => f !== filename)
        
        if (this.data.activeFile === filename) {
            this.setActiveFile(this.data.openedFiles[0])
        } else {
            this.renderTabs()
            this.syncData()
        }
    }

    setActiveFile(filename: string) {
        if (!this.data.files[filename]) {
            console.error("[MultiText] setActiveFile: File not found", filename)
            return
        }
        console.log("[MultiText] setActiveFile:", filename)
        
        // 開いているファイルリストに追加
        if (!this.data.openedFiles) {
            this.data.openedFiles = [filename]
        } else if (!this.data.openedFiles.includes(filename)) {
            this.data.openedFiles.push(filename)
        }

        this.data.activeFile = filename
        if (this.editorInstance && this.models[filename]) {
            console.log("[MultiText] Setting model to editor")
            this.editorInstance.monaco.setModel(this.models[filename])
        } else {
            console.warn("[MultiText] Cannot set model: editorInstance or model missing", !!this.editorInstance, !!this.models[filename])
        }
        this.renderFileList()
        this.renderTabs()
        this.syncData()
    }

    renderFileList() {
        if (!this.elements.fileList) return
        this.elements.fileList.innerHTML = ""
        for (const filename of Object.keys(this.data.files)) {
            const li = document.createElement("li")
            li.style.padding = "4px 8px"
            li.style.cursor = "pointer"
            li.style.color = "#ccc"
            li.style.display = "flex"
            li.style.justifyContent = "space-between"

            if (this.data.activeFile === filename) {
                li.style.backgroundColor = "#37373d"
                li.style.color = "#fff"
            }

            const nameSpan = document.createElement("span")
            nameSpan.textContent = filename
            nameSpan.onclick = () => this.setActiveFile(filename)
            li.appendChild(nameSpan)

            const delBtn = document.createElement("span")
            delBtn.textContent = "x"
            delBtn.style.color = "#777"
            delBtn.style.marginLeft = "10px"
            delBtn.onclick = (e) => {
                e.stopPropagation()
                this.deleteFile(filename)
            }
            li.appendChild(delBtn)
            this.elements.fileList.appendChild(li)
        }
    }

    renderTabs() {
        if (!this.elements.tabsContainer) return
        this.elements.tabsContainer.innerHTML = ""

        // 互換性のため、openedFiles がない場合は activeFile のみ表示するか全ファイル表示するか
        // ここでは activeFile が含まれるように openedFiles を初期化する
        if (!this.data.openedFiles || this.data.openedFiles.length === 0) {
            this.data.openedFiles = Object.keys(this.data.files)
        }

        for (const filename of this.data.openedFiles) {
            // ファイルが削除されている可能性を考慮
            if (!this.data.files[filename]) continue

            const tab = document.createElement("div")
            tab.style.padding = "4px 12px"
            tab.style.cursor = "pointer"
            tab.style.borderRight = "1px solid #444"
            tab.style.display = "flex"
            tab.style.alignItems = "center"
            
            if (this.data.activeFile === filename) {
                tab.style.backgroundColor = "#1e1e1e"
                tab.style.color = "#fff"
                tab.style.borderTop = "1px solid #007acc"
            } else {
                tab.style.backgroundColor = "#2d2d2d"
                tab.style.color = "#aaa"
            }

            const nameSpan = document.createElement("span")
            nameSpan.textContent = filename
            nameSpan.onclick = () => this.setActiveFile(filename)
            tab.appendChild(nameSpan)

            const delBtn = document.createElement("span")
            delBtn.textContent = "x"
            delBtn.style.marginLeft = "8px"
            delBtn.style.color = "#777"
            delBtn.title = "Close tab"
            delBtn.onclick = (e) => {
                e.stopPropagation()
                this.closeTab(filename)
            }
            tab.appendChild(delBtn)
            this.elements.tabsContainer.appendChild(tab)
        }
    }

    onRemoved() {
        console.log("[MultiText] onRemoved called")
        if (this.editorInstance) {
            const id = this.editorInstance.getInstanceId()
            if (link[id]) {
                const editor = this.editorInstance
                editor.dispose()
                if (editor.parentElement) {
                    editor.parentElement.removeChild(editor)
                }
                delete link[id]
                console.log(`[MultiText] Disposed editor instance ${id}`)
            }
        }
        // モデルの破棄
        for (const filename of Object.keys(this.models)) {
            this.models[filename].dispose()
        }
        this.models = {}
    }
}

export {
    MultiTextWidget
}
