import * as utils from "../utils"
import {default as style} from "./index.css"

const $el = utils.$el
const getStyle = (name: string) => utils.getStyle(style, name)

// 並べ替え操作を通常のテキストドラッグから隔離するための専用MIMEタイプ
const DRAG_TYPE = "application/x-filter-rule-index";

interface FilterRule {
    id: string;
    target: 'name' | 'path' | 'content';
    mode: 'regex' | 'include';
    not: boolean;
    value: string;
    disabled?: boolean;
    operator?: 'AND' | 'OR';
}

export class FilterWidget {
    _node: any;
    container: HTMLDivElement;
    rules: FilterRule[] = [];
    private _isConfiguring: boolean = false;
    private _lastLoadedValue: string = "";

    constructor(node: any) {
        this._node = node;
        this.container = document.createElement("div");
        
        if (!node.properties) node.properties = {};
        if (!node.properties.rules) node.properties.rules = "[]";

        this.container.classList.add(getStyle("webui-monaco-prompt-filter-container"));
        
        // --- LiteGraph 干渉の徹底排除 (Event Isolation) ---
        const isolate = (e: Event) => {
            const target = e.target as HTMLElement;
            if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "BUTTON") {
                // stopImmediatePropagation() により、同要素に設定された LiteGraph 側のリスナーを黙らせる
                e.stopImmediatePropagation();
                // さらに bubbling も止めて document レベルのハンドラに届かせない
                e.stopPropagation();
            }
        };

        // capture: true を指定して、LiteGraph のグローバルハンドラよりも先に捕まえる
        // click は自分自身のハンドラを動かすため、ここでの一括絶縁からは外す
        ["mousedown", "pointerdown", "mouseup", "pointerup", "dblclick", "contextmenu"].forEach(type => {
            this.container.addEventListener(type, isolate, { capture: true });
        });

        // 座標系や移動の干渉を避けるため、move も絶縁
        // 重要: move をキャプチャ層で完全に止めることで、LiteGraph 側のキャンバススクロールや
        // ノードドラッグロジック（mousemove で preventDefault して選択を殺す挙動）を阻止する。
        this.container.addEventListener("mousemove", isolate, { capture: true });
        this.container.addEventListener("pointermove", isolate, { capture: true });

        const oldOnConfigure = node.onConfigure;
        node.onConfigure = (config: any) => {
            this._isConfiguring = true;
            if (oldOnConfigure) oldOnConfigure.apply(node, [config]);
            if (config.properties && config.properties.rules) {
                this.loadRulesFromValue(config.properties.rules);
            } else if (config.widgets_values && Array.isArray(config.widgets_values)) {
                for (const val of config.widgets_values) {
                    if (typeof val === 'string' && val.includes('"id":') && val.includes('"target":')) {
                        this.loadRulesFromValue(val);
                        break;
                    }
                }
            }
            this.render();
            let attempts = 0;
            const retryLoad = () => {
                const widget = this._node.widgets?.find((w: any) => w.name === "rules");
                const currentVal = widget?.value || (this._node.properties && this._node.properties.rules);
                if (currentVal && currentVal !== "[]" && currentVal !== "" && currentVal !== this._lastLoadedValue) {
                    if (String(currentVal).includes('"id":')) {
                        this.loadRulesFromValue(currentVal);
                        this.render();
                        this._isConfiguring = false;
                        return;
                    }
                }
                attempts++;
                if (attempts < 20) setTimeout(retryLoad, 100);
                else this._isConfiguring = false;
            };
            setTimeout(retryLoad, 50);
        };

