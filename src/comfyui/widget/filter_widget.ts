
import { ui } from "../api"
import {default as style} from "./index.css"

const $el = (...args: any[]) => ui.$el(...args)

interface FilterRule {
    id: string;
    target: 'name' | 'path' | 'content';
    mode: 'regex' | 'include';
    not: boolean;
    value: string;
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
        
        // properties 初期化
        if (!node.properties) node.properties = {};
        if (!node.properties.rules) node.properties.rules = "[]";

        // CSSモジュールのハッシュ付きクラスと、E2E用の安定したクラスの両方を付与
        this.container.classList.add(style["webui-monaco-prompt-filter-container"] || "");
        this.container.classList.add("webui-monaco-prompt-filter-container"); 
        
        // onConfigure フック (シリアライズからの復元用)
        const oldOnConfigure = node.onConfigure;
        node.onConfigure = (config: any) => {
            this._isConfiguring = true;
            if (oldOnConfigure) oldOnConfigure.apply(node, [config]);
            
            // 1. properties から最優先でロード (LiteGraph で最も安定して保持される)
            if (config.properties && config.properties.rules) {
                this.loadRulesFromValue(config.properties.rules);
            } 
            // 2. widgets_values からフォールバック走査 (古い保存データ用)
            else if (config.widgets_values && Array.isArray(config.widgets_values)) {
                for (const val of config.widgets_values) {
                    if (typeof val === 'string' && val.includes('"id":') && val.includes('"target":')) {
                        this.loadRulesFromValue(val);
                        break;
                    }
                }
            }

            this.render();

            // タイミング問題を考慮した再試行
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
                if (attempts < 20) {
                    setTimeout(retryLoad, 100);
                } else {
                    this._isConfiguring = false;
                }
            };
            setTimeout(retryLoad, 50);
        };

        // 初期ロード
        this.loadRules();
        this.render();

        // ウィジェットの値がセットされるのを待つために、callback を設定
        this.setupWidgetCallback();
    }

    private setupWidgetCallback() {
        const findAndSetup = () => {
            const widget = this._node.widgets?.find((w: any) => w.name === "rules");
            if (widget) {
                const oldCallback = widget.callback;
                widget.callback = (v: any) => {
                    if (v === this._lastLoadedValue) return;

                    // 初期化時の null/"" は無視
                    if (!v || v === "") return;

                    // 復旧中の空配列は無視
                    if (this._isConfiguring && v === "[]") return;

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

        if (stringValue === "[]") {
            this.rules = [];
            this._lastLoadedValue = stringValue;
            if (this._node.properties) this._node.properties.rules = stringValue;
            return;
        }

        try {
            const parsed = JSON.parse(stringValue);
            if (Array.isArray(parsed)) {
                this.rules = parsed;
                this._lastLoadedValue = stringValue;
                // properties にも同期
                if (this._node.properties) this._node.properties.rules = stringValue;
            }
        } catch (e) {
            // 解析失敗は無視
        }
    }

    private loadRules() {
        let val = (this._node.properties && this._node.properties.rules);
        if (!val || val === "[]") {
            const widget = this._node.widgets?.find((w: any) => w.name === "rules");
            if (widget) val = widget.value;
        }
        this.loadRulesFromValue(val);
    }

    private saveRules() {
        const newVal = JSON.stringify(this.rules);
        this._lastLoadedValue = newVal;

        // properties への保存
        if (!this._node.properties) this._node.properties = {};
        this._node.properties.rules = newVal;

        // widget への保存
        const widget = this._node.widgets?.find((w: any) => w.name === "rules");
        if (widget && widget.value !== newVal) {
            widget.value = newVal;
        }
        
        this._node.setDirtyCanvas(true);
    }

    private render() {
        if (!this.container) return;
        this.container.innerHTML = "";
        
        const header = $el("div", { 
            className: `${style["webui-monaco-prompt-filter-header"] || ""} webui-monaco-prompt-filter-header` 
        }, [
            $el("span", { textContent: "Filters" }),
            $el("button", {
                className: `${style["webui-monaco-prompt-filter-add-btn"] || ""} webui-monaco-prompt-filter-add-btn`,
                textContent: "+",
                onclick: () => this.addRule()
            })
        ]);
        this.container.appendChild(header);

        const rulesList = $el("div", {
            className: `${style["webui-monaco-prompt-filter-rules-list"] || ""} webui-monaco-prompt-filter-rules-list`
        });
        
        this.rules.forEach((rule, index) => {
            const ruleRow = this.createRuleRow(rule, index);
            rulesList.appendChild(ruleRow);
        });

        this.container.appendChild(rulesList);
        
        const footer = $el("div", {
            className: `${style["webui-monaco-prompt-filter-footer"] || ""} webui-monaco-prompt-filter-footer`
        }, [
            $el("span", { 
                className: `${style["webui-monaco-prompt-filter-status"] || ""} webui-monaco-prompt-filter-status`,
                textContent: `Rules: ${this.rules.length}` 
            })
        ]);
        this.container.appendChild(footer);
    }

    private createRuleRow(rule: FilterRule, index: number): HTMLElement {
        const row = $el("div", {
            className: `${style["webui-monaco-prompt-filter-rule-row"] || ""} webui-monaco-prompt-filter-rule-row`,
            draggable: true,
            ondragstart: (e: DragEvent) => {
                e.dataTransfer?.setData("text/plain", index.toString());
                row.classList.add(style["dragging"] || "dragging");
            },
            ondragend: () => {
                row.classList.remove(style["dragging"] || "dragging");
            },
            ondragover: (e: DragEvent) => e.preventDefault(),
            ondrop: (e: DragEvent) => {
                const fromIndex = parseInt(e.dataTransfer?.getData("text/plain") || "-1");
                if (fromIndex !== -1 && fromIndex !== index) {
                    this.moveRule(fromIndex, index);
                }
            }
        });

        // ドラッグハンドル
        row.appendChild($el("span", { 
            className: `${style["webui-monaco-prompt-filter-handle"] || ""} webui-monaco-prompt-filter-handle`,
            textContent: "::" 
        }));

        // 演算子
        if (index > 0) {
            const opSelect = $el("select", {
                className: `${style["webui-monaco-prompt-filter-select"] || ""} webui-monaco-prompt-filter-select`,
                onchange: (e: any) => {
                    rule.operator = e.target.value;
                    this.saveRules();
                }
            }, [
                $el("option", { value: "AND", textContent: "AND", selected: rule.operator === "AND" }),
                $el("option", { value: "OR", textContent: "OR", selected: rule.operator === "OR" })
            ]);
            row.appendChild(opSelect);
        } else {
            row.appendChild($el("span", { 
                className: `${style["webui-monaco-prompt-filter-spacer"] || ""} webui-monaco-prompt-filter-spacer`
            }));
        }

        // Target
        const targetSelect = $el("select", {
            className: `${style["webui-monaco-prompt-filter-select"] || ""} webui-monaco-prompt-filter-select`,
            onchange: (e: any) => {
                rule.target = e.target.value;
                this.saveRules();
            }
        }, [
            $el("option", { value: "name", textContent: "Name", selected: rule.target === "name" }),
            $el("option", { value: "path", textContent: "Path", selected: rule.target === "path" }),
            $el("option", { value: "content", textContent: "Content", selected: rule.target === "content" })
        ]);
        row.appendChild(targetSelect);

        // Mode
        const modeSelect = $el("select", {
            className: `${style["webui-monaco-prompt-filter-select"] || ""} webui-monaco-prompt-filter-select`,
            onchange: (e: any) => {
                rule.mode = e.target.value;
                this.saveRules();
            }
        }, [
            $el("option", { value: "include", textContent: "Include", selected: rule.mode === "include" }),
            $el("option", { value: "regex", textContent: "Regex", selected: rule.mode === "regex" })
        ]);
        row.appendChild(modeSelect);

        // NOT
        const notBtn = $el("button", {
            className: `${style["webui-monaco-prompt-filter-not-btn"] || ""} webui-monaco-prompt-filter-not-btn ${rule.not ? (style["active"] || "active") : ""}`,
            textContent: "NOT",
            onclick: () => {
                rule.not = !rule.not;
                this.saveRules();
                this.render();
            }
        });
        row.appendChild(notBtn);

        // Value Input
        const valueInput = $el("input", {
            className: `${style["webui-monaco-prompt-filter-input"] || ""} webui-monaco-prompt-filter-input`,
            type: "text",
            value: rule.value || "",
            placeholder: "value...",
            oninput: (e: any) => {
                rule.value = e.target.value;
                this.saveRules();
            }
        });
        row.appendChild(valueInput);

        // Delete
        row.appendChild($el("button", {
            className: `${style["webui-monaco-prompt-filter-del-btn"] || ""} webui-monaco-prompt-filter-del-btn`,
            textContent: "×",
            onclick: () => this.deleteRule(index)
        }));

        return row;
    }

    private addRule() {
        const newRule: FilterRule = {
            id: Math.random().toString(36).substr(2, 9),
            target: 'name',
            mode: 'include',
            not: false,
            value: '',
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
