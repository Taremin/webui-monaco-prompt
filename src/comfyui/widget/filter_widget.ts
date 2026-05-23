import * as utils from "../utils"
import { default as style } from "./index.css"
import { render, h } from "preact"
import { FilterUI } from "./components/FilterUI"

const getStyle = (name: string) => utils.getStyle(style, name)

export interface FilterRule {
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
    private _listeners: ((rules: FilterRule[]) => void)[] = [];

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
        ["mousedown", "pointerdown", "mouseup", "pointerup", "dblclick", "contextmenu"].forEach(type => {
            this.container.addEventListener(type, isolate, { capture: true });
        });

        // 座標系や移動の干渉を避けるため、move も絶縁
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
            this.notifyListeners();

            let attempts = 0;
            const retryLoad = () => {
                const widget = this._node.widgets?.find((w: any) => w.name === "rules");
                const currentVal = widget?.value || (this._node.properties && this._node.properties.rules);
                if (currentVal && currentVal !== "[]" && currentVal !== "" && currentVal !== this._lastLoadedValue) {
                    if (String(currentVal).includes('"id":')) {
                        this.loadRulesFromValue(currentVal);
                        this.render();
                        this.notifyListeners();
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

    public subscribe(listener: (rules: FilterRule[]) => void): () => void {
        this._listeners.push(listener);
        return () => {
            this._listeners = this._listeners.filter(l => l !== listener);
        };
    }

    public notifyListeners() {
        for (const listener of this._listeners) {
            listener(this.rules);
        }
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
                    this.notifyListeners();
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

    private render() {
        if (!this.container) return;
        render(h(FilterUI, { widget: this }), this.container);
    }

    // --- Preact側から呼び出されるAPIメソッド群 ---

    public addRule() {
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
        this.notifyListeners();
    }

    public deleteRule(index: number) {
        this.rules.splice(index, 1);
        this.saveRules();
        this.notifyListeners();
    }

    public moveRule(fromIndex: number, toIndex: number) {
        const item = this.rules.splice(fromIndex, 1)[0];
        this.rules.splice(toIndex, 0, item);
        this.saveRules();
        this.notifyListeners();
    }

    public updateRule(index: number, updates: Partial<FilterRule>) {
        if (this.rules[index]) {
            this.rules[index] = { ...this.rules[index], ...updates };
            this.saveRules();
            this.notifyListeners();
        }
    }

    public toggleRuleDisabled(index: number) {
        if (this.rules[index]) {
            this.rules[index].disabled = !this.rules[index].disabled;
            this.saveRules();
            this.notifyListeners();
        }
    }

    public toggleRuleNot(index: number) {
        if (this.rules[index]) {
            this.rules[index].not = !this.rules[index].not;
            this.saveRules();
            this.notifyListeners();
        }
    }
}
