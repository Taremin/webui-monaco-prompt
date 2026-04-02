import * as utils from "./utils"
import * as WebuiMonacoPrompt from "../index" // for typing
import { link } from "./link"
import { FindWidget, ReplaceWidget, MultiTextWidget, FilterWidget } from "./widget"
import { app, api } from "./api"
import { loadSetting, saveSettings, updateInstanceSettings } from "./settings"
import { comfyPrompt, comfyDynamicPrompt } from "./languages"
import { escapeHTML } from "../utils"
import { PresetDialog } from "../preset_dialog"

declare let __webpack_public_path__: any;

interface Window {
    WebuiMonacoPromptBaseURL: string
    WebuiMonacoPrompt: typeof WebuiMonacoPrompt
    WebuiMonacoPromptUtils: typeof utils
}
declare var window: Window
declare var LGraphCanvas: any

// set dynamic path
const srcURL = new URL(document.currentScript ? (document.currentScript as HTMLScriptElement).src : import.meta.url)
const dir = srcURL.pathname.split('/').slice(0, -1).join('/');
window.WebuiMonacoPromptBaseURL = dir + "/";
__webpack_public_path__ = dir + "/"

// codicon
utils.loadCodicon(dir)
utils.loadStyle(dir, "multitext.css")

// import は __webpack_public_path__ を使う場合は処理順の関係で使えない
const MonacoPrompt = require("../index") as typeof WebuiMonacoPrompt
window.WebuiMonacoPrompt = MonacoPrompt
window.WebuiMonacoPromptUtils = utils

// テスト用に露出
if (typeof window !== "undefined") {
    (window as any).WebuiMonacoPrompt = {
        ...(window as any).WebuiMonacoPrompt,
        getPresetDialog: () => getPresetDialog(),
        showPresetManager: () => showPresetManager(),
    }
}

const languages = [
    {id: "comfy-prompt", lang: comfyPrompt},
    {id: "comfy-dynamic-prompt", lang: comfyDynamicPrompt},
]
MonacoPrompt.addLanguages(languages)

const models = [
    {
        keybinding: WebuiMonacoPrompt.KeyMod.chord(
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM,
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM
        ),
        model: "checkpoints"
    },
    {
        keybinding: WebuiMonacoPrompt.KeyMod.chord(
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM,
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyL
        ),
        model: "loras"
    },
    {
        keybinding: WebuiMonacoPrompt.KeyMod.chord(
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM,
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyE
        ),
        model: "embeddings"
    },
    {
        keybinding: WebuiMonacoPrompt.KeyMod.chord(
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM,
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyH
        ),
        model: "hypernetworks"
    },
    {
        keybinding: WebuiMonacoPrompt.KeyMod.chord(
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM,
            WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyA
        ),
        model: "vae"
    },
]
type ComfyAPIModels = string[] | {name: string, pathIndex: number}[]
for (const {keybinding, model} of models) {
    MonacoPrompt.addCustomSuggest(model, keybinding, async () => {
        const items: Partial<WebuiMonacoPrompt.CompletionItem>[] = []
        const models = await api.getModels(model) as ComfyAPIModels
        const modelNames = new Set<string>()

        models.forEach(model => {
            const name = typeof model === "string" ? model : model.name
            modelNames.add(name)
        })

        modelNames.forEach(modelName => {
            items.push({
                label: modelName,
                kind: WebuiMonacoPrompt.CompletionItemKind.File,
                insertText: modelName,
            })
        })
        return items
    })
}

