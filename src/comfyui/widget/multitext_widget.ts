import * as utils from "../utils"
import { ui } from "../api"
import { link } from "../link"
import * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import * as WebuiMonacoPrompt from "../../index"
import { WebuiMonacoPromptAdapter, PromptEditor, ExtraModel } from "../types"
import { default as style } from "./index.css"

const getStyle = (name: string) => utils.getStyle(style, name)

// 今回のノードの内部データ構造（WorkflowにJSON化して保存）
// ツリー構造のアイテム定義
interface TreeItem {
    id: string; // 内部管理用の一意識別子
    name: string;
    type: 'file' | 'folder';
    content?: string; // type === 'file' の場合のみ
    children?: TreeItem[]; // type === 'folder' の場合のみ
    expanded?: boolean;
    parent?: TreeItem; // 実行時の親参照（非永続）
}

interface MultiTextData {
    tree: TreeItem[];
    activeFileId?: string;
    openedFileIds?: string[];
    sidebarWidth?: number;
}

class MultiTextWidget {
    _app: any
    _onNodeCreatedOriginal?: any

    private static ICONS = {
        arrowRight: '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M6 12.7l.7.7 4.4-4.4L6.7 4.6l-.7.7 3.7 3.7L6 12.7z"/></svg>',
        arrowDown: '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M4.6 6.7l.7-.7 3.7 3.7 3.7-3.7.7.7-4.4 4.4L4.6 6.7z"/></svg>',
        folder: '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M14.5 3H7.71l-2-2H1.5c-.83 0-1.5.67-1.5 1.5v9c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm.5 8.5c0 .28-.22.5-.5.5h-13c-.28 0-.5-.22-.5-.5v-9c0-.28.22-.5.5-.5h4.21l2 2H14.5c.28 0 .5.22.5.5v7z"/></svg>',
        file: '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M14 4.5V14c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1V2c0-.55.45-1 1-1h5.5L14 4.5zM13 5h-4V1h4v4z"/></svg>',
        addFile: '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M14 4.5V14c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1V2c0-.55.45-1 1-1h5.5L14 4.5zM13 5h-4V1h4v4zM8 7H7v1H6v1h1v1h1V9h1V8H8V7z"/></svg>',
        addFolder: '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M14.5 3H7.71l-2-2H1.5c-.83 0-1.5.67-1.5 1.5v9c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-5.5 5h-1v1h-1v-1h-1v-1h1v-1h1v1h1v1z"/></svg>',
        edit: '<svg width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59V15h1.41l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2 14v-.66l2.13-1.22 1.88 1.88-1.22 2.13H2v-.13zm4.27-1.73l-1.54-1.54 7.27-7.27 1.54 1.54-7.27 7.27z"/></svg>',
        delete: '<svg width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" d="M11 1.5V1h-6v.5H2v1h1v11l1 1h8l1-1V2.5h1v-1h-3zm1 12H4v-11h8v11zM5 4h1v8H5V4zm3 0h1v8H8V4z"/></svg>',
        search: '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zm-5.442 1.102a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z"/></svg>',
    }

    elements: {
        container?: HTMLDivElement;
        sidebar?: HTMLDivElement;
        treeContainer?: HTMLDivElement;
        addFileBtn?: HTMLButtonElement;
        addFolderBtn?: HTMLButtonElement;
        tabsContainer?: HTMLDivElement;
        editorContainer?: HTMLDivElement;
        resizer?: HTMLDivElement;
        searchBtn?: HTMLButtonElement;
        searchContainer?: HTMLDivElement;
        searchInput?: HTMLInputElement;
        searchResults?: HTMLDivElement;
    } = {};

    public data: MultiTextData = { tree: [], activeFileId: undefined, openedFileIds: [], sidebarWidth: 150 };
    private editor: any;
    private models: { [id: string]: Monaco.editor.ITextModel } = {};
    private lastSelectedId: string | null = null;
    private _selectedIds: Set<string> = new Set();
    private editingId: string | null = null; // 現在編集中のアイテムID

    private syncModels() {
        if (!this.editor) return;
        if (!this.editor.extraModels) this.editor.extraModels = [];

        const existingIds = new Set<string>();
        const traverse = (items: TreeItem[]) => {
            for (const item of items) {
                if (item.type === 'file') {
                    existingIds.add(item.id);
                    if (!this.models[item.id]) {
                        // 設定から言語を取得し、取得できない場合は "comfy-prompt" にフォールバック
                        const appRef = (window as any).app || ((window as any).comfyAPI && (window as any).comfyAPI.app) || (window as any).ComfyApp;
                        const configuredLanguage = appRef?.ui?.settings?.getSettingValue?.("WebuiMonacoPrompt.Language") || "comfy-prompt";
                        this.models[item.id] = Monaco.editor.createModel(item.content || "", configuredLanguage);
                        this.models[item.id].onDidChangeContent(() => {
                            item.content = this.models[item.id].getValue();
                            this.commitData();
                        });
                        this.editor.extraModels.push({
                            id: item.id,
                            filename: item.name,
                            model: this.models[item.id],
                            onActivate: () => {
                                this.openFile(item.id);
                            },
                            decorationIds: []
                        });
                    } else {
                        if (this.models[item.id].getValue() !== (item.content || "")) {
                            this.models[item.id].setValue(item.content || "");
                        }
                    }
                }
                if (item.children) traverse(item.children);
            }
        };
        traverse(this.data.tree);

        for (const id in this.models) {
            if (!existingIds.has(id)) {
                this.editor.extraModels = this.editor.extraModels.filter((m: any) => m.model !== this.models[id]);
                this.models[id].dispose();
                delete this.models[id];
            }
        }
    }

    constructor(app: any) {
        this._app = app
    }

