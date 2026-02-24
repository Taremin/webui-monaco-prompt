import * as WebuiMonacoPrompt from "../index"
import { PromptEditor, NodeFindMatch } from "./types"
// @ts-ignore
import * as codicon from "monaco-editor/esm/vs/base/common/codiconsUtil"


// Codicon を style 要素でロード
const loadCodicon = (baseurl: string) => {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.type = "text/css"
    link.href = [baseurl, "codicon.css"].join("/")
    document.head.appendChild(link)

    const codiconChars = codicon.getCodiconFontCharacters()
    const codiconStyle = document.createElement("style")
    const codiconLines = []
    for (const key of Object.keys(codiconChars)) {
        const value = codiconChars[key]
        codiconLines.push(`.codicon-${key}:before { content: '\\${value.toString(16)}'; } `)
    }
    codiconStyle.textContent = codiconLines.join("\n")

    document.body.appendChild(codiconStyle)
}

// 静的な CSS ファイルをロード
const loadStyle = (baseurl: string, filename: string) => {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.type = "text/css"
    link.href = [baseurl, filename].join("/")
    document.head.appendChild(link)
}

// Monaco のテーマに合わせて検索マッチ部分の style 要素を生成・更新
const themeStyleClassName = "webui-monaco-prompt-findmatch"
const getThemeClassName = () => themeStyleClassName
const updateThemeStyle = (instance: PromptEditor) => {
    let themeStyle

    if (!instance.shadowRoot) {
        throw new Error("shadowRoot not found")
    }
    if (!instance.instanceStyle) {
        themeStyle = document.createElement("style")
        instance.shadowRoot.appendChild(themeStyle)
        instance.instanceStyle = themeStyle
    } else {
        themeStyle = instance.instanceStyle
    }

    const editor = instance.monaco
    const theme = editor._themeService.getColorTheme()
    const style: any = {}
    for (const [cssProperty, monacoThemeColorId] of [
        ["background-color", "editor.findMatchBackground"],
        ["border-color", "editor.findMatchBorder"],
    ]) {
        const color = theme.getColor(monacoThemeColorId, true)
        if (!color) {
            continue
        }
        style[cssProperty] = color.toString()
    }
    const lines = Object.keys(style).map((key: string) => {
        return `${key}: ${(style as any)[key]};`
    }).join(" ")

    themeStyle.innerHTML = `.${getThemeClassName()} { ${lines} }`
}

// すべての WebUI Monaco Prompt インスタンスで検索
function find(searchString: string, isRegex: boolean, matchCase: boolean, matchWordOnly: boolean) {
    const allMmatches: NodeFindMatch[] = []
    WebuiMonacoPrompt.runAllInstances<PromptEditor>((instance) => {
        Array.prototype.push.apply(allMmatches, findInstance(instance, searchString, isRegex, matchCase, matchWordOnly))
    })
    return allMmatches
}

function findInstance(instance: PromptEditor, searchString: string, isRegex: boolean, matchCase: boolean, matchWordOnly: boolean, decoration: boolean = true) {
    const allMatches: NodeFindMatch[] = []
    const editor = instance.monaco
    const editorConfig = editor.getConfiguration()
    const wordSeparators = editorConfig.wordSeparators as unknown as string

    // メインモデルの検索
    const mainModel = editor.getModel()
    if (mainModel) {
        const matches = mainModel.findMatches(
            searchString,
            false,
            isRegex,
            matchCase,
            matchWordOnly ? wordSeparators : null,
            true,
        )
        Array.prototype.push.apply(allMatches, matches.map(match => ({
            match,
            instanceId: instance.getInstanceId(),
        })))

        // デコレーション（メインモデルのみ）
        if (decoration) {
            if (instance.findDecorations) {
                instance.findDecorations.clear()
            }
            instance.findDecorations = editor.createDecorationsCollection(
                matches.map((findMatch) => {
                    return {
                        range: findMatch.range,
                        options: {
                            inlineClassName: getThemeClassName()
                        },
                    }
                })
            )
        }
    }

    // 追加モデル (ExtraModels) の検索
    if (instance.extraModels) {
        for (const extra of instance.extraModels) {
            // メインモデルと同じモデルはスキップ（既に検索済み）
            if (extra.model === mainModel) continue

            const matches = extra.model.findMatches(
                searchString,
                false,
                isRegex,
                matchCase,
                matchWordOnly ? wordSeparators : null,
                true,
            )
            Array.prototype.push.apply(allMatches, matches.map(match => ({
                match,
                instanceId: instance.getInstanceId(),
                filename: extra.filename,
                extraModel: extra,
            })))
        }
    }

    return allMatches
}

function replace(searchString: string, replaceString: string, isRegex: boolean, matchCase: boolean, matchWordOnly: boolean) {
    WebuiMonacoPrompt.runAllInstances<PromptEditor>((instance) => {
        replaceInInstance(instance, searchString, replaceString, isRegex, matchCase, matchWordOnly)
    })
}

function replaceInInstance(instance: PromptEditor, searchString: string, replaceString: string, isRegex: boolean, matchCase: boolean, matchWordOnly: boolean) {
    const nodeFindMatches = findInstance(instance, searchString, isRegex, matchCase, matchWordOnly, false)

    const editOperations = nodeFindMatches.map((nodeFindMatch) => {
        if (isRegex) {
            const matches = nodeFindMatch.match.matches
            if (!matches || matches.length === 0) {
                throw new Error(`wrong match: ${matches}`)
            }
            const replaced = matches[0].replace(new RegExp(searchString), replaceString)
            return {
                range: nodeFindMatch.match.range,
                text: replaced
            }
        } else {
            return {
                range: nodeFindMatch.match.range,
                text: replaceString
            }
        }
    })

    instance.monaco.executeEdits("replaceInstance", editOperations)
}

// litegraph の指定ノードをアクティブ(最前面に移動, ノードを選択)
const setActiveNode = (app: any, node: any) => {
    app.canvas.bringToFront(node)
    app.canvas.selectNode(node, false)
}

// エディタ（PromptEditor）に共通のセットアップを施す（イベントハイドと補完など）
const applyCommonEditorSetup = (app: any, editor: PromptEditor, node: any) => {
    const defaultModels = ["checkpoints", "loras", "embeddings", "hypernetworks", "vae"]
    for(const model of defaultModels) {
        editor.addCustomSuggest(model)
    }
    editor.addCustomSuggest("snippet")

    // ComfyUI（LiteGraph）のキーボードショートカット（Hキーなど）と衝突しないようイベント伝播を止める
    editor.addEventListener('keydown', (ev: KeyboardEvent) => {
        switch (ev.key) {
            default:
                ev.stopPropagation()
                break
        }
    })

    // クリック（フォーカス）時に該当のノードをアクティブにする
    const mouseHandler = () => {
        setActiveNode(app, node)
    }
    editor.addEventListener("contextmenu", mouseHandler, {capture: true})
    editor.addEventListener("click", mouseHandler, {capture: true})
}

const guid = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export {
    loadCodicon,
    loadStyle,
    getThemeClassName,
    updateThemeStyle,
    find,
    replace,
    setActiveNode,
    applyCommonEditorSetup,
    guid,
}
