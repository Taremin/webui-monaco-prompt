import * as MonacoPrompt from './index'

((srcURL) => {
    let isLoaded = false
    const storageKey = 'Extensions/webui-monaco-prompt'

    const onLoad = () => {
        if (isLoaded) {
            return
        }
        isLoaded = true
            
        const document = gradioApp()
        
        let promptLoaded = false
        onUiUpdate(() => {
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

            promptLoaded = true
            for (const id of promptIds) {
                const container = document.getElementById(id)!
                const textarea = container.querySelector('textarea')!
                const editor = new MonacoPrompt.PromptEditor(textarea, {
                    autoLayout: true,
                    handleTextAreaValue: true,
                })
                container?.prepend(editor)
                Object.assign(editor.style, {
                    resize: "vertical",
                    overflow: "overlay",
                    display: "block",
                    height: "100%",
                    minHeight: "20rem",
                    width: "100%",
                })

                const saveSettings = () => {
                    const settings = JSON.stringify(editor.getSettings())
                    if (localStorage.getItem(storageKey) !== settings) {
                        localStorage.setItem(storageKey, settings)
                    }
                }
                editor.onChangeShowLineNumbers(saveSettings)
                editor.onChangeShowMinimap(saveSettings)
                editor.onChangeMode(saveSettings)
                editor.onChangeTheme(saveSettings)
                editor.onChangeLanguage(saveSettings)

                const storageItem = localStorage.getItem(storageKey)
                if (storageItem) {
                    const settings = JSON.parse(storageItem) as MonacoPrompt.PromptEditorSettings
                    editor.setSettings(settings)
                }
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
                MonacoPrompt.addData(card.type, result, true)
            }
        })

        onUiUpdate(detectRefreshExtraNetwork)
    }

    onUiUpdate(onLoad)
})(new URL((document.currentScript! as HTMLScriptElement).src))