// snippet
MonacoPrompt.addCustomSuggest(
    "snippet",
    WebuiMonacoPrompt.KeyMod.chord(
        WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyM,
        WebuiMonacoPrompt.KeyMod.CtrlCmd | WebuiMonacoPrompt.KeyCode.KeyS,
    ),
    async () => {
        const items: Partial<WebuiMonacoPrompt.CompletionItem>[] = []
        const snippets = await api.fetchApi("/webui-monaco-prompt/snippet").then((res: Response) => res.json())

        for (const snippet of snippets) {
            const usage = `**${escapeHTML(snippet.insertText)}**`
            items.push({
                label: snippet.label,
                kind: WebuiMonacoPrompt.CompletionItemKind.Snippet,
                insertText: snippet.insertText,
                insertTextRules: WebuiMonacoPrompt.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: snippet.path,
                documentation: {
                    supportHtml: true,
                    value: snippet.documentation ?
                        [
                            usage,
                            snippet.documentation
                        ].join("<br><br>") :
                        usage
                },
            })
        }

        return items
    }
)
async function refreshSnippets() {
    await api.fetchApi("/webui-monaco-prompt/snippet-refresh").then((res: Response) => res.json())
    return
}

let csvfiles: string[]
async function loadCSVContent (files: string[]) {
    MonacoPrompt.clearCSV()

    for (const filename of files) {
        if (!filename) continue
        const path = [dir, filename].join('/')
        const filenameParts = filename.split('.')
        const basename = filenameParts[0]
        const value = await fetch(path + '?t=' + Date.now()).then(res => res.text())
        MonacoPrompt.addCSV(basename, value)
    }
}

async function refreshCSV() {
    csvfiles = await fetch("/webui-monaco-prompt/csv").then(res => res.json())
    // 内部的な CSV 内容の読み込み
    await loadCSVContent(csvfiles)
}


function getCSSRules(target: string[]) {
    const targetSet = new Set(target)
    const result: {[key: string]: CSSStyleDeclaration[]} = {}

    for (const  styleSheet of  document.styleSheets) {
        try {
            for (const rule of styleSheet.cssRules) {
                if (rule instanceof CSSStyleRule) {
                    if (targetSet.has(rule.selectorText)) {
                        if (!Array.isArray(result[rule.selectorText])) {
                            result[rule.selectorText] = []
                        }
                        result[rule.selectorText].push(rule.style)
                    }
                }
            }
        } catch(e) { /* ignore CORS */ }
    }

    return result
}

function getZIndex(styles: CSSStyleDeclaration[] = []) {
    for (const style of styles) {
        const zIndex = style.getPropertyValue("z-index")
        if (zIndex) {
            return ((zIndex as unknown as number) | 0)
        }
    }

    return 0
}

const rules = getCSSRules([".graphdialog"])
const graphDialogZIndex = getZIndex(rules[".graphdialog"]) || 1000

function styleToString(s: CSSStyleDeclaration, list: string[], isExclude=true) {
    const result = []
    const listset = new Set(list)

    for (let i = 0, il = s.length; i < il; ++i) {
        const prop = s[i]
        if (listset.has(prop) === isExclude) {
           continue
        }
        const priority = s.getPropertyPriority(s[i])
        result.push(`${prop}: ${s.getPropertyValue(prop)}${priority === "" ? "" : " !" + priority};`)
    }

    return result.join("\n")
}

