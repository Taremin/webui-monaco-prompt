import { deepEqual } from 'fast-equals'
const api  = (await eval('import("../../scripts/api.js")')).api // call native import

declare let __webpack_public_path__: any;

// set dynamic path
const srcURL = new URL(document.currentScript ? (document.currentScript as HTMLScriptElement).src : import.meta.url)
const dir = srcURL.pathname.split('/').slice(0, -1).join('/');
(window as any).WebuiMonacoPromptBaseURL = dir + "/";
__webpack_public_path__ = dir + "/"

// import は __webpack_public_path__ を使う場合は処理順の関係で使えない
const MonacoPrompt = require("./index");
(window as any).WebuiMonacoPrompt = MonacoPrompt

const me = "webui-monaco-prompt";

(() => {
    // textarea は body に作られるのでそのノード変更を監視
    const link: any= {}
    let id = 0
    const observer = new MutationObserver(
        (mutations, observer) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof HTMLTextAreaElement)) {
                        continue
                    }

                    onCreateTextarea(node)
                }
                for (const node of mutation.removedNodes) {
                    if (!(node instanceof HTMLTextAreaElement)) {
                        continue
                    }
                    
                    onRemoveTextarea(node)
                }
            }
        }
    )
    observer.observe(document.body, {
        childList: true
    })

    let prevSettings: any = null
    let settings: any = {}
    api.getSetting(me).then((userSetting: any) => {
        if (!userSetting || !userSetting.editor) {
            return
        }
        settings = userSetting
        MonacoPrompt.runAllInstances((editor: any) => {
            if (settings && settings.editor) {
                editor.setSettings(settings.editor, true)
            }
        })
    })

    function onCreateTextarea(textarea: HTMLTextAreaElement) {
        // style 同期
        const observer = new MutationObserver((mutations, observer) => {
            for (const mutation of mutations) {
                if (mutation.target !== textarea) {
                    continue
                }
                editor.style.cssText = (mutation.target as HTMLTextAreaElement).style.cssText
            }
        })
        observer.observe(textarea, {
            attributes: true,
            attributeFilter: ["style"]
        })


        const editor = new MonacoPrompt.PromptEditor(textarea, {
            autoLayout: true,
            handleTextAreaValue: true,
            overlayZIndex: 99999,
        })
        Object.assign(editor.elements.header!.style, {
            backgroundColor: "#444",
            fontSize: "small",
        })
        Object.assign(editor.elements.footer!.style, {
            backgroundColor: "#444",
            fontSize: "small",
        })
        
        textarea.dataset.webuiMonacoPromptTextareaId = "" + id
        editor.dataset.webuiMonacoPromptTextareaId = "" + id
        link[id++] = {
            textarea: textarea,
            monaco: editor,
            observer: observer,
        }

        editor.addEventListener('keydown', (ev: KeyboardEvent) => {
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
        }
        
        editor.style.cssText = getComputedStyle(textarea).cssText

        if (settings && settings.editor) {
            editor.setSettings(settings.editor, true)
        }

        const saveSettings = async () => {
            const currentSettings = editor.getSettings()
            if (deepEqual(prevSettings, currentSettings)) {
                return
            }
            prevSettings = currentSettings

            if (settings && settings.editor) {
                settings.editor = currentSettings
            }

            api.storeSetting(me, Object.assign(settings, {
                editor: currentSettings
            })).then((res: Response) => {
            })
        }

        editor.onChange(saveSettings)
    }

    function onRemoveTextarea(textarea: HTMLTextAreaElement) {
        const id = textarea.dataset.webuiMonacoPromptTextareaId
        if (typeof(id) !== 'string') {
            return
        }

        const ctx = link[id]
        ctx.observer.disconnect()
        const editor = ctx.monaco
        editor.dispose()
        editor.parentElement.removeChild(ctx.monaco)
        delete link[id]
    }

    for (const filename of ["danbooru.csv", "extra-quality-tags.csv"]) {
        const path = [dir, filename].join('/')

        MonacoPrompt.clearCSV()
        fetch(path).then(res => res.text()).then((value) => {
            MonacoPrompt.addCSV(value)
        })
    }

})()