import * as MonacoPrompt from './index'
import { deepEqual } from 'fast-equals'
import { EndPoint, GetEmbeddings, CSV } from '../extension.json'
declare const gradio_config: any;

const me = "webui-monaco-prompt";

((srcURL) => {
    let isLoaded = false

    const models = [
        {
            keybinding: MonacoPrompt.KeyMod.chord(
                MonacoPrompt.KeyMod.CtrlCmd | MonacoPrompt.KeyCode.KeyM,
                MonacoPrompt.KeyMod.CtrlCmd | MonacoPrompt.KeyCode.KeyM
            ),
            model: "sd-models"
        },
        {
            keybinding: MonacoPrompt.KeyMod.chord(
                MonacoPrompt.KeyMod.CtrlCmd | MonacoPrompt.KeyCode.KeyM,
                MonacoPrompt.KeyMod.CtrlCmd | MonacoPrompt.KeyCode.KeyL
            ),
            model: "loras"
        },
        {
            keybinding: MonacoPrompt.KeyMod.chord(
                MonacoPrompt.KeyMod.CtrlCmd | MonacoPrompt.KeyCode.KeyM,
                MonacoPrompt.KeyMod.CtrlCmd | MonacoPrompt.KeyCode.KeyE
            ),
            model: "embeddings"
        },
        {
            keybinding: MonacoPrompt.KeyMod.chord(
                MonacoPrompt.KeyMod.CtrlCmd | MonacoPrompt.KeyCode.KeyM,
                MonacoPrompt.KeyMod.CtrlCmd | MonacoPrompt.KeyCode.KeyH
            ),
            model: "hypernetworks"
        },
        {
            keybinding: MonacoPrompt.KeyMod.chord(
                MonacoPrompt.KeyMod.CtrlCmd | MonacoPrompt.KeyCode.KeyM,
                MonacoPrompt.KeyMod.CtrlCmd | MonacoPrompt.KeyCode.KeyA
            ),
            model: "sd-vae"
        },
    ]
    for (const {keybinding, model} of models) {
        MonacoPrompt.addCustomSuggest(model, keybinding, async () => {
            const items: Partial<MonacoPrompt.CompletionItem>[] = []
            const models = await fetch(`/sdapi/v1/${model}`).then(res => res.json())
            switch (model) {
                case "sd-models":
                case "sd-vae":
                    (models as {model_name: string, filename: string}[]).forEach(model => {
                        const label = model.model_name
                        items.push({
                            label: label,
                            kind: MonacoPrompt.CompletionItemKind.File,
                            insertText: label,
                        })
                    })
                    break
                case "hypernetworks":
                    (models as {name: string, path: string}[]).forEach(model => {
                        const label = model.name
                        items.push({
                            label: label,
                            kind: MonacoPrompt.CompletionItemKind.File,
                            insertText: label,
                        })
                    })
                    break
                case "embeddings":
                    Object.keys((models as {
                        loaded: {[key: string]: {sd_checkpoint: string, sd_checkpoint_name: string}},
                        skipped: {[key: string]: {sd_checkpoint: string, sd_checkpoint_name: string}},
                    }).loaded).forEach(key => {
                        const label = key
                        items.push({
                            label: label,
                            kind: MonacoPrompt.CompletionItemKind.File,
                            insertText: label,
                        })
                    })
                    break
                case "loras":
                    (models as {name: string, path: string, prompt: string }[]).forEach(model => {
                        const label = model.name
                        items.push({
                            label: label,
                            kind: MonacoPrompt.CompletionItemKind.File,
                            insertText: label,
                        })
                    })
                    break
                default:
                    throw new Error("Unknown model type: " + model)
            }
            return items
        })
    }

    // snippet
    /*
    MonacoPrompt.addCustomSuggest(
        "snippet",
        MonacoPrompt.KeyMod.chord(
            MonacoPrompt.KeyMod.CtrlCmd | MonacoPrompt.KeyCode.KeyM,
            MonacoPrompt.KeyMod.CtrlCmd | MonacoPrompt.KeyCode.KeyS,
        ),
        async () => {
            const items: Partial<MonacoPrompt.CompletionItem>[] = []
            const snippets = await api.fetchApi("/webui-monaco-prompt/snippet").then((res: Response) => res.json())

            for (const snippet of snippets) {
                items.push({
                    label: snippet.label,
                    kind: MonacoPrompt.CompletionItemKind.Snippet,
                    insertText: snippet.insertText,
                    insertTextRules: MonacoPrompt.CompletionItemInsertTextRule.InsertAsSnippet,
                    detail: snippet.path,
                    documentation: {
                        supportHtml: true,
                        value: 'doc: <span style="color: red">&lt;lora:${1}:${2:1.0}&gt;</span>',
                    },
                })
            }

            return items
        }
    )
    */

    const onLoad = async () => {
        if (isLoaded) {
            return
        }
        isLoaded = true
            
        const document = gradioApp()
        
        const loadInitialExtranetworks= async () => {
            const embeddings = await fetch(GetEmbeddings).then(res => res.json()).catch(e => new Error(`fetch error: ${e}`))
            if (embeddings && embeddings.loaded) {
                console.log(me, "load", "embedding", Object.keys(embeddings.loaded))
                MonacoPrompt.addData("embedding", Object.keys(embeddings.loaded), true)
            }

            for (const [type, elemId] of [
                ["lora",     "setting_sd_lora"],
                ["hypernet", "setting_sd_hypernetwork"],
                ["lyco",     "setting_sd_lyco"],
            ]) {
                const component = gradio_config.components.filter((c: any) => {
                    return (c.props.elem_id === elemId && c.props.choices)
                })[0]
                if (!component) {
                    continue
                }
                const choices = component.props.choices.slice()
                if (choices[0] === "None") {
                    choices.shift()
                }
                console.log(me, "load", type, choices)
                MonacoPrompt.addData(type, choices, true)
            }
        }
        await loadInitialExtranetworks()

        let promptLoaded = false
        onUiUpdate(async () => {
            if (promptLoaded) {
                return
            }

            const promptIds = [
                "txt2img_prompt", "txt2img_neg_prompt",
                "img2img_prompt", "img2img_neg_prompt",
            ]

            // not ready
            for (const id of promptIds) {
                if (document.getElementById(id) === null) {
                    return
                }
            }

            const styleEditorIds = [
                // webui 1.6.0+ style editor
                "txt2img_edit_style_prompt", "txt2img_edit_style_neg_prompt",
                "img2img_edit_style_prompt", "img2img_edit_style_neg_prompt",
            ]

            const extraIds = [
                // Wildcards Manager
                "file_edit_box_id",
                "sddp-wildcard-file-editor",
            ]

            promptLoaded = true

            let prevSettings: MonacoPrompt.PromptEditorSettings|null = null
            const settings = await fetch(EndPoint, {method: 'GET'})
                .then(res => res.json())
                .catch(err => console.error("fetch error:", EndPoint, err))

            for (const id of promptIds.concat(styleEditorIds, extraIds)) {
                const container = document.getElementById(id)
                if (!container) {
                    continue
                }
                const textarea = container.querySelector('textarea')!
                const editor = new MonacoPrompt.PromptEditor(textarea, {
                    autoLayout: true,
                    handleTextAreaValue: true,
                    overlayZIndex: 99999,
                })

                // custom suggest
                for(const {keybinding, model} of models) {
                    editor.addCustomSuggest(model)
                }
                editor.addCustomSuggest("snippet")

                editor.addEventListener('keydown', (ev) => {
                    switch (ev.key) {
                        case 'Esc':
                        case 'Escape':
                            ev.stopPropagation()
                            break
                        default:
                            break
                    }
                })
                if (textarea.parentElement) {
                    textarea.parentElement.append(editor)
                } else {
                    container.append(editor)
                }
                Object.assign(editor.style, {
                    resize: "vertical",
                    overflow: "overlay",
                    display: "block",
                    height: "100%",
                    minHeight: "20rem",
                    width: "100%",
                })

                if (styleEditorIds.includes(id)) {
                    const observer = new IntersectionObserver(
                        (entry) => {
                            editor.handleResize()
                        },
                    )
                    observer.observe(editor)
                }

                editor.setSettings(settings)

                const saveSettings = async () => {
                    const currentSettings = editor.getSettings()
                    if (deepEqual(prevSettings, currentSettings)) {
                        return
                    }
                    prevSettings = currentSettings

                    const res = await fetch(EndPoint, {method: 'POST', body: JSON.stringify(currentSettings)})
                        .then(res => res.json())
                        .catch(err => console.error("fetch error:", EndPoint, err))
                    if (!res.success) {
                        console.error("fetch failed:", res)
                    }
                }

                editor.onChange(saveSettings)
            }
        })

        const csvs = await fetch(CSV).then(res => res.json()).catch(e => new Error(`fetch error: ${e}`))
        const pathname = srcURL.pathname
        // -2 = *.js -> javascript = extension base directory
        const basename = pathname.split('/').slice(0, -2)
        for (const filename of csvs) {
            const path = basename.concat(["csv", filename]).join('/') + ".csv"

            MonacoPrompt.clearCSV()
            fetch(path).then(res => res.text()).then((value) => {
                console.log("add:", filename, path)
                MonacoPrompt.addCSV(filename, value)
                return
            })
        }

        const extraNetworkCallback: (()=>void)[] = []

        function onExtraNetworkUpdate(callback: () => void) {
            extraNetworkCallback.push(callback)
        }

        // TODO: 現在はリフレッシュの開始と終了時を検知してしまっている
        function detectRefreshExtraNetwork(mutationRecords: MutationRecord[]) {
            for (const mutationRecord of mutationRecords) {
                const target = mutationRecord.target as HTMLElement
                if (!target || !target.closest) {
                    continue
                }
                if (target.closest("#txt2img_extra_tabs")) {
                    extraNetworkCallback.forEach(callback => callback())
                    break
                }
            }
        }

        const cards = [
            {
                id: "txt2img_textual_inversion_cards",
                type: "embedding",
            },
            {
                id: "txt2img_hypernetworks_cards",
                type: "hypernet"
            },
            {
                id: "txt2img_lora_cards",
                type: "lora"
            },
            {
                id: "txt2img_lycoris_cards",
                type: "lyco"
            }
        ]

        onExtraNetworkUpdate(() => {
            for (const card of cards) {
                const base = document.getElementById(card.id)
                const result: string[] = []
                if (base) {
                    base.querySelectorAll(".card .name").forEach((item) => {
                        const name = item.textContent
                        if (!name) {
                            return
                        }
                        result.push(name)
                    })
                }
                if (result.length == 0) {
                    continue
                }
                console.log(me, "refresh", card.type, result)
                MonacoPrompt.addData(card.type, result, true)
            }
        })

        onUiUpdate(detectRefreshExtraNetwork)
    }

    onUiUpdate(onLoad)
})(new URL((document.currentScript! as HTMLScriptElement).src))