    static fromNode(app: any, node: any) {
        if (node.widgets && node.widgets.some((w: any) => w.name === "webui-monaco-prompt-multitext")) {
            return; // 既に生成済みの場合は重複を避ける
        }
        const widget = new MultiTextWidget(app)
        widget.initializeWidget(node)
    }

    private initializeWidget(node: any) {
        (this as any)._node = node;
        (node as any).multitext_widget = this;
        const self = this;

        // Python側で定義された不要なウィジェットを探して隠し、位置を物理的にリセットする
        node.widgets?.forEach((w: any) => {
            if (w.name === "text" || w.name === "tree_data") {
                w.type = "hidden";
                w.last_y = 2; // 極小値でリセット
                w.computeSize = () => [0, 0]; // 正常なゼロ
                if (w.element) {
                    w.element.style.display = "none";
                    w.element.style.top = "0px";
                }
            }
        });
        
        const onConfigure = node.onConfigure;
        node.onConfigure = function(info: any) {
            if (onConfigure) onConfigure.apply(this, arguments);
            self.loadDataFromWidget(info);
        };

        const onRemoved = node.onRemoved;
        node.onRemoved = function() {
            if (onRemoved) {
                onRemoved.apply(this, arguments);
            }
            self.onRemoved();
        };

        // コンテナの構築
        const containerEl = this.elements.container = document.createElement("div")
        containerEl.className = getStyle("webui-monaco-prompt-multitext-container")
        containerEl.style.display = "flex"
        containerEl.style.flexDirection = "row"
        containerEl.style.width = "100%"
        containerEl.style.height = "100%"
        containerEl.style.backgroundColor = "#1e1e1e"
        containerEl.style.zIndex = "1000" // 確実に最前面
        containerEl.style.pointerEvents = "auto"
        containerEl.style.position = "absolute" // 追加
        containerEl.style.top = "0px"           // 追加

        // サイドバー
        const sidebarEl = this.elements.sidebar = document.createElement("div")
        sidebarEl.className = getStyle("webui-monaco-prompt-multitext-sidebar")
        
        const toolbar = document.createElement("div")
        toolbar.className = getStyle("webui-monaco-prompt-multitext-sidebar-toolbar")

        const addFileBtn = this.elements.addFileBtn = document.createElement("button")
        toolbar.className = getStyle("webui-monaco-prompt-multitext-sidebar-toolbar")
        sidebarEl.appendChild(toolbar)

        this.elements.addFileBtn = this.createToolbarButton(MultiTextWidget.ICONS.addFile, "New File", () => this.addItem('file'));
        this.elements.addFolderBtn = this.createToolbarButton(MultiTextWidget.ICONS.addFolder, "New Folder", () => this.addItem('folder'));
        this.elements.searchBtn = this.createToolbarButton(MultiTextWidget.ICONS.search, "Search", () => this.toggleSearch());
        
        toolbar.appendChild(this.elements.addFileBtn);
        toolbar.appendChild(this.elements.addFolderBtn);
        toolbar.appendChild(this.elements.searchBtn);

        // 検索コンテナ
        const searchContainer = this.elements.searchContainer = document.createElement("div")
        searchContainer.className = getStyle("webui-monaco-prompt-multitext-sidebar-search")
        searchContainer.style.display = "none" // 初期状態は非表示
        
        const searchInput = this.elements.searchInput = document.createElement("input")
        searchInput.type = "text"
        searchInput.placeholder = "Search content..."
        searchInput.className = getStyle("webui-monaco-prompt-multitext-search-input")
        searchInput.addEventListener("input", () => this.executeSearch())
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this.executeSearch()
            if (e.key === "Escape") this.toggleSearch()
        })
        
        const searchResults = this.elements.searchResults = document.createElement("div")
        searchResults.className = getStyle("webui-monaco-prompt-multitext-search-results")
        searchResults.style.display = "none"
        
        searchContainer.appendChild(searchInput)
        sidebarEl.appendChild(searchContainer)
        sidebarEl.appendChild(searchResults)

        const treeContainer = this.elements.treeContainer = document.createElement("div")
        treeContainer.className = getStyle("webui-monaco-prompt-multitext-tree-container")
        treeContainer.style.flex = "1"
        treeContainer.style.overflowY = "auto"
        sidebarEl.appendChild(treeContainer)

        // エディタ領域
        const editorWrapper = document.createElement("div")
        editorWrapper.className = getStyle("webui-monaco-prompt-multitext-main-area")
        editorWrapper.style.flex = "1"
        editorWrapper.style.display = "flex"
        editorWrapper.style.flexDirection = "column"
        editorWrapper.style.minWidth = "0"
        editorWrapper.style.overflow = "visible"

        const tabsContainer = this.elements.tabsContainer = document.createElement("div")
        tabsContainer.addEventListener('wheel', (e) => {
            tabsContainer.scrollLeft += e.deltaY;
            e.preventDefault();
        });
        tabsContainer.className = getStyle("webui-monaco-prompt-multitext-tabs-container")
        tabsContainer.style.height = "35px"
        tabsContainer.style.background = "#252526"
        tabsContainer.style.display = "flex"
        tabsContainer.style.alignItems = "center"
        tabsContainer.style.overflowX = "hidden"
        tabsContainer.style.overflowY = "hidden"
        tabsContainer.style.borderBottom = "1px solid #333"
        editorWrapper.appendChild(tabsContainer)

        const editorContainer = this.elements.editorContainer = document.createElement("div")
        editorContainer.className = getStyle("webui-monaco-prompt-multitext-editor-container")
        editorContainer.style.flex = "1"
        editorContainer.style.overflow = "visible"
        editorContainer.style.position = "relative"
        editorContainer.style.width = "100%"
        editorContainer.style.minHeight = "50px" // 最小限の高さを確保しつつ、リサイズを妨げない
        editorContainer.style.display = "block"   // 確実に表示
        editorWrapper.appendChild(editorContainer)

        // リサイズハンドル
        const resizer = document.createElement("div")
        resizer.className = getStyle("webui-monaco-prompt-multitext-resizer")
        
        let isResizing = false

        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return
            const containerRect = containerEl.getBoundingClientRect()
            const scale = (window as any).app?.canvas?.ds?.scale || 1.0
            const newWidth = (e.clientX - containerRect.left) / scale
            if ((window as any).RESIZE_DEBUG) {
                (window as any).RESIZE_DEBUG.push(`move: clientX=${e.clientX.toFixed(1)}, containerLeft=${containerRect.left.toFixed(1)}, scale=${scale.toFixed(2)}, newWidth=${newWidth.toFixed(1)}`);
            }
            if (newWidth > 50 && newWidth < 600) {
                sidebarEl.style.setProperty("width", `${newWidth}px`, "important");
                sidebarEl.style.setProperty("min-width", `${newWidth}px`, "important");
                this.data.sidebarWidth = newWidth
                this.commitData() // 状態を即時保存
                if (this.editorInstance) {
                    this.editorInstance.monaco.layout()
                }
            }
        }

        const handleMouseUp = () => {
            isResizing = false
            resizer.classList.remove(getStyle("resizing"))
            document.removeEventListener("mousemove", handleMouseMove)
            document.removeEventListener("mouseup", handleMouseUp)
        }

        resizer.addEventListener("mousedown", (e) => {
            if ((window as any).RESIZE_DEBUG) {
                (window as any).RESIZE_DEBUG.push("mousedown on resizer");
            }
            isResizing = true
            resizer.classList.add(getStyle("resizing"))
            document.addEventListener("mousemove", handleMouseMove)
            document.addEventListener("mouseup", handleMouseUp)
            e.preventDefault()
            e.stopPropagation() 
        })

        containerEl.appendChild(sidebarEl)
        containerEl.appendChild(resizer)
        containerEl.appendChild(editorWrapper)

        const domWidget = node.addDOMWidget("webui-monaco-prompt-multitext", "webui-monaco-prompt-multitext", containerEl, {
            hideOnZoom: true,
            serialize: false,
        })

        // 2. CSS インジェクションによる物理的固定
        // インラインスタイルだと LiteGraph の animate ループで毎秒上書きされるため
        const styleId = "webui-monaco-prompt-multitext-fix-style";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.innerHTML = `
                .webui-monaco-prompt-multitext-container-parent-fix {
                    /* LiteGraph による動的な配置を許可するため、位置固定は行わない */
                }
            `;
            document.head.appendChild(style);
        }

        if (domWidget.element) {
            const el = domWidget.element;
            const styleId = "webui-monaco-prompt-multitext-fix-style";
            if (!document.getElementById(styleId)) {
                const style = document.createElement("style");
                style.id = styleId;
                style.innerHTML = `
                    .webui-monaco-prompt-multitext-container-parent-fix {
                        margin-top: 0px !important;
                        left: 0px !important;
                    }
                `;
                document.head.appendChild(style);
            }
            el.classList.add("webui-monaco-prompt-multitext-container-parent-fix");
            
            // 常にコンテナをノード領域いっぱいに引き伸ばすためのフック
            const originalDraw = (domWidget as any).draw;
            
            (domWidget as any).draw = function(ctx: CanvasRenderingContext2D, n: any, widget_width: number, y: number, H: number, ...args: any[]) {
                if (this.element && n.size) {
                    // タイトルバー(36px)と出力ピンエリア(1スロット20px)を考慮して高さを計算
                    const outputHeight = n.outputs ? n.outputs.length * 20 : 0;
                    const targetHeight = Math.max(50, n.size[1] - 36 - outputHeight);
                    
                    // 高さと幅だけを追従
                    this.element.style.setProperty("height", `${targetHeight}px`, "important");
                    containerEl.style.setProperty("height", `${targetHeight}px`, "important");
                    
                    const targetWidth = Math.max(50, n.size[0] - 20);
                    this.element.style.setProperty("width", `${targetWidth}px`, "important");
                    containerEl.style.setProperty("width", `${targetWidth}px`, "important");

                    // サイドバーの幅がノード幅の80%を超えないように制限
                    const maxSidebarWidth = Math.max(50, targetWidth * 0.8);
                    const currentSidebarWidth = self.data.sidebarWidth || 150;
                    const finalSidebarWidth = Math.min(currentSidebarWidth, maxSidebarWidth);
                    sidebarEl.style.setProperty("width", `${finalSidebarWidth}px`, "important");
                    sidebarEl.style.setProperty("min-width", `${finalSidebarWidth}px`, "important");
                }
                
                // LiteGraphの正常なY座標でそのままオリジナルを呼び出す
                if (originalDraw) {
                    originalDraw.call(this, ctx, n, widget_width, y, H, ...args);
                }
            };
            // pointer-events を確実にする
        // pointer-events を確実にする
            el.style.pointerEvents = "auto";
            containerEl.style.pointerEvents = "auto";
        }

        // ノードサイズに合わせて全体を占有させる（空白除去の最重要ポイント）
        (domWidget as any)._node = node;
        ((domWidget as any).computeSize as any) = function(this: any, width: number) {
            const n = (this as any)._node || node;
            if (!n || !n.size) return [width, 50];
            
            // タイトルバー(36px)と出力ピンエリア(1スロット20px)を考慮して高さを計算
            const outputHeight = n.outputs ? n.outputs.length * 20 : 0;
            const targetHeight = Math.max(50, n.size[1] - 36 - outputHeight);
            
            return [width, targetHeight];
        };

        // 既存の text/tree_data ウィジェット（完全無力化でノード高さを汚染させない）
        ["text", "tree_data"].forEach(name => {
            const wIndex = node.widgets?.findIndex((w: any) => w.name === name);
            if (wIndex !== undefined && wIndex !== -1) {
                const w = node.widgets![wIndex];
                w.hidden = true;
                (w as any).computeSize = () => [0, 0]; // 高さを完全に0にする
                if ((w as any).element) {
                    (w as any).element.style.display = "none";
                    (w as any).element.style.height = "0px";
                    (w as any).element.style.overflow = "hidden";
                }
                if (name === "tree_data") {
                    node.widgets!.splice(wIndex, 1); // tree_data は完全に削除
                }
            }
        });
        // 自動保存処理
        const originalOnSerialize = node.onSerialize;
        node.onSerialize = function(info: any) {
            if (originalOnSerialize) originalOnSerialize.apply(this, arguments);
            const targetWidget = node.widgets.find((w:any) => w.name === "text");
            if (targetWidget) {
                targetWidget.value = JSON.stringify(self.data, (key, value) => {
                    if (key === 'parent') return undefined;
                    return value;
                });
            }
        };

        this.loadDataFromWidget(null);
    }

    private loadDataFromWidget(info: any) {
        const targetWidget = (this as any)._node?.widgets?.find((w:any) => w.name === "text");
        const setupParentRefs = (items: TreeItem[], parent?: TreeItem) => {
            for (const item of items) {
                item.parent = parent;
                if (item.children) setupParentRefs(item.children, item);
            }
        };

        if (targetWidget && targetWidget.value) {
            try {
                let parsed = JSON.parse(targetWidget.value);
                // `targetWidget.value` が単純な文字列や予期せぬ形式の場合への対応
                if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.tree)) {
                    // 古いバージョンの単純な文字列保存とみなし、文字列を新規ファイルに格納する
                    const content = typeof parsed === "string" ? parsed : (typeof targetWidget.value === "string" ? targetWidget.value : "");
                    this.data = { tree: [], activeFileId: undefined, openedFileIds: [] };
                    this.addItemWithName('file', 'default.txt');
                    const firstFile = this.data.tree.find(i => i.type === 'file');
                    if (firstFile) {
                        firstFile.content = content;
                        this.openFile(firstFile.id);
                    }
                } else {
                    this.data = parsed;
                    if (!this.data.openedFileIds) {
                        this.data.openedFileIds = this.data.activeFileId ? [this.data.activeFileId] : [];
                    }
                    setupParentRefs(this.data.tree);
                    this.renderTree();
                    this.renderTabs();
                    if (this.data.activeFileId) {
                        this.openFile(this.data.activeFileId);
                    } else {
                        // treeはあるがactiveFileIdがない場合のフォールバック
                        const firstFile = this.data.tree.find(i => i.type === 'file');
                        if (firstFile) {
                            this.openFile(firstFile.id);
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to parse tree data", e);
                this.data = { tree: [], activeFileId: undefined, openedFileIds: [] };
                this.addItemWithName('file', 'default.txt');
                const firstFile = this.data.tree.find(i => i.type === 'file');
                if (firstFile) {
                    firstFile.content = targetWidget.value; // パース失敗時は元の文字列を入れる
                    this.openFile(firstFile.id);
                }
                setupParentRefs(this.data.tree);
            }
        } else {
            this.data = { tree: [], activeFileId: undefined, openedFileIds: [] };
            // 初期データがない場合はデフォルトのファイルを作成
            this.addItemWithName('file', 'default.txt');
            const firstFile = this.data.tree.find(i => i.type === 'file');
            if (firstFile) {
                this.openFile(firstFile.id);
            }
            setupParentRefs(this.data.tree);
        }
    }

    private createToolbarButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.innerHTML = icon;
        btn.title = title;
        btn.className = getStyle("webui-monaco-prompt-multitext-toolbar-button");
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
    }

    private toggleSearch() {
        if (!this.elements.searchContainer || !this.elements.searchResults) return;
        const isHidden = this.elements.searchContainer.style.display === "none";
        this.elements.searchContainer.style.display = isHidden ? "flex" : "none";
        this.elements.searchResults.style.display = isHidden ? "flex" : "none";
        if (isHidden) {
            this.elements.searchInput?.focus();
        } else {
            if (this.elements.searchInput) this.elements.searchInput.value = "";
            this.renderSearchResults([]);
        }
    }

    private executeSearch() {
        const word = this.elements.searchInput?.value.trim();
        if (!word) {
            this.renderSearchResults([]);
            return;
        }

        const results: { id: string; name: string; match: string }[] = [];
        
        const searchInTree = (items: TreeItem[]) => {
            for (const item of items) {
                if (item.type === 'file') {
                    const model = this.models[item.id];
                    const content = model ? model.getValue() : (item.content || "");
                    if (content.toLowerCase().includes(word.toLowerCase())) {
                        results.push({ id: item.id, name: item.name, match: "Match found" });
                    }
                }
                if (item.children) searchInTree(item.children);
            }
        };
        
        searchInTree(this.data.tree);
        this.renderSearchResults(results);
    }

    private renderSearchResults(results: { id: string; name: string; match: string }[]) {
        if (!this.elements.searchResults) return;
        this.elements.searchResults.innerHTML = "";
        
        results.forEach(result => {
            const item = document.createElement("div");
            item.className = getStyle("webui-monaco-prompt-multitext-search-result-item");
            item.innerText = `${result.name}: ${result.match}`;
            item.addEventListener("click", () => {
                this.openFile(result.id);
            });
            this.elements.searchResults!.appendChild(item);
        });
    }

    private addItem(type: 'file' | 'folder', parentId?: string) {
        const name = prompt(`Enter ${type} name:`, `new_${type}`);
        if (!name) return;
        this.addItemWithName(type, name, parentId);
    }

    public addItemWithName(type: 'file' | 'folder', name: string, parentId?: string, content?: string): string {
        const newItem: TreeItem = {
            id: utils.guid(),
            name: name,
            type: type,
            content: type === 'file' ? (content || '') : undefined,
            children: type === 'folder' ? [] : undefined,
            expanded: type === 'folder' ? true : undefined
        };

        if (parentId) {
            const findAndAdd = (items: TreeItem[]) => {
                for (const item of items) {
                    if (item.id === parentId && item.children) {
                        newItem.parent = item;
                        item.children.push(newItem);
                        return true;
                    }
                    if (item.children && findAndAdd(item.children)) return true;
                }
                return false;
            };
            findAndAdd(this.data.tree);
        } else {
            this.data.tree.push(newItem);
        }

        this.renderTree();
        // 保存をトリガー
        this.commitData();
        return newItem.id;
    }

    private renameItem(id: string, currentName: string) {
        this.editingId = id;
        this.renderTree();
    }

    private applyRename(id: string, newName: string) {
        if (!newName || newName.trim() === "") {
            this.editingId = null;
            this.renderTree();
            return;
        }

        let changed = false;
        const findAndRename = (items: TreeItem[]) => {
            for (const item of items) {
                if (item.id === id) {
                    if (item.name !== newName) {
                        item.name = newName;
                        changed = true;
                    }
                    return true;
                }
                if (item.children && findAndRename(item.children)) return true;
            }
            return false;
        };
        
        findAndRename(this.data.tree);
        
        if (changed) {
            this.commitData();
        }
        
        this.editingId = null;
        this.renderTree();
    }

    public deleteItem(id: string) {
        if (!confirm("Are you sure you want to delete this item?")) return;

        const findAndDelete = (items: TreeItem[], parentItems: TreeItem[]) => {
            for (let i = 0; i < items.length; i++) {
                if (items[i].id === id) {
                    items.splice(i, 1);
                    return true;
                }
                if (items[i].children && findAndDelete(items[i].children!, items[i].children!)) return true;
            }
            return false;
        };
        findAndDelete(this.data.tree, this.data.tree);
        
        if (this.data.openedFileIds) {
            const findFile = (items: TreeItem[], fileId: string): boolean => {
                for (const item of items) {
                    if (item.id === fileId && item.type === 'file') return true;
                    if (item.children && findFile(item.children, fileId)) return true;
                }
                return false;
            };
            
            const newOpenedFileIds = this.data.openedFileIds.filter(fid => findFile(this.data.tree, fid));
            
            if (this.data.openedFileIds.length !== newOpenedFileIds.length) {
                this.data.openedFileIds = newOpenedFileIds;
                if (this.data.activeFileId && !findFile(this.data.tree, this.data.activeFileId)) {
                    if (this.data.openedFileIds.length > 0) {
                        // Switch file if active was deleted
                        this.openFile(this.data.openedFileIds[0]);
                    } else {
                        this.data.activeFileId = undefined;
                        if (this.editorInstance) this.editorInstance.monaco.setValue("");
                        this.renderTabs();
                    }
                } else {
                    this.renderTabs();
                }
            }
        }

        this.renderTree();
        this.commitData();
    }

    public openFile(id: string) {
        const findFile = (items: TreeItem[]): TreeItem | undefined => {
            for (const item of items) {
                if (item.id === id && item.type === 'file') return item;
                if (item.children) {
                    const result = findFile(item.children);
                    if (result) return result;
                }
            }
        };

        const file = findFile(this.data.tree);
        if (!file) return;

        this.data.activeFileId = id;
        
        if (!this.data.openedFileIds) {
            this.data.openedFileIds = [];
        }
        if (!this.data.openedFileIds.includes(id)) {
            this.data.openedFileIds.push(id);
        }

        this.renderTree();
        this.renderTabs();

        if (!this.editor && this.elements.editorContainer) {
            const dummyTextArea = document.createElement("textarea");
            dummyTextArea.style.display = "none";
            this.elements.editorContainer.appendChild(dummyTextArea);

            this.editor = new WebuiMonacoPrompt.PromptEditor(dummyTextArea, {
                autoLayout: true,
                handleTextAreaValue: false
            });
            this.editor.style.height = "100%";
            this.editor.style.width = "100%";
            this.editor.style.display = "block";
            this.elements.editorContainer.appendChild(this.editor);
            
            const appId = this.editor.getInstanceId();
            dummyTextArea.dataset.webuiMonacoPromptTextareaId = "" + appId;
            this.editor.dataset.webuiMonacoPromptTextareaId = "" + appId;

            link[appId] = {
                textarea: dummyTextArea,
                monaco: this.editor,
                observer: { disconnect: () => {} } as unknown as MutationObserver,
                node: (this as any)._node,
            };

            const app = (window as any).app || ((window as any).comfyAPI && (window as any).comfyAPI.app) || (window as any).ComfyApp;
            utils.applyCommonEditorSetup(app, this.editor, (this as any)._node);
        }

        if (this.editor) {
            this.syncModels();
            if (this.models[id]) {
                this.editor.monaco.setModel(this.models[id]);
                this.editor.updateContext();
            }
        }
    }

    private renderTabs() {
        if (!this.elements.tabsContainer) return;
        this.elements.tabsContainer.innerHTML = "";
        
        if (!this.data.openedFileIds) return;

        for (const fileId of this.data.openedFileIds) {
            const findFile = (items: TreeItem[]): TreeItem | undefined => {
                for (const item of items) {
                    if (item.id === fileId && item.type === 'file') return item;
                    if (item.children) {
                        const result = findFile(item.children);
                        if (result) return result;
                    }
                }
            };
            const file = findFile(this.data.tree);
            if (!file) continue;

            const tab = document.createElement("div");
            tab.className = getStyle("webui-monaco-prompt-multitext-tab");
            if (this.data.activeFileId === fileId) {
                tab.classList.add(getStyle("active"));
                tab.style.background = "#1e1e1e";
                tab.style.color = "#ccc";
                tab.style.borderTop = "1px solid #007fd4";
            } else {
                tab.style.background = "#2d2d2d";
                tab.style.color = "#999";
                tab.style.borderTop = "1px solid transparent";
            }
            tab.style.padding = "0 10px 0 15px";
            tab.style.height = "100%";
            tab.style.display = "flex";
            tab.style.alignItems = "center";
            tab.style.cursor = "pointer";
            tab.style.borderRight = "1px solid #333";
            tab.style.flexShrink = "0";
            
            const nameSpan = document.createElement("span");
            nameSpan.textContent = file.name;
            nameSpan.style.marginRight = "8px";
            tab.appendChild(nameSpan);

            const closeBtn = document.createElement("span");
            closeBtn.className = getStyle("webui-monaco-prompt-multitext-tab-close");
            closeBtn.innerHTML = "×";
            closeBtn.style.fontSize = "16px";
            closeBtn.style.lineHeight = "1";
            closeBtn.style.padding = "2px 4px";
            closeBtn.style.cursor = "pointer";
            closeBtn.style.borderRadius = "3px";
            closeBtn.onmouseover = () => closeBtn.style.background = "rgba(255, 255, 255, 0.1)";
            closeBtn.onmouseout = () => closeBtn.style.background = "transparent";
            
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                this.closeTab(fileId);
            };
            tab.appendChild(closeBtn);

            tab.onclick = () => {
                this.openFile(fileId);
            };

            this.elements.tabsContainer.appendChild(tab);
        }

        // スクロール処理: アクティブなタブが画面外にある場合に備えて表示領域に移動
        setTimeout(() => {
            const activeTab = this.elements.tabsContainer?.querySelector(`.${getStyle('webui-monaco-prompt-multitext-tab')}.${getStyle('active')}`) as HTMLElement;
            if (activeTab) {
                // block: 'nearest' により、すでに表示されている場合はスクロールしない
                // inline: 'center' により、中央にくるようにスクロール
                activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }, 100); // DOMレンダリング後の実行を確実にするため少し長めに設定
    }

    public closeTab(id: string) {
        if (!this.data.openedFileIds) return;
        const index = this.data.openedFileIds.indexOf(id);
        if (index > -1) {
            this.data.openedFileIds.splice(index, 1);
            
            if (this.data.activeFileId === id) {
                if (this.data.openedFileIds.length > 0) {
                    const nextIndex = Math.min(index, this.data.openedFileIds.length - 1);
                    this.openFile(this.data.openedFileIds[nextIndex]);
                } else {
                    this.data.activeFileId = undefined;
                    this.renderTabs();
                    this.renderTree();
                    if (this.editorInstance) {
                        this.editorInstance.monaco.setValue("");
                    }
                }
            } else {
                this.renderTabs();
            }
            this.commitData();
        }
    }

    private renderTree() {
        if (!this.elements.treeContainer) return
        this.elements.treeContainer.innerHTML = ""
        const rootDiv = document.createElement("div")
        rootDiv.className = getStyle("webui-monaco-prompt-multitext-tree")
        this.renderTreeItems(this.data.tree, rootDiv, 0)
        this.elements.treeContainer.appendChild(rootDiv)
    }

    private renderTreeItems(items: TreeItem[], parentEl: HTMLElement, depth: number) {
        for (const item of items) {
            const itemContainer = document.createElement("div")
            itemContainer.className = getStyle("webui-monaco-prompt-multitext-tree-item-wrapper")
            
            const itemEl = document.createElement("div")
            itemEl.className = getStyle("webui-monaco-prompt-multitext-tree-item")
            if (this.data.activeFileId === item.id) itemEl.classList.add(getStyle("active"))
            if (this._selectedIds.has(item.id)) itemEl.classList.add(getStyle("selected"))
            
            itemEl.draggable = true
            itemEl.addEventListener('dragover', (e) => {
                e.preventDefault()
                itemEl.classList.add(getStyle('drag-over')); // Keep drag-over for visual feedback during drag
            })
            itemEl.addEventListener('dragleave', () => {
                itemEl.classList.remove(getStyle("drag-over"))
            })
            itemEl.addEventListener('drop', (e) => {
                e.preventDefault()
                itemEl.classList.remove(getStyle("drag-over"))
                const jsonData = e.dataTransfer?.getData("application/json")
                if (jsonData) {
                    try {
                        const draggedIds = JSON.parse(jsonData);
                        if (Array.isArray(draggedIds) && !draggedIds.includes(item.id)) {
                            this.moveItems(draggedIds, item.id);
                            return;
                        }
                    } catch (err) {}
                }
                const draggedId = e.dataTransfer?.getData("text/plain")
                if (draggedId && draggedId !== item.id) {
                    this.moveItems([draggedId], item.id)
                }
            })

            // インデント
            for (let i = 0; i < depth; i++) {
                const indent = document.createElement("span")
                indent.className = getStyle("webui-monaco-prompt-multitext-tree-indent")
                indent.style.width = "4px"
                indent.style.flexShrink = "0"
                itemEl.appendChild(indent)
            }

            // 矢印（整列のために常に作成、16px固定）
            const arrowContainer = document.createElement("span")
            arrowContainer.className = getStyle("webui-monaco-prompt-multitext-tree-arrow")
            arrowContainer.style.width = "16px"
            arrowContainer.style.display = "flex"
            arrowContainer.style.flexShrink = "0"
            if (item.type === 'folder') {
                arrowContainer.innerHTML = item.expanded ? MultiTextWidget.ICONS.arrowDown : MultiTextWidget.ICONS.arrowRight
            } else {
                arrowContainer.innerHTML = ""
            }
            itemEl.appendChild(arrowContainer)

            // アイコン
            const iconEl = document.createElement("span")
            iconEl.className = getStyle("webui-monaco-prompt-multitext-tree-icon")
            iconEl.style.width = "22px"
            iconEl.style.display = "flex"
            iconEl.style.flexShrink = "0"
            if (item.type === 'folder') {
                iconEl.innerHTML = MultiTextWidget.ICONS.folder
            } else {
                iconEl.innerHTML = MultiTextWidget.ICONS.file
            }
            itemEl.appendChild(iconEl)

            // 名前（これが flex: 1 で伸びてアクションを右に追いやる）
            if (this.editingId === item.id) {
                const inputEl = document.createElement("input")
                inputEl.className = "webui-monaco-prompt-multitext-tree-name-input"
                inputEl.value = item.name
                inputEl.style.flex = "1"
                inputEl.style.minWidth = "0"
                
                const finish = () => this.applyRename(item.id, inputEl.value);
                const cancel = () => {
                    this.editingId = null;
                    this.renderTree();
                };

                inputEl.onblur = () => finish();
                inputEl.onkeydown = (e) => {
                    e.stopPropagation(); // ComfyUI のショートカットを防止
                    if (e.key === "Enter") {
                        inputEl.onblur = null;
                        finish();
                    } else if (e.key === "Escape") {
                        inputEl.onblur = null;
                        cancel();
                    }
                };
                inputEl.onclick = (e) => e.stopPropagation();
                inputEl.onmousedown = (e) => e.stopPropagation();
                
                itemEl.appendChild(inputEl)
                
                // 描画後にフォーカスを当てる
                setTimeout(() => {
                    inputEl.focus();
                    inputEl.select();
                }, 0);
            } else {
                const nameEl = document.createElement("span")
                nameEl.className = getStyle("webui-monaco-prompt-multitext-tree-name")
                nameEl.textContent = item.name
                nameEl.ondblclick = (e) => {
                    e.stopPropagation();
                    this.renameItem(item.id, item.name);
                };
                itemEl.appendChild(nameEl)
            }

            // アクションボタン（右寄せされるコンテナ）
            const actionsEl = document.createElement("span")
            actionsEl.className = getStyle("webui-monaco-prompt-multitext-tree-actions")
            
            if (item.type === 'folder') {
                const addFile = document.createElement("span")
                addFile.className = getStyle("webui-monaco-prompt-multitext-tree-action")
                addFile.innerHTML = MultiTextWidget.ICONS.addFile
                addFile.title = "New File"
                addFile.onclick = (e) => { e.stopPropagation(); this.addItem('file', item.id); }
                actionsEl.appendChild(addFile)

                const addFolder = document.createElement("span")
                addFolder.className = "webui-monaco-prompt-multitext-tree-action"
                addFolder.innerHTML = MultiTextWidget.ICONS.addFolder
                addFolder.title = "New Folder"
                addFolder.onclick = (e) => { e.stopPropagation(); this.addItem('folder', item.id); }
                actionsEl.appendChild(addFolder)
            }

            const editBtn = document.createElement("span")
            editBtn.className = "webui-monaco-prompt-multitext-tree-action"
            editBtn.innerHTML = MultiTextWidget.ICONS.edit
            editBtn.title = "Rename"
            editBtn.onclick = (e) => { e.stopPropagation(); this.renameItem(item.id, item.name); }
            actionsEl.appendChild(editBtn)

            const delBtn = document.createElement("span")
            delBtn.className = "webui-monaco-prompt-multitext-tree-action"
            delBtn.innerHTML = MultiTextWidget.ICONS.delete
            delBtn.title = "Delete"
            delBtn.onclick = (e) => { e.stopPropagation(); this.deleteItem(item.id); }
            actionsEl.appendChild(delBtn)

            itemEl.appendChild(actionsEl)

            itemEl.addEventListener('click', (e) => {
                e.stopPropagation();

                // 複数選択ロジック
                if (e.ctrlKey || e.metaKey) {
                    if (this._selectedIds.has(item.id)) {
                        this._selectedIds.delete(item.id);
                    } else {
                        this._selectedIds.add(item.id);
                    }
                } else if (e.shiftKey && this.lastSelectedId) {
                    // Shift選択: 前回の選択位置から今回までを範囲選択
                    const allItems = this.getAllItemIds(this.data.tree); 
                    const startIdx = allItems.indexOf(this.lastSelectedId);
                    const endIdx = allItems.indexOf(item.id);
                    if (startIdx !== -1 && endIdx !== -1) {
                        const [min, max] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
                        const rangeIds = allItems.slice(min, max + 1);
                        rangeIds.forEach((id: string) => this._selectedIds.add(id));
                    }
                } else {
                    // 通常クリック: 選択をリセットして単一選択
                    this._selectedIds.clear();
                    this._selectedIds.add(item.id);

                    // ファイルなら開く、フォルダなら展開
                    if (item.type === 'file') {
                        this.openFile(item.id);
                    } else {
                        item.expanded = !item.expanded;
                        this.renderTree();
                    }
                }
                
                this.lastSelectedId = item.id;
                this.renderTree(); // 描画を更新して .selected クラスを反映
            });

            // ドラッグ開始イベント
            itemEl.addEventListener('dragstart', (e) => {
                const draggedIds = this._selectedIds.has(item.id) 
                    ? Array.from(this._selectedIds) 
                    : [item.id];
                e.dataTransfer?.setData('application/json', JSON.stringify(draggedIds));
                e.dataTransfer?.setData('text/plain', item.id); // フォールバック用
                
                // 選択されていないアイテムをドラッグ開始した場合は、それを選択状態にする
                if (!this._selectedIds.has(item.id)) {
                    this._selectedIds.clear();
                    this._selectedIds.add(item.id);
                    this.renderTree();
                }
            });

            itemContainer.appendChild(itemEl)

            if (item.type === 'folder' && item.expanded && item.children) {
                const childContainer = document.createElement("div")
                childContainer.className = getStyle("webui-monaco-prompt-multitext-tree-children")
                this.renderTreeItems(item.children, childContainer, depth + 1)
                itemContainer.appendChild(childContainer)
            }

            parentEl.appendChild(itemContainer)
        }
    }

    private getAllItemIds(items: TreeItem[]): string[] {
        let ids: string[] = [];
        for (const item of items) {
            ids.push(item.id);
            if (item.children && item.expanded) {
                ids = ids.concat(this.getAllItemIds(item.children));
            }
        }
        return ids;
    }

    private moveItems(draggedIds: string[], targetId: string) {
        const itemsToMove: TreeItem[] = [];

        // 循環参照チェック（フォルダを自分自身やその子孫に移動させない）
        const isDescendant = (parent: TreeItem, potentialChildId: string): boolean => {
            if (parent.id === potentialChildId) return true;
            if (parent.children) {
                return parent.children.some(c => isDescendant(c, potentialChildId));
            }
            return false;
        };

        // ドラッグされたアイテムを探して元の場所から削除
        const findAndRemove = (items: TreeItem[]) => {
            for (let i = 0; i < items.length; i++) {
                if (draggedIds.includes(items[i].id)) {
                    itemsToMove.push(items.splice(i, 1)[0]);
                    i--; // 削除されたのでインデックスを調整
                    continue;
                }
                if (items[i].children) findAndRemove(items[i].children!);
            }
        };
        findAndRemove(this.data.tree);

        if (itemsToMove.length === 0) return;

        // 移動先を探して挿入
        const findAndInsert = (items: TreeItem[]) => {
            for (let i = 0; i < items.length; i++) {
                if (items[i].id === targetId) {
                    if (items[i].type === 'folder') {
                        // フォルダ内に追加
                        // 移動先が動かすアイテム自体、またはその子孫である場合はスキップ
                        const filteredItems = itemsToMove.filter(m => !isDescendant(m, targetId));
                        filteredItems.forEach(m => m.parent = items[i]);
                        items[i].children!.push(...filteredItems);
                        items[i].expanded = true;
                    } else {
                        // ファイルの隣（同じ階層）に追加
                        const parent = items[i].parent;
                        itemsToMove.forEach(m => m.parent = parent);
                        items.splice(i + 1, 0, ...itemsToMove);
                    }
                    return true;
                }
                if (items[i].children && findAndInsert(items[i].children!)) return true;
            }
            return false;
        };

        if (!findAndInsert(this.data.tree)) {
            // 見つからない場合はルート末尾へ
            itemsToMove.forEach(m => m.parent = undefined);
            this.data.tree.push(...itemsToMove);
        }

        this.commitData();
        this.renderTree();
    }
    
    private commitData() {
        const node = (this as any)._node;
        if (node) {
            const targetWidget = node.widgets?.find((w:any) => w.name === "text");
            if (targetWidget) {
                targetWidget.value = JSON.stringify(this.data, (key, value) => {
                    if (key === 'parent') return undefined; // 永続化時は親参照を除外
                    return value;
                });
                if (targetWidget.callback) {
                    try {
                        targetWidget.callback(targetWidget.value, undefined, node, undefined);
                    } catch (e) {}
                }
            }
            
            // ノード自体の更新（再描画）を指示
            if (node.setDirtyCanvas) {
                node.setDirtyCanvas(true, true);
            }

            // グラフ全体の変更（保存対象としてのマーク）を明示的に行う
            if (node.graph) {
                node.graph.change();
            }
        }

        // ComfyUI アプリケーションレベルでの変更通知 (より広範な環境に対応)
        const app = (window as any).app || ((window as any).comfyAPI && (window as any).comfyAPI.app) || (window as any).ComfyApp;
        if (app && app.graph) {
            try {
                app.graph.change();
            } catch(e) {}
        }
    }
    
    public getItemPath(id: string): string {
        const parts: string[] = [];
        const findAndTrace = (items: TreeItem[]): TreeItem | undefined => {
            for (const item of items) {
                if (item.id === id) return item;
                if (item.children) {
                    const result = findAndTrace(item.children);
                    if (result) return result;
                }
            }
        };

        let current = findAndTrace(this.data.tree);
        while (current) {
            parts.unshift(current.name);
            current = current.parent;
        }
        return parts.join("/");
    }

    public getItemByModel(model: Monaco.editor.ITextModel): TreeItem | undefined {
        for (const id in this.models) {
            if (this.models[id] === model) {
                const findItem = (items: TreeItem[]): TreeItem | undefined => {
                    for (const item of items) {
                        if (item.id === id) return item;
                        if (item.children) {
                            const result = findItem(item.children);
                            if (result) return result;
                        }
                    }
                };
                return findItem(this.data.tree);
            }
        }
    }

    private get editorInstance(): any {
        return this.editor
    }

    onRemoved() {
        if (this.editor) {
            try {
                const id = typeof this.editor.getInstanceId === 'function' ? this.editor.getInstanceId() : null;
                if (id !== null && link[id]) {
                    const editor = this.editor;
                    editor.dispose();
                    if (editor.parentElement) {
                        editor.parentElement.removeChild(editor);
                    }
                    delete link[id];
                }
            } catch (e) {
                console.error("[MultiTextWidget] Error in editor disposal:", e);
            }
        }
        for (const id of Object.keys(this.models)) {
            try {
                const model = this.models[id];
                if (model) {
                    const extra = (this.editor as any)?.extraModels?.find?.((e: any) => e.model === model);
                    if (extra && extra.decorationIds && typeof model.deltaDecorations === 'function') {
                        extra.decorationIds = model.deltaDecorations(extra.decorationIds, []);
                    }
                    model.dispose();
                }
            } catch (e) {
                console.error(`[MultiTextWidget] Error disposing model ${id}:`, e);
            }
        }
        this.models = {};
    }
}

export {
    MultiTextWidget
}
