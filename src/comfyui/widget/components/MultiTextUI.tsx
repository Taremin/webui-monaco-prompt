import { h, Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { MultiTextWidget, getStyle } from "../multitext_widget";
import { useMultiTextStore } from "../hooks/useMultiTextStore";
import type { TreeItem } from "../multitext_widget";

export interface MultiTextUIProps {
    widget: MultiTextWidget;
}

function ToolbarButton({ icon, title, onClick, active }: { icon: string, title: string, onClick: (e: MouseEvent) => void, active?: boolean }) {
    return (
        <button
            title={title}
            className={`${getStyle("webui-monaco-prompt-multitext-toolbar-button")} ${active ? getStyle("active") : ""}`}
            onClick={(e) => {
                e.stopPropagation();
                onClick(e);
            }}
            dangerouslySetInnerHTML={{ __html: icon }}
        />
    );
}

export function MultiTextUI({ widget }: MultiTextUIProps) {
    const data = useMultiTextStore(widget);
    const [isSearchVisible, setSearchVisible] = useState(false);
    const [searchValue, setSearchValue] = useState("");
    
    // First component mount
    useEffect(() => {
        // Nothing needed here right now
    }, [widget]);

    const handleResizeStart = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        const startX = e.clientX;
        const startWidth = data.sidebarWidth || 150;
        const scale = (window as any).app?.canvas?.ds?.scale || 1.0;

        const handleMouseMove = (moveEv: MouseEvent) => {
            const newWidth = startWidth + (moveEv.clientX - startX) / scale;
            if (newWidth > 50 && newWidth < 600) {
                // UI層からManager層への通信（即時反映）
                widget.data.sidebarWidth = newWidth;
                widget.elements.sidebar?.style.setProperty("width", `${newWidth}px`, "important");
                widget.elements.sidebar?.style.setProperty("min-width", `${newWidth}px`, "important");
                // 通知せずにCSSだけ更新するか、Dataを更新するか。
                // 完全に一致させるため、ここは本来 widget.setSidebarWidth みたいにするのが望ましい
                (widget as any).editor?.monaco?.layout();
            }
        };

        const handleMouseUp = () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            // 最後にCommitして保存
            (widget as any).commitData();
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    };

    return (
        <Fragment>
            <div 
                className={getStyle("webui-monaco-prompt-multitext-sidebar")}
                style={{ width: data.sidebarWidth, minWidth: data.sidebarWidth }}
                // elements.sidebar として Widget に渡す必要があるかもしれないが、
                // 今回は Preact 側で width を制御する
                ref={el => { if (el) widget.elements.sidebar = el; }}
            >
                {/* ツールバー */}
                <div className={getStyle("webui-monaco-prompt-multitext-sidebar-toolbar")}>
                    <ToolbarButton icon={MultiTextWidget.ICONS.addFile} title="New File" onClick={() => (widget as any).addItem('file')} />
                    <ToolbarButton icon={MultiTextWidget.ICONS.addFolder} title="New Folder" onClick={() => (widget as any).addItem('folder')} />
                    <ToolbarButton icon={MultiTextWidget.ICONS.search} title="Search" onClick={() => setSearchVisible(!isSearchVisible)} />
                        <ToolbarButton 
                            icon={MultiTextWidget.ICONS.checklist} 
                            title="Toggle Selection Mode" 
                            active={data.selectionMode}
                            onClick={() => {
                                widget.data.selectionMode = !widget.data.selectionMode;
                                (widget as any).renderTree();  // レガシー層に再描画させる
                                (widget as any).commitData();
                            }} 
                        />
                </div>

                {/* 検索バー */}
                <div 
                    className={getStyle("webui-monaco-prompt-multitext-sidebar-search")} 
                    style={{ display: isSearchVisible ? "flex" : "none" }}
                    ref={el => { if (el) widget.elements.searchContainer = el; }}
                >
                    <div className={getStyle("webui-monaco-prompt-multitext-search-input-wrapper")}>
                        <input 
                            type="text"
                            placeholder="Search content..."
                            className={getStyle("webui-monaco-prompt-multitext-search-input")}
                            value={searchValue}
                            onInput={(e) => {
                                const val = (e.target as HTMLInputElement).value;
                                setSearchValue(val);
                                if (widget.elements.searchInput) {
                                    widget.elements.searchInput.value = val;
                                    (widget as any).executeSearch();
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") (widget as any).executeSearch();
                                if (e.key === "Escape") setSearchVisible(false);
                            }}
                            ref={el => { if (el) widget.elements.searchInput = el; }}
                        />
                        <button 
                            className={getStyle("webui-monaco-prompt-multitext-search-clear-btn")}
                            title="Clear Search"
                            dangerouslySetInnerHTML={{ __html: MultiTextWidget.ICONS.close }}
                            onClick={() => {
                                setSearchValue("");
                                if (widget.elements.searchInput) {
                                    widget.elements.searchInput.value = "";
                                    (widget as any).executeSearch();
                                    widget.elements.searchInput.focus();
                                }
                            }}
                        />
                    </div>
                </div>
                
                {/* 検索結果（レガシーな DOM 操作をそのまま受け入れるための箱） */}
                <div 
                    className={getStyle("webui-monaco-prompt-multitext-search-results")}
                    style={{ display: isSearchVisible ? "flex" : "none" }}
                    ref={el => { if (el) widget.elements.searchResults = el; }}
                />

                {/* Selection Toolbar */}
                {data.selectionMode && (
                    <div className={getStyle("webui-monaco-prompt-multitext-sidebar-selection-toolbar")} style={{ display: "flex" }}>
                        <ToolbarButton icon={MultiTextWidget.ICONS.checkAll} title="Check All" onClick={() => (widget as any).setAllOutput(true)} />
                        <ToolbarButton icon={MultiTextWidget.ICONS.uncheckAll} title="Uncheck All" onClick={() => (widget as any).setAllOutput(false)} />
                    </div>
                )}

                {/* Tree */}
                <div 
                    className={getStyle("webui-monaco-prompt-multitext-tree-container")}
                    style={{ flex: 1, overflowY: "auto" }}
                    // ⚠️ レガシーの renderTree() もここを使うため、ref を渡す
                    ref={el => { if (el) widget.elements.treeContainer = el; }}
                />
            </div>

            <div 
                className={getStyle("webui-monaco-prompt-multitext-resizer")} 
                onMouseDown={handleResizeStart}
            />

            <div className={getStyle("webui-monaco-prompt-multitext-main-area")} style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "visible" }}>
                {/* Tabs (レガシーの renderTabs 用の箱) */}
                <div 
                    className={getStyle("webui-monaco-prompt-multitext-tabs-container")}
                    style={{ height: "35px", background: "#252526", display: "flex", alignItems: "center", overflowX: "hidden", overflowY: "hidden", borderBottom: "1px solid #333" }}
                    onWheel={e => {
                        if (widget.elements.tabsContainer) {
                            widget.elements.tabsContainer.scrollLeft += e.deltaY;
                        }
                        e.preventDefault();
                    }}
                    ref={el => { if (el) widget.elements.tabsContainer = el; }}
                />

                {/* Editor Container */}
                <div 
                    className={getStyle("webui-monaco-prompt-multitext-editor-container")}
                    style={{ flex: 1, overflow: "visible", position: "relative", width: "100%", minHeight: "50px", display: "block" }}
                    ref={el => {
                        if (el && !widget.elements.editorContainer) {
                            widget.elements.editorContainer = el;
                            if (!(widget as any).editor && widget.data.activeFileId) {
                                widget.openFile(widget.data.activeFileId);
                            }
                        }
                    }}
                    data-editor-instance-id={widget.getItemPath ? widget.getItemPath(data.activeFileId || "") : "unknown"} // Monacoコンテナ保護・他との競合防止
                />
            </div>
        </Fragment>
    );
}
