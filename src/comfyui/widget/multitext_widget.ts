import * as utils from "../utils"
import { ui } from "../api"
import { link } from "../link"
import * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import * as WebuiMonacoPrompt from "../../index"
import { WebuiMonacoPromptAdapter, PromptEditor, ExtraModel } from "../types"

// 今回のノードの内部データ構造（WorkflowにJSON化して保存）
// ツリー構造のアイテム定義
interface TreeItem {
    id: string; // 内部管理用の一意識別子
    name: string;
    type: 'file' | 'folder';
    content?: string; // type === 'file' の場合のみ
    children?: TreeItem[]; // type === 'folder' の場合のみ
    expanded?: boolean;
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
    } = {};

    public data: MultiTextData = {
        tree: [],
        activeFileId: undefined,
        openedFileIds: []
    };

    private editor?: any; // Monaco Editor instance
    private isSidebarVisible = true;
    private models: Record<string, Monaco.editor.ITextModel> = {};

    private syncModels() {
        if (!this.editor) return;
        if (!this.editor.extraModels) this.editor.extraModels = [];

        const existingIds = new Set<string>();
        const traverse = (items: TreeItem[]) => {
            for (const item of items) {
                if (item.type === 'file') {
                    existingIds.add(item.id);
                    if (!this.models[item.id]) {
                        this.models[item.id] = Monaco.editor.createModel(item.content || "", "comfy-prompt");
                        this.models[item.id].onDidChangeContent(() => {
                            item.content = this.models[item.id].getValue();
                            this.commitData();
                        });
                        this.editor.extraModels.push({
                            filename: item.name,
                            model: this.models[item.id],
                            onActivate: () => {
                                this.openFile(item.id);
                            }
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
        containerEl.className = "webui-monaco-prompt-multitext-container"
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
        sidebarEl.className = "webui-monaco-prompt-multitext-sidebar"
        
        const toolbar = document.createElement("div")
        toolbar.className = "webui-monaco-prompt-multitext-sidebar-toolbar"

        const addFileBtn = this.elements.addFileBtn = document.createElement("button")
        addFileBtn.className = "webui-monaco-prompt-multitext-toolbar-button"
        addFileBtn.innerHTML = MultiTextWidget.ICONS.addFile
        addFileBtn.title = "New File"
        addFileBtn.onclick = () => this.addItem('file')
        toolbar.appendChild(addFileBtn)

        const addFolderBtn = this.elements.addFolderBtn = document.createElement("button")
        addFolderBtn.className = "webui-monaco-prompt-multitext-toolbar-button"
        addFolderBtn.innerHTML = MultiTextWidget.ICONS.addFolder
        addFolderBtn.title = "New Folder"
        addFolderBtn.onclick = () => this.addItem('folder')
        toolbar.appendChild(addFolderBtn)

        sidebarEl.appendChild(toolbar)

        const treeContainer = this.elements.treeContainer = document.createElement("div")
        treeContainer.className = "webui-monaco-prompt-multitext-tree-container"
        treeContainer.style.flex = "1"
        treeContainer.style.overflowY = "auto"
        sidebarEl.appendChild(treeContainer)

        // エディタ領域
        const editorWrapper = document.createElement("div")
        editorWrapper.style.flex = "1"
        editorWrapper.style.display = "flex"
        editorWrapper.style.flexDirection = "column"
        editorWrapper.style.minWidth = "0"

        const tabsContainer = this.elements.tabsContainer = document.createElement("div")
        tabsContainer.addEventListener('wheel', (e) => {
            tabsContainer.scrollLeft += e.deltaY;
            e.preventDefault();
        });
        tabsContainer.className = "webui-monaco-prompt-multitext-tabs-container"
        tabsContainer.style.height = "35px"
        tabsContainer.style.background = "#252526"
        tabsContainer.style.display = "flex"
        tabsContainer.style.alignItems = "center"
        tabsContainer.style.overflowX = "auto"
        tabsContainer.style.overflowY = "hidden"
        tabsContainer.style.borderBottom = "1px solid #333"
        editorWrapper.appendChild(tabsContainer)

        const editorContainer = this.elements.editorContainer = document.createElement("div")
        editorContainer.className = "webui-monaco-prompt-multitext-editor-container"
        editorContainer.style.flex = "1"
        editorContainer.style.position = "relative"
        editorContainer.style.width = "100%"
        editorContainer.style.minHeight = "50px" // 最小限の高さを確保しつつ、リサイズを妨げない
        editorContainer.style.display = "block"   // 確実に表示
        editorWrapper.appendChild(editorContainer)

        // リサイズハンドル
        const resizer = document.createElement("div")
        resizer.className = "webui-monaco-prompt-multitext-resizer"
        
        let isResizing = false

        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return
            const containerRect = containerEl.getBoundingClientRect()
            const scale = (window as any).app?.canvas?.ds?.scale || 1.0
            const newWidth = (e.clientX - containerRect.left) / scale
            if ((window as any).RESIZE_DEBUG) {
                (window as any).RESIZE_DEBUG.push(`move: clientX=${e.clientX}, rectLeft=${containerRect.left}, scale=${scale}, new=${newWidth}`);
            }
            if (newWidth > 50 && newWidth < 600) {
                sidebarEl.style.setProperty("width", `${newWidth}px`, "important");
                sidebarEl.style.setProperty("min-width", `${newWidth}px`, "important");
                this.data.sidebarWidth = newWidth
                if (this.editorInstance) {
                    this.editorInstance.monaco.layout()
                }
            }
        }

        const handleMouseUp = () => {
            isResizing = false
            resizer.classList.remove("resizing")
            document.removeEventListener("mousemove", handleMouseMove)
            document.removeEventListener("mouseup", handleMouseUp)
        }

        resizer.addEventListener("mousedown", (e) => {
            if ((window as any).RESIZE_DEBUG) {
                (window as any).RESIZE_DEBUG.push("mousedown on resizer");
            }
            isResizing = true
            resizer.classList.add("resizing")
            document.addEventListener("mousemove", handleMouseMove)
            document.addEventListener("mouseup", handleMouseUp)
            e.preventDefault()
            e.stopPropagation() 
        })

        containerEl.appendChild(sidebarEl)
        containerEl.appendChild(resizer)
        containerEl.appendChild(editorWrapper)

        const domWidget = node.addDOMWidget("webui-monaco-prompt-multitext", "webui-monaco-prompt-multitext", containerEl, {
            hideOnZoom: false,
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
                    containerEl.style.setProperty("overflow", "hidden", "important");

                    // サイドバーの幅がノード幅の80%を超えないように制限
                    const maxSidebarWidth = Math.max(50, targetWidth * 0.8);
                    const currentSidebarWidth = (this as any)._node?.data?.sidebarWidth || 150;
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
        ((domWidget as any).computeSize as any) = function(this: any, width: number) {
            // タイトルバー(36px) + タブ(35px) + 出力ピン(1つ20px) + 最小エディタ(50px)
            const node = (this as any)._node;
            const outputHeight = node?.outputs ? node.outputs.length * 20 : 0;
            const minHeight = 36 + 35 + outputHeight + 50;
            
            // 最小幅 = サイドバー幅 + エディタ最小幅(50px)
            const sidebarWidth = node?.data?.sidebarWidth || 150;
            const minWidth = Math.max(width, sidebarWidth + 50);
            
            return [minWidth, minHeight];
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
                targetWidget.value = JSON.stringify(self.data);
            }
        };

        this.loadDataFromWidget(null);
    }

    private loadDataFromWidget(info: any) {
        const targetWidget = (this as any)._node?.widgets?.find((w:any) => w.name === "text");
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
            }
        } else {
            this.data = { tree: [], activeFileId: undefined, openedFileIds: [] };
            // 初期データがない場合はデフォルトのファイルを作成
            this.addItemWithName('file', 'default.txt');
            const firstFile = this.data.tree.find(i => i.type === 'file');
            if (firstFile) {
                this.openFile(firstFile.id);
            }
        }
    }

    private addItem(type: 'file' | 'folder', parentId?: string) {
        const name = prompt(`Enter ${type} name:`, `new_${type}`);
        if (!name) return;
        this.addItemWithName(type, name, parentId);
    }

    public addItemWithName(type: 'file' | 'folder', name: string, parentId?: string, content?: string) {
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
    }

    private renameItem(id: string, currentName: string) {
        const newName = prompt("Enter new name:", currentName);
        if (!newName || newName === currentName) return;

        const findAndRename = (items: TreeItem[]) => {
            for (const item of items) {
                if (item.id === id) {
                    item.name = newName;
                    return true;
                }
                if (item.children && findAndRename(item.children)) return true;
            }
            return false;
        };
        findAndRename(this.data.tree);
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
            tab.className = "webui-monaco-prompt-multitext-tab";
            if (this.data.activeFileId === fileId) {
                tab.classList.add("active");
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
            closeBtn.className = "webui-monaco-prompt-multitext-tab-close";
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
        rootDiv.className = "webui-monaco-prompt-multitext-tree"
        this.renderTreeItems(this.data.tree, rootDiv, 0)
        this.elements.treeContainer.appendChild(rootDiv)
    }

    private renderTreeItems(items: TreeItem[], parentEl: HTMLElement, depth: number) {
        for (const item of items) {
            const itemContainer = document.createElement("div")
            itemContainer.className = "webui-monaco-prompt-multitext-tree-item-wrapper"
            
            const itemEl = document.createElement("div")
            itemEl.className = "webui-monaco-prompt-multitext-tree-item"
            if (this.data.activeFileId === item.id) itemEl.classList.add("active")
            
            itemEl.draggable = true
            itemEl.addEventListener('dragstart', (e) => {
                e.dataTransfer?.setData("text/plain", item.id)
            })
            itemEl.addEventListener('dragover', (e) => {
                e.preventDefault()
                itemEl.classList.add("drag-over")
            })
            itemEl.addEventListener('dragleave', () => {
                itemEl.classList.remove("drag-over")
            })
            itemEl.addEventListener('drop', (e) => {
                e.preventDefault()
                itemEl.classList.remove("drag-over")
                const draggedId = e.dataTransfer?.getData("text/plain")
                if (draggedId && draggedId !== item.id) {
                    this.moveItem(draggedId, item.id)
                }
            })

            // インデント
            for (let i = 0; i < depth; i++) {
                const indent = document.createElement("span")
                indent.className = "webui-monaco-prompt-multitext-tree-indent"
                indent.style.width = "4px"
                indent.style.flexShrink = "0"
                itemEl.appendChild(indent)
            }

            // 矢印（整列のために常に作成、16px固定）
            const arrowContainer = document.createElement("span")
            arrowContainer.className = "webui-monaco-prompt-multitext-tree-arrow"
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
            iconEl.className = "webui-monaco-prompt-multitext-tree-icon"
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
            const nameEl = document.createElement("span")
            nameEl.className = "webui-monaco-prompt-multitext-tree-name"
            nameEl.textContent = item.name
            itemEl.appendChild(nameEl)

            // アクションボタン（右寄せされるコンテナ）
            const actionsEl = document.createElement("span")
            actionsEl.className = "webui-monaco-prompt-multitext-tree-actions"
            
            if (item.type === 'folder') {
                const addFile = document.createElement("span")
                addFile.className = "webui-monaco-prompt-multitext-tree-action"
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

            itemEl.onclick = (e) => {
                if (item.type === 'folder') {
                    item.expanded = !item.expanded
                    this.renderTree()
                } else {
                    this.openFile(item.id)
                }
            }

            itemContainer.appendChild(itemEl)

            if (item.type === 'folder' && item.expanded && item.children) {
                const childContainer = document.createElement("div")
                childContainer.className = "webui-monaco-prompt-multitext-tree-children"
                this.renderTreeItems(item.children, childContainer, depth + 1)
                itemContainer.appendChild(childContainer)
            }

            parentEl.appendChild(itemContainer)
        }
    }

    private moveItem(draggedId: string, targetId: string) {
        let draggedItem: TreeItem | undefined;
        let draggedParent: TreeItem[] | undefined;

        // ドラッグされたアイテムを探して元の場所から削除
        const findAndRemove = (items: TreeItem[], parentItems: TreeItem[]) => {
            for (let i = 0; i < items.length; i++) {
                if (items[i].id === draggedId) {
                    draggedItem = items.splice(i, 1)[0];
                    draggedParent = parentItems;
                    return true;
                }
                if (items[i].children && findAndRemove(items[i].children!, items[i].children!)) return true;
            }
            return false;
        };
        findAndRemove(this.data.tree, this.data.tree);

        if (!draggedItem) return;

        // 移動先を探して挿入
        const findAndInsert = (items: TreeItem[]) => {
            for (let i = 0; i < items.length; i++) {
                if (items[i].id === targetId) {
                    if (items[i].type === 'folder') {
                        // フォルダ内に追加
                        if (draggedItem) {
                            items[i].children!.push(draggedItem);
                        }
                        items[i].expanded = true;
                    } else {
                        // ファイルの隣（同じ階層）に追加
                        items.splice(i + 1, 0, draggedItem!);
                    }
                    return true;
                }
                if (items[i].children && findAndInsert(items[i].children!)) return true;
            }
            return false;
        };

        if (!findAndInsert(this.data.tree)) {
            // 見つからない場合はルート末尾へ
            this.data.tree.push(draggedItem);
        }

        this.commitData();
        this.renderTree();
    }
    
    private commitData() {
        const node = (this as any)._node;
        if (node) {
            const targetWidget = node.widgets?.find((w:any) => w.name === "text");
            if (targetWidget) {
                targetWidget.value = JSON.stringify(this.data);
                if (targetWidget.callback) {
                    try {
                        targetWidget.callback(targetWidget.value, undefined, node, undefined);
                    } catch (e) {}
                }
            }
            if (node.setDirtyCanvas) {
                node.setDirtyCanvas(true, true);
            }
        }
        if ((window as any).app && (window as any).app.graph) {
            try { (window as any).app.graph.change(); } catch(e) {}
        }
    }

    private get editorInstance(): any {
        return this.editor
    }

    onRemoved() {
        if (this.editor) {
            const id = this.editor.getInstanceId()
            if (link[id]) {
                const editor = this.editor
                editor.dispose()
                if (editor.parentElement) {
                    editor.parentElement.removeChild(editor)
                }
                delete link[id]
            }
        }
        for (const id of Object.keys(this.models)) {
            this.models[id].dispose()
        }
        this.models = {}
    }
}

export {
    MultiTextWidget
}