function onCreateTextarea(textarea: HTMLTextAreaElement, node: any, force = false) {
    if (!force) {
        const isReplace = app.ui.settings.getSettingValue("WebuiMonacoPrompt.ReplaceTextarea")
        if (isReplace === false) {
            return
        }
    }

    if (textarea.dataset.webuiMonacoPromptTextareaId) {
        return
    }
    if (textarea.readOnly) {
        return
    }

    let editor: any
    try {
        editor = new WebuiMonacoPrompt.PromptEditor(textarea, {
            autoLayout: true,
            handleTextAreaValue: true,
            groupId: "comfyui",
        })
    } catch (e) {
        console.error("[WebuiMonacoPrompt] Failed to create PromptEditor", e)
        return
    }

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.target !== textarea) continue
            // Never mirror textarea display:none onto the editor
            editor.style.cssText = styleToString((mutation.target as HTMLTextAreaElement).style, ["display"])
        }
    })
    editor.style.zIndex = "" + (graphDialogZIndex - 1)
    observer.observe(textarea, {
        attributes: true,
        attributeFilter: ["style"]
    })
    editor.style.cssText = styleToString(textarea.style, ["display"])

    Object.assign(editor.elements.header!.style, { backgroundColor: "#444", fontSize: "small" })
    Object.assign(editor.elements.footer!.style, { backgroundColor: "#444", fontSize: "small" })
    
    const id = editor.getInstanceId()
    textarea.dataset.webuiMonacoPromptTextareaId = "" + id
    editor.dataset.webuiMonacoPromptTextareaId = "" + id
    link[id] = {
        textarea: textarea,
        monaco: editor,
        observer: observer,
        node: node,
    }

    utils.applyCommonEditorSetup(app, editor, node)
    const attachEditor = () => {
        const parent = textarea.parentElement
        if (parent && (!editor.isConnected || editor.parentElement !== parent)) {
            parent.append(editor)
            return true
        }
        return false
    }
    const attachObserver = new MutationObserver(() => {
        if (!editor.isConnected) {
            attachEditor()
        }
    })
    attachObserver.observe(document.body, { childList: true, subtree: true })
    attachEditor()
    ;(editor as any)._attachObserver = attachObserver
    const attachInterval = setInterval(() => {
        if (!editor.isConnected) {
            attachEditor()
        }
    }, 500)
    ;(editor as any)._attachIntervalId = attachInterval

    registerPromptEditor(editor)
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
    if (typeof(id) !== 'string') return

    const ctx = link[id]
    ctx.observer.disconnect()
    const editor = ctx.monaco
    const attachObserver = (editor as any)._attachObserver
    if (attachObserver) {
        attachObserver.disconnect()
    }
    const attachIntervalId = (editor as any)._attachIntervalId
    if (attachIntervalId) {
        clearInterval(attachIntervalId)
    }
    editor.dispose()
    if (editor.parentElement) {
        editor.parentElement.removeChild(ctx.monaco)
    }
    MonacoPrompt.PromptEditorManager.getGroup("comfyui").unregister(editor)
    delete link[id]
}

let presetDialog: PresetDialog | null = null

export function showPresetManager() {
    getPresetDialog().show()
}

function getPresetDialog() {
    if (!presetDialog) {
        presetDialog = new PresetDialog({
            onSave: (name, features) => {
                const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-')
                MonacoPrompt.addUserPreset({
                    id,
                    label: name,
                    features: features || {},
                    isBuiltin: false
                })
                MonacoPrompt.PromptEditorManager.getGroup("comfyui").updateSettings({
                    languagePreset: id,
                    languageFeatures: features || {}
                })
                return true
            },
            onApply: (id) => {
                MonacoPrompt.PromptEditorManager.getGroup("comfyui").updateSettings({
                    languagePreset: id
                })
            },
            onDelete: (id) => {
                MonacoPrompt.removeUserPreset(id)
                MonacoPrompt.PromptEditorManager.getGroup("comfyui").rebuildLanguage()
                // 全インスタンスのUI（セレクトボックス）を更新
                MonacoPrompt.PromptEditorManager.runAllInstances((instance) => {
                    instance.updatePresetOptions()
                    // trigger save manually
                    saveSettings(instance as any)
                })
                // Trigger updateSettings to force saving userPresets
                MonacoPrompt.PromptEditorManager.getGroup("comfyui").updateSettings({
                    userPresets: MonacoPrompt.getUserPresets()
                })
            },
            getCurrentFeatures: () => {
                return MonacoPrompt.PromptEditorManager.getGroup("comfyui").getSettings().languageFeatures || {}
            }
        })
    }
    return presetDialog
}

function registerPromptEditor(instance: any) {
    instance.onOpenPresetDialog = () => {
        getPresetDialog().show()
    }
}

function hookNodeWidgets(node: any) {
    if (!node.widgets) return
    const processWidget = (widget: any) => {
        if (widget.element instanceof HTMLTextAreaElement) {
            const isReplace = app.ui.settings.getSettingValue("WebuiMonacoPrompt.ReplaceTextarea")
            if (isReplace !== false) {
                onCreateTextarea(widget.element, node, true)
            }
            return true
        }
        return false
    }

    for (const widget of node.widgets) {
        if (node.comfyClass === "WebuiMonacoPromptMultiText" && widget.name === "text") continue
        
        if (!processWidget(widget)) {
            let timeoutId: any = null;
            const observer = new MutationObserver(() => {
                if (widget.element) {
                    if (processWidget(widget)) {
                        cleanup();
                    }
                }
            });

            const cleanup = () => {
                observer.disconnect();
                if (timeoutId) clearTimeout(timeoutId);
            };

            observer.observe(document.body, { childList: true, subtree: true });
            timeoutId = setTimeout(() => {
                cleanup();
            }, 5000);

            if (widget.element) {
                if (processWidget(widget)) {
                    cleanup();
                }
            }
        }
    }
    const onRemovedOriginal = node.onRemoved
    node.onRemoved = function() {
        if (onRemovedOriginal) onRemovedOriginal.apply(this, arguments)
        for (const widget of node.widgets) {
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
    find: { nodeType: "WebuiMonacoPromptFind", widget: FindWidget as any },
    replace: { nodeType: "WebuiMonacoPromptReplace", widget: ReplaceWidget as any },
    multitext: { nodeType: "WebuiMonacoPromptMultiText", widget: MultiTextWidget as any },
    json_filter: {
        nodeType: "WebuiMonacoPromptJsonFilter",
        widget: class {
            static fromNode(app: any, node: any) {
                const rulesWidget = node.widgets.find((w: any) => w.name === "rules");
                if (rulesWidget) {
                    rulesWidget.type = "hidden";
                    rulesWidget.beforeQueued = function() {
                        this.value = node.properties.rules || [];
                    };
                    rulesWidget.serializeValue = function() {
                        return node.properties.rules || [];
                    };
                }
                const filterWidget = new FilterWidget(node);
                const domWidget = node.addDOMWidget("webui-monaco-prompt-filter", "filter", filterWidget.container, {
                    hideOnZoom: true,
                    serialize: false,
                });
                (domWidget as any)._node = node;
                (domWidget as any).computeSize = function(this: any, width: number) {
                    const n = this._node || node;
                    const targetHeight = n && n.size ? Math.max(50, n.size[1] - 36 - (n.outputs ? n.outputs.length * 20 : 0)) : 200;
                    return [width, targetHeight];
                };
            }
        } as any,
    },
}

const CustomNodeFromNodeType = Object.fromEntries(
    Object.entries(CustomNode).map(([key, value]) => [value.nodeType, value])
)

const register = (app: any) => {
    const multiTextNodes = new Set<any>()
    app.registerExtension({
        name: ["Taremin", "WebuiMonacoPrompt"].join('.'),
        async beforeRegisterNodeDef(nodeType: any) {
            const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
            nodeType.prototype.getExtraMenuOptions = function(canvas: any, options: any[]) {
                if (originalGetExtraMenuOptions) originalGetExtraMenuOptions.apply(this, arguments);

                if (multiTextNodes.size > 0) {
                    options.push({
                        content: "Add to MultiText",
                        has_submenu: true,
                        callback: (value: any, options: any, e: MouseEvent, menu: any) => {
                            new (window as any).LiteGraph.ContextMenu(
                                Array.from(multiTextNodes).map((tn: any) => ({
                                    content: `#${tn.id}: ${tn.title || tn.type}`,
                                    callback: () => {
                                        for (const sn of Object.values(app.canvas.selected_nodes) as any[]) {
                                            const widget = sn.widgets?.find((w: any) => w.element instanceof HTMLTextAreaElement);
                                            if (tn.multitext_widget) {
                                                tn.multitext_widget.addItemWithName('file', sn.title || sn.type, null, widget ? widget.value : "");
                                                app.canvas.setDirty(true);
                                            }
                                        }
                                    }
                                })),
                                { event: e, parentMenu: menu }
                            );
                        }
                    });
                }
            };
        },
        async setup() {
            let isInternalSyncing = true;
            const addSetting = (id: string, name: string, type: string, defaultValue: any, tooltip?: string, options?: any) => {
                const settingDefinition: any = {
                    id, name, type, defaultValue, tooltip,
                    onChange: (value: any) => {
                        const map: Record<string, string> = {
                            "WebuiMonacoPrompt.Minimap": "minimap",
                            "WebuiMonacoPrompt.LineNumbers": "lineNumbers",
                            "WebuiMonacoPrompt.ReplaceUnderscore": "replaceUnderscore",
                            "WebuiMonacoPrompt.KeyBindings": "mode",
                            "WebuiMonacoPrompt.Theme": "theme",
                            "WebuiMonacoPrompt.LanguagePreset": "languagePreset",
                            "WebuiMonacoPrompt.ShowHeader": "showHeader",
                            "WebuiMonacoPrompt.FontSize": "fontSize",
                            "WebuiMonacoPrompt.FontFamily": "fontFamily",
                            "WebuiMonacoPrompt.CsvToggle": "csvToggle",
                        }
                        const key = map[id]
                        if (key) {
                            WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui").updateSettings({ [key]: value })
                        } else if (id.startsWith("WebuiMonacoPrompt.LanguageFeature.")) {
                            const featureId = id.replace("WebuiMonacoPrompt.LanguageFeature.", "")
                            const boolValue = value === true || value === "true" || value === 1;
                            const currentFeatures = WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui").getSettings().languageFeatures || {}
                            WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui").updateSettings({
                                languageFeatures: { ...currentFeatures, [featureId]: boolValue }
                            })
                        }

                        if (isInternalSyncing || (window as any).WebuiMonacoPrompt_isSaving) return;

                        if (id === "WebuiMonacoPrompt.LanguagePreset") {
                            const preset = WebuiMonacoPrompt.getPreset(value)
                            if (preset) {
                                isInternalSyncing = true;
                                (async () => {
                                    for (const [featureId, enabled] of Object.entries((preset as any).features)) {
                                        await app.ui.settings.setSettingValue(`WebuiMonacoPrompt.LanguageFeature.${featureId}`, enabled)
                                    }
                                    isInternalSyncing = false
                                })()
                            }
                        } else if (id.startsWith("WebuiMonacoPrompt.LanguageFeature.")) {
                            isInternalSyncing = true
                            app.ui.settings.setSettingValue("WebuiMonacoPrompt.LanguagePreset", WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui").getSettings().languagePreset || "custom")
                            isInternalSyncing = false
                        }
                    }
                }
                if (options) {
                    const originalOnChange = settingDefinition.onChange;
                    const optionsOnChange = options.onChange;
                    Object.assign(settingDefinition, options);
                    if (optionsOnChange) {
                        settingDefinition.onChange = (value: any) => {
                            if (originalOnChange) originalOnChange(value);
                            optionsOnChange(value);
                        };
                    }
                }
                return app.ui.settings.addSetting(settingDefinition)
            }

            // V2 UI の初期化完了を待つために少し遅延させる
            await new Promise(resolve => setTimeout(resolve, 500));

            addSetting("WebuiMonacoPrompt.ShowHeader", "Show Header", "boolean", false)      
            addSetting("WebuiMonacoPrompt.Minimap", "Show Minimap", "boolean", true)        
            addSetting("WebuiMonacoPrompt.LineNumbers", "Show Line Numbers", "boolean", true)
            addSetting("WebuiMonacoPrompt.ReplaceUnderscore", "Replace Underscore", "boolean", false)
            addSetting("WebuiMonacoPrompt.FontSize", "Font Size", "slider", 12, "", { attrs: { min: 8, max: 48, step: 1 } })
            addSetting("WebuiMonacoPrompt.FontFamily", "Font Family", "text", "")
            addSetting("WebuiMonacoPrompt.LanguagePreset", "Language Preset", "combo", "comfy-dynamic-prompt", "", { options: [...WebuiMonacoPrompt.getAllPresets().map(p => p.id), "custom"] })
            addSetting("WebuiMonacoPrompt.KeyBindings", "Key Bindings", "combo", "NORMAL", "", { options: ["NORMAL", "VIM"] })
            addSetting("WebuiMonacoPrompt.Theme", "Theme", "combo", "vsc-dark", "", { options: ["vs", "vs-dark", "hc-black", "hc-light"] })
            addSetting("WebuiMonacoPrompt.CsvToggle", "CSV Toggle", "hidden", {})
            addSetting("WebuiMonacoPrompt.LanguageUserPresets", "User Presets", "hidden", [])

            const defaultFeatures = WebuiMonacoPrompt.getPreset('comfy-dynamic-prompt')?.features || {}
            for (const feature of WebuiMonacoPrompt.getAllFeatures()) {
                const featureId = `WebuiMonacoPrompt.LanguageFeature.${feature.id}`
                const existingValue = app.ui.settings.getSettingValue(featureId)
                const presetDefault = feature.id in defaultFeatures ? defaultFeatures[feature.id] : false
                addSetting(featureId, `Language Feature: ${feature.label}`, "boolean", existingValue !== undefined ? existingValue : presetDefault)
            }

            addSetting("WebuiMonacoPrompt.ReplaceTextarea", "Replace Textarea", "boolean", true, "", {
                onChange: (value: boolean) => {
                    const nodes = app.graph._nodes
                    for (const node of nodes) {
                        if (!node.widgets) continue;
                        for (const widget of node.widgets) {
                            if (node.comfyClass === "WebuiMonacoPromptMultiText" && widget.name === "text") continue;
                            if (widget.element instanceof HTMLTextAreaElement) {
                                if (value) onCreateTextarea(widget.element, node, true);
                                else onRemoveTextarea(widget.element);
                            }
                        }
                    }
                }
            })

            // ManagePresets Button for V2
            addSetting("WebuiMonacoPrompt.ManagePresets", "Manage Language Presets", "custom", null, "", {
                type: (name: string) => {
                    const row = document.createElement("tr");
                    const labelCell = document.createElement("td");
                    labelCell.textContent = name;
                    labelCell.style.padding = "8px";
                    const btnCell = document.createElement("td");
                    btnCell.style.padding = "8px";
                    btnCell.style.textAlign = "right";
                    const btn = document.createElement("button");
                    btn.textContent = "Open Dialog";
                    btn.className = "comfy-btn";
                    btn.style.width = "auto";
                    btn.onclick = () => getPresetDialog().show();
                    btnCell.appendChild(btn);
                    row.append(labelCell, btnCell);
                    return row;
                }
            });

            // CSV Toggle List for V2
            addSetting("WebuiMonacoPrompt.CSVSettings", "CSV Enabled Files", "custom", null, "", {
                type: (name: string) => {
                    const container = document.createElement("div");
                    container.style.padding = "8px";
                    const list = document.createElement("div");
                    list.style.display = "flex";
                    list.style.flexDirection = "column";
                    list.style.gap = "4px";
                    const csvToggle = app.ui.settings.getSettingValue("WebuiMonacoPrompt.CsvToggle") || {};
                    if (csvfiles && csvfiles.length > 0) {
                        for (const csv of csvfiles) {
                            const row = document.createElement("label");
                            row.style.display = "flex";
                            row.style.alignItems = "center";
                            row.style.gap = "8px";
                            row.style.cursor = "pointer";
                            const cb = document.createElement("input");
                            cb.type = "checkbox";
                            
                            // 拡張子を除いたベース名をキーにする
                            const basename = csv.split('.')[0];
                            const key = `csv.${basename}`;
                            
                            cb.checked = csvToggle[key] !== false;
                            cb.onchange = () => {
                                const current = { ...(app.ui.settings.getSettingValue("WebuiMonacoPrompt.CsvToggle") || {}) };
                                current[key] = cb.checked;
                                WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui").updateSettings({ csvToggle: current });
                                const instances = (WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui") as any).editors;
                                for (const instance of instances) {
                                    saveSettings(instance);
                                }
                            };
                            row.appendChild(cb);
                            row.appendChild(document.createTextNode(csv));
                            list.appendChild(row);
                        }
                    } else {
                        const empty = document.createElement("div");
                        empty.textContent = "No CSV files found or still loading...";
                        empty.style.opacity = "0.5";
                        list.appendChild(empty);
                    }
                    container.appendChild(list);
                    const tr = document.createElement("tr");
                    const td = document.createElement("td");
                    td.colSpan = 2;
                    td.appendChild(container);
                    tr.appendChild(td);
                    return tr;
                }
            });

            try {
                await refreshCSV()
                await loadSetting()
            } catch (e) {
                console.error("[WebuiMonacoPrompt] Error during initial CSV/Settings load:", e)
            }

            // Settings Sync Listener
            const onSettingsChanged = (e: any) => {
                if (isInternalSyncing || (window as any).WebuiMonacoPrompt_isSaving) return;
                const id = e.detail?.id || e.detail;
                if (id && id.startsWith("WebuiMonacoPrompt.")) {
                    const instances = (WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui") as any).editors;
                    for (const instance of instances) {
                        try { updateInstanceSettings(instance); } catch(err) {}
                    }
                }
            };
            (window as any).addEventListener("comfy-settings-changed", onSettingsChanged);
            (window as any).addEventListener("comfy-setting-changed", onSettingsChanged);
            document.addEventListener("comfy-settings-changed", onSettingsChanged);
            document.addEventListener("comfy-setting-changed", onSettingsChanged);

            if (app.refreshComboInNodes) {
                const original = app.refreshComboInNodes
                app.refreshComboInNodes = async function() {
                    const res = original.apply(this, arguments)
                    await refreshCSV()
                    await loadSetting()
                    return res
                }
            }

            // Replace existing textareas
            for (const node of app.graph._nodes) {
                hookNodeWidgets(node)
                // hookNodeWidgets 内部で register されているはずだが、念のため
                const instances = (WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui") as any).editors;
                for (const instance of instances) {
                    registerPromptEditor(instance);
                }

                const nodeType = node.type || node.comfyClass;
                if (nodeType === "WebuiMonacoPromptMultiText") {
                    multiTextNodes.add(node);
                    const originalOnRemoved = node.onRemoved;
                    node.onRemoved = function() {
                        if (originalOnRemoved) originalOnRemoved.apply(this, arguments);
                        multiTextNodes.delete(node);
                    }
                }
                const customNode = CustomNodeFromNodeType[nodeType]
                if (customNode) customNode.widget.fromNode(app, node)
            }

            // Initial delay apply
            const initialInstances = (WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui") as any).editors;
            for (const instance of initialInstances) {
                updateInstanceSettings(instance);
            }
            isInternalSyncing = false;
        },
        nodeCreated(node:any) {
            hookNodeWidgets(node)
            const nodeType = node.type || node.comfyClass;
            if (nodeType === "WebuiMonacoPromptMultiText") {
                multiTextNodes.add(node);
                const originalOnRemoved = node.onRemoved;
                node.onRemoved = function() {
                    if (originalOnRemoved) originalOnRemoved.apply(this, arguments);
                    multiTextNodes.delete(node);
                }
            }
            const customNode = CustomNodeFromNodeType[nodeType]
            if (customNode) customNode.widget.fromNode(app, node)
        },
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

if (app) register(app)
