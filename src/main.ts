import * as MonacoPrompt from './index'
import { deepEqual } from 'fast-equals'
import { EndPoint } from '../extension.json'
declare const gradio_config: any;

((srcURL) => {
    let isLoaded = false

    const onLoad = async () => {
        if (isLoaded) {
            return
        }
        isLoaded = true
            
        const document = gradioApp()
        
        const loadInitialExtranetworks= () => {
            for (const [type, label] of [
                ["embedding", "Embedding"],
                ["lora",      "Lora"],
                ["hypernet",  "Hypernetwork"],
                ["lyco",      "Add LyCORIS to prompt"],
            ]) {
                const component = gradio_config.components.filter((c: any) => {
                    return (c.props.label === label && c.props.choices)
                })[0]
                if (!component) {
                    continue
                }
                const choices = component.props.choices.slice()
                if (type === "lyco") {
                    if (choices[0] === "None") {
                        choices.shift()
                    }
                }
                MonacoPrompt.addData(type, choices, true)
            }
        }
        loadInitialExtranetworks()

        let promptLoaded = false
        onUiUpdate(async () => {
            if (promptLoaded) {
                return
            }

            const promptIds = ["txt2img_prompt", "txt2img_neg_prompt", "img2img_prompt", "img2img_neg_prompt"]

            // not ready
            for (const id of promptIds) {
                if (document.getElementById(id) === null) {
                    return
                }
            }

            const extraIds = [
                "file_edit_box_id", // Wildcards Manager
                "sddp-wildcard-file-editor", // Wildcards Manager
            ]

            promptLoaded = true

            let prevSettings: MonacoPrompt.PromptEditorSettings|null = null
            const settings = await fetch(EndPoint, {method: 'GET'})
                .then(res => res.json())
                .catch(err => console.error("fetch error:", EndPoint, err))

            for (const id of promptIds.concat(extraIds)) {
                const container = document.getElementById(id)
                if (!container) {
                    continue
                }
                const textarea = container.querySelector('textarea')!
                const editor = new MonacoPrompt.PromptEditor(textarea, {
                    autoLayout: true,
                    handleTextAreaValue: true,
                })
                container.prepend(editor)
                Object.assign(editor.style, {
                    resize: "vertical",
                    overflow: "overlay",
                    display: "block",
                    height: "100%",
                    minHeight: "20rem",
                    width: "100%",
                })

                editor.setSettings(settings)

                const saveSettings = async () => {
                    const currentSettings = editor.getSettings()
                    if (deepEqual(prevSettings, currentSettings)) {
                        return
                    }
                    prevSettings = currentSettings
                    console.log(prevSettings, currentSettings)

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

        const pathname = srcURL.pathname
        // -2 = *.js -> javascript = extension base directory
        const basename = pathname.split('/').slice(0, -2)
        for (const filename of ["danbooru.csv", "extra-quality-tags.csv"]) {
            const path = basename.concat(["csv", filename]).join('/')

            MonacoPrompt.clearCSV()
            fetch(path).then(res => res.text()).then((value) => {
                MonacoPrompt.addCSV(value)
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
                id: "txt2img_textual inversion_cards",
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
                MonacoPrompt.addData(card.type, result, true)
            }
        })

        onUiUpdate(detectRefreshExtraNetwork)
    }

    onUiUpdate(onLoad)
})(new URL((document.currentScript! as HTMLScriptElement).src))
