import { h, Fragment } from "preact";
import { useState } from "preact/hooks";
import * as utils from "../../utils";
import { default as style } from "../index.css";
import { FilterWidget, FilterRule } from "../filter_widget";
import { useFilterStore } from "../hooks/useFilterStore";

const getStyle = (name: string) => utils.getStyle(style, name);

const DRAG_TYPE = "application/x-filter-rule-index";

interface FilterUIProps {
    widget: FilterWidget;
}

export function FilterUI({ widget }: FilterUIProps) {
    const rules = useFilterStore(widget);
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

    // LiteGraphのキャンバスドラッグ等の干渉を完全に防ぐためのイベント絶縁処理
    const silence = (e: Event) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
    };

    // インプット要素用のカスタム文字選択ハンドラ (LiteGraphの干渉を回避するため)
    const handleInputMouseDown = (e: MouseEvent) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const input = e.currentTarget as HTMLInputElement;
        let isSelectionDragging = true;
        
        const getCharIdx = (me: MouseEvent) => {
            const rect = input.getBoundingClientRect();
            const x = me.clientX - rect.left - 5; // padding分を考慮
            const style = window.getComputedStyle(input);
            const fontSize = parseFloat(style.fontSize) || 11;
            const charWidth = fontSize * 0.55;
            return Math.max(0, Math.min(input.value.length, Math.round(x / charWidth)));
        };
        
        const startCharIdx = getCharIdx(e);
        input.focus();
        input.setSelectionRange(startCharIdx, startCharIdx);
        
        const handleMove = (moveEvent: MouseEvent) => {
            if (!isSelectionDragging) return;
            const curIdx = getCharIdx(moveEvent);
            input.setSelectionRange(Math.min(startCharIdx, curIdx), Math.max(startCharIdx, curIdx));
            moveEvent.stopPropagation();
        };
        
        const handleUp = () => {
            isSelectionDragging = false;
            window.removeEventListener("mousemove", handleMove, { capture: true });
            window.removeEventListener("mouseup", handleUp, { capture: true });
        };
        
        window.addEventListener("mousemove", handleMove, { capture: true });
        window.addEventListener("mouseup", handleUp, { capture: true });
    };

    return (
        <div className={getStyle("webui-monaco-prompt-filter-container")}>
            <div className={getStyle("webui-monaco-prompt-filter-header")}>
                <span>Filters</span>
                <button
                    className={getStyle("webui-monaco-prompt-filter-add-btn")}
                    onMouseDownCapture={silence}
                    onMouseUpCapture={silence}
                    onClick={() => widget.addRule()}
                >
                    +
                </button>
            </div>
            
            <div className={getStyle("webui-monaco-prompt-filter-rules-list")}>
                {rules.map((rule, index) => {
                    const rowClass = `${getStyle("webui-monaco-prompt-filter-rule-row")} ${
                        rule.disabled ? getStyle("disabled") : ""
                    } ${draggingIndex === index ? getStyle("webui-monaco-prompt-dragging") : ""}`;

                    return (
                        <div
                            key={rule.id}
                            className={rowClass}
                            onDragOver={(e) => {
                                if (e.dataTransfer?.types.includes(DRAG_TYPE)) {
                                    e.preventDefault();
                                }
                            }}
                            onDrop={(e) => {
                                const fromIdxStr = e.dataTransfer?.getData(DRAG_TYPE);
                                if (fromIdxStr) {
                                    const fromIndex = parseInt(fromIdxStr);
                                    if (!isNaN(fromIndex) && fromIndex !== index) {
                                        widget.moveRule(fromIndex, index);
                                    }
                                }
                            }}
                        >
                            {/* ドラッグハンドル */}
                            <span
                                className={getStyle("webui-monaco-prompt-filter-handle")}
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer?.setData(DRAG_TYPE, index.toString());
                                    if (e.dataTransfer && (e.dataTransfer as any).setDragImage) {
                                        const rowElement = (e.currentTarget as HTMLElement).parentElement;
                                        if (rowElement) {
                                            (e.dataTransfer as any).setDragImage(rowElement, 10, 10);
                                        }
                                    }
                                    setTimeout(() => setDraggingIndex(index), 10);
                                }}
                                onDragEnd={() => setDraggingIndex(null)}
                            >
                                ::
                            </span>

                            {/* 無効化トグルボタン */}
                            <button
                                className={`${getStyle("webui-monaco-prompt-filter-disable-btn")} ${
                                    rule.disabled ? getStyle("active") : ""
                                }`}
                                onMouseDownCapture={silence}
                                onMouseUpCapture={silence}
                                onClick={() => widget.toggleRuleDisabled(index)}
                            >
                                ⏻
                            </button>

                            {/* 結合演算子 (AND/OR) ※2個目以降のみ表示 */}
                            {index > 0 ? (
                                <select
                                    className={getStyle("webui-monaco-prompt-filter-select")}
                                    value={rule.operator || "AND"}
                                    onMouseDownCapture={silence}
                                    onMouseUpCapture={silence}
                                    onChange={(e) =>
                                        widget.updateRule(index, {
                                            operator: (e.target as HTMLSelectElement).value as "AND" | "OR",
                                        })
                                    }
                                >
                                    <option value="AND">AND</option>
                                    <option value="OR">OR</option>
                                </select>
                            ) : (
                                <span className={getStyle("webui-monaco-prompt-filter-spacer")} />
                            )}

                            {/* 対象 (Target) */}
                            <select
                                className={getStyle("webui-monaco-prompt-filter-select")}
                                value={rule.target || "name"}
                                onMouseDownCapture={silence}
                                onMouseUpCapture={silence}
                                onChange={(e) =>
                                    widget.updateRule(index, {
                                        target: (e.target as HTMLSelectElement).value as 'name' | 'path' | 'content',
                                    })
                                }
                            >
                                <option value="name">Name</option>
                                <option value="path">Path</option>
                                <option value="content">Content</option>
                            </select>

                            {/* 比較モード (Mode) */}
                            <select
                                className={getStyle("webui-monaco-prompt-filter-select")}
                                value={rule.mode || "include"}
                                onMouseDownCapture={silence}
                                onMouseUpCapture={silence}
                                onChange={(e) =>
                                    widget.updateRule(index, {
                                        mode: (e.target as HTMLSelectElement).value as 'regex' | 'include',
                                    })
                                }
                            >
                                <option value="include">Include</option>
                                <option value="regex">Regex</option>
                            </select>

                            {/* NOTトグルボタン */}
                            <button
                                className={`${getStyle("webui-monaco-prompt-filter-not-btn")} ${
                                    rule.not ? getStyle("active") : ""
                                }`}
                                onMouseDownCapture={silence}
                                onMouseUpCapture={silence}
                                onClick={() => widget.toggleRuleNot(index)}
                            >
                                NOT
                            </button>

                            {/* 判定値入力テキストボックス */}
                            <input
                                type="text"
                                className={getStyle("webui-monaco-prompt-filter-input")}
                                value={rule.value || ""}
                                placeholder="value..."
                                onMouseDownCapture={handleInputMouseDown}
                                onMouseUpCapture={silence}
                                onInput={(e) =>
                                    widget.updateRule(index, {
                                        value: (e.target as HTMLInputElement).value,
                                    })
                                }
                            />

                            {/* 削除ボタン */}
                            <button
                                className={getStyle("webui-monaco-prompt-filter-del-btn")}
                                onMouseDownCapture={silence}
                                onMouseUpCapture={silence}
                                onClick={() => widget.deleteRule(index)}
                            >
                                ×
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className={getStyle("webui-monaco-prompt-filter-footer")}>
                <span className={getStyle("webui-monaco-prompt-filter-status")}>
                    Rules: {rules.length}
                </span>
            </div>
        </div>
    );
}