        this.loadRules();
        this.render();
        this.setupWidgetCallback();
    }

    private setupWidgetCallback() {
        const findAndSetup = () => {
            const widget = this._node.widgets?.find((w: any) => w.name === "rules");
            if (widget) {
                const oldCallback = widget.callback;
                widget.callback = (v: any) => {
                    if (v === this._lastLoadedValue) return;
                    if (!v || v === "") return;
                    if (oldCallback) oldCallback.apply(widget, [v]);
                    this.loadRulesFromValue(v);
                    this.render();
                };
            } else {
                requestAnimationFrame(findAndSetup);
            }
        };
        findAndSetup();
    }

    private loadRulesFromValue(value: any) {
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        if (!stringValue || stringValue === "" || stringValue === this._lastLoadedValue) return;
        try {
            const parsed = JSON.parse(stringValue);
            if (Array.isArray(parsed)) {
                this.rules = parsed;
                this._lastLoadedValue = stringValue;
            }
        } catch (e) {}
    }

    private loadRules() {
        let val = (this._node.properties && this._node.properties.rules);
        this.loadRulesFromValue(val);
    }

    private saveRules() {
        const newVal = JSON.stringify(this.rules);
        this._lastLoadedValue = newVal;
        if (!this._node.properties) this._node.properties = {};
        this._node.properties.rules = newVal;
        const widget = this._node.widgets?.find((w: any) => w.name === "rules");
        if (widget) {
            widget.value = newVal;
            if (widget.callback) widget.callback(newVal);
        }
        this._node.setDirtyCanvas(true);
    }

    private setupInput(el: HTMLElement) {
        el.setAttribute("draggable", "false");
        
        // LiteGraph の阻止 (強制的に capture で止める)
        // これによりノードのドラッグやキャンバスの移動が開始されるのを防ぐ
        const silence = (e: Event) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
        };
        el.addEventListener("mousedown", silence, { capture: true });
        el.addEventListener("mouseup", silence, { capture: true });

        // 文字選択エミュレーション。INPUT 要素のみ対象。
        if (el.tagName !== "INPUT") return;
        const input = el as HTMLInputElement;

        let isSelectionDragging = false;
        let startCharIdx = 0;

        const getCharIdx = (e: MouseEvent) => {
            const rect = input.getBoundingClientRect();
            const x = e.clientX - rect.left - 5; // padding分を考慮
            const style = window.getComputedStyle(input);
            const fontSize = parseFloat(style.fontSize) || 11;
            const charWidth = fontSize * 0.55;
            return Math.max(0, Math.min(input.value.length, Math.round(x / charWidth)));
        };

        input.addEventListener("mousedown", (e) => {
            isSelectionDragging = true;
            startCharIdx = getCharIdx(e);
            input.focus();
            input.setSelectionRange(startCharIdx, startCharIdx);
        });

        const handleMove = (me: MouseEvent) => {
            if (!isSelectionDragging) return;
            const curIdx = getCharIdx(me);
            input.setSelectionRange(Math.min(startCharIdx, curIdx), Math.max(startCharIdx, curIdx));
            me.stopPropagation();
        };

        const handleUp = (me: MouseEvent) => {
            isSelectionDragging = false;
            window.removeEventListener("mousemove", handleMove, { capture: true });
            window.removeEventListener("mouseup", handleUp, { capture: true });
        };

        window.addEventListener("mousemove", handleMove, { capture: true });
        window.addEventListener("mouseup", handleUp, { capture: true });
    }

    private render() {
        if (!this.container) return;
        this.container.innerHTML = "";
        const addBtn = $el("button", {
            className: getStyle("webui-monaco-prompt-filter-add-btn"),
            textContent: "+",
            onclick: () => this.addRule()
        });
        this.setupInput(addBtn);
        const header = $el("div", { 
            className: getStyle("webui-monaco-prompt-filter-header")
        }, [
            $el("span", { textContent: "Filters" }),
            addBtn
        ]);
        this.container.appendChild(header);
        const rulesList = $el("div", {
            className: getStyle("webui-monaco-prompt-filter-rules-list")
        });
        this.rules.forEach((rule, index) => {
            const ruleRow = this.createRuleRow(rule, index);
            rulesList.appendChild(ruleRow);
        });
        this.container.appendChild(rulesList);
        const footer = $el("div", {
            className: getStyle("webui-monaco-prompt-filter-footer")
        }, [
            $el("span", { 
                className: getStyle("webui-monaco-prompt-filter-status"),
                textContent: `Rules: ${this.rules.length}` 
            })
        ]);
        this.container.appendChild(footer);
    }

    private createRuleRow(rule: FilterRule, index: number): HTMLElement {
        const handleClass = getStyle("webui-monaco-prompt-filter-handle");
        const draggingClass = getStyle("webui-monaco-prompt-dragging");

        // 行自体は draggable ではない。
        const row = $el("div", {
            className: `${getStyle("webui-monaco-prompt-filter-rule-row")} ${rule.disabled ? getStyle("disabled") : ""}`
        });

        row.ondragover = (e: DragEvent) => {
            // 専用の DRAG_TYPE が含まれている場合のみドロップを許可
            if (e.dataTransfer?.types.includes(DRAG_TYPE)) {
                e.preventDefault();
            }
        };

        row.ondrop = (e: DragEvent) => {
            const fromIndexStr = e.dataTransfer?.getData(DRAG_TYPE);
            if (fromIndexStr) {
                const fromIndex = parseInt(fromIndexStr);
                if (!isNaN(fromIndex) && fromIndex !== index) {
                    this.moveRule(fromIndex, index);
                }
            }
        };

        // ハンドルだけを draggable にする
        const handle = $el("span", { 
            className: handleClass,
            textContent: "::"
        });
        handle.setAttribute("draggable", "true");

        handle.ondragstart = (e: DragEvent) => {
            e.dataTransfer?.setData(DRAG_TYPE, index.toString());
            if (e.dataTransfer && (e.dataTransfer as any).setDragImage) {
                (e.dataTransfer as any).setDragImage(row, 10, 10);
            }
            setTimeout(() => row.classList.add(draggingClass), 10);
        };

        handle.ondragend = () => {
            row.classList.remove(draggingClass);
        };

        row.appendChild(handle);

        const disableBtn = $el("button", {
            className: `${getStyle("webui-monaco-prompt-filter-disable-btn")} ${rule.disabled ? getStyle("active") : ""}`,
            textContent: "⏻",
            onclick: () => {
                rule.disabled = !rule.disabled;
                this.saveRules();
                this.render();
            }
        });
        this.setupInput(disableBtn);
        row.appendChild(disableBtn);

        if (index > 0) {
            const opSelect = $el("select", {
                className: getStyle("webui-monaco-prompt-filter-select"),
                onchange: (e: any) => {
                    rule.operator = e.target.value;
                    this.saveRules();
                }
            }, [
                $el("option", { value: "AND", textContent: "AND", selected: rule.operator === "AND" }),
                $el("option", { value: "OR", textContent: "OR", selected: rule.operator === "OR" })
            ]);
            this.setupInput(opSelect);
            row.appendChild(opSelect);
        } else {
            row.appendChild($el("span", { className: getStyle("webui-monaco-prompt-filter-spacer") }));
        }

        const targetSelect = $el("select", {
            className: getStyle("webui-monaco-prompt-filter-select"),
            onchange: (e: any) => {
                rule.target = e.target.value;
                this.saveRules();
            }
        }, [
            $el("option", { value: "name", textContent: "Name", selected: rule.target === "name" }),
            $el("option", { value: "path", textContent: "Path", selected: rule.target === "path" }),
            $el("option", { value: "content", textContent: "Content", selected: rule.target === "content" })
        ]);
        this.setupInput(targetSelect);
        row.appendChild(targetSelect);

        const modeSelect = $el("select", {
            className: getStyle("webui-monaco-prompt-filter-select"),
            onchange: (e: any) => {
                rule.mode = e.target.value;
                this.saveRules();
            }
        }, [
            $el("option", { value: "include", textContent: "Include", selected: rule.mode === "include" }),
            $el("option", { value: "regex", textContent: "Regex", selected: rule.mode === "regex" })
        ]);
        this.setupInput(modeSelect);
        row.appendChild(modeSelect);

        const notBtn = $el("button", {
            className: `${getStyle("webui-monaco-prompt-filter-not-btn")} ${rule.not ? getStyle("active") : ""}`,
            textContent: "NOT",
            onclick: () => {
                rule.not = !rule.not;
                this.saveRules();
                this.render();
            }
        });
        this.setupInput(notBtn);
        row.appendChild(notBtn);

        const valueInput = $el("input", {
            className: getStyle("webui-monaco-prompt-filter-input"),
            type: "text",
            value: rule.value || "",
            placeholder: "value...",
            oninput: (e: any) => {
                rule.value = e.target.value;
                this.saveRules();
            }
        });
        this.setupInput(valueInput);
        row.appendChild(valueInput);

        const delBtn = $el("button", {
            className: getStyle("webui-monaco-prompt-filter-del-btn"),
            textContent: "×",
            onclick: () => this.deleteRule(index)
        });
        this.setupInput(delBtn);
        row.appendChild(delBtn);

        return row;
    }

    private addRule() {
        const newRule: FilterRule = {
            id: utils.guid(),
            target: 'name',
            mode: 'include',
            not: false,
            value: '',
            disabled: false,
            operator: 'AND'
        };
        this.rules.push(newRule);
        this.saveRules();
        this.render();
    }

    private deleteRule(index: number) {
        this.rules.splice(index, 1);
        this.saveRules();
        this.render();
    }

    private moveRule(fromIndex: number, toIndex: number) {
        const item = this.rules.splice(fromIndex, 1)[0];
        this.rules.splice(toIndex, 0, item);
        this.saveRules();
        this.render();
    }
}
