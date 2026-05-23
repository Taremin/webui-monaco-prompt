import { PromptEditor, NodeFindMatch, ExtraModel } from "./types"
import { ui } from "./api"
import { link } from "./link"
import { getThemeClassName, guid, getStyle } from "../utils"
// @ts-ignore
import * as codicon from "monaco-editor/esm/vs/base/common/codiconsUtil"

const TooltipSurroundingLines = 2
const TooltipDistance = 20

let tooltip: HTMLElement
let tooltipBody: HTMLDivElement
let tooltipStyle: HTMLStyleElement

function initSearchTooltip() {
    if (tooltip) return
    tooltip = createSearchTooltip()
    tooltipBody = tooltip.querySelector("div") as HTMLDivElement
    tooltipStyle = tooltip.querySelector("style") as HTMLStyleElement
}

const createSearchTooltip = () => {
    const tooltip = $el("div", {
        className: ["text-sm", "monaco-prompt-search-tooltip"].join(" "),
        style: {
            display: "none",
            position: "fixed",
            backgroundColor: "var(--bg-color)",
            color: "var(--fg-color)",
            overflowWrap: "anywhere",
            zIndex: 999999,
        }
    }) as HTMLElement

    const scopedStyle = document.createElement("style")
    const body = document.createElement("div")

    tooltip.appendChild(scopedStyle)
    tooltip.appendChild(body)

    document.body.appendChild(tooltip)

    return tooltip
}

const setSearchTooltip = (targetElement: HTMLElement) => {
    targetElement.addEventListener("mouseenter", (ev) => {
        initSearchTooltip()
        while (tooltipBody.firstChild) {
            tooltipBody.removeChild(tooltipBody.firstChild)
        }
        const instance = link[targetElement.dataset.instanceId!]

        // instance removed
        if (!instance) {
            return
        }

        const monaco = instance.monaco
        const line = +(targetElement.dataset.startLine!)
        const range = TooltipSurroundingLines
        const filename = targetElement.dataset.filename
        const modelId = targetElement.dataset.modelId

        if (monaco.instanceStyle) {
            tooltipStyle.textContent = `@scope {
                ${monaco.instanceStyle.textContent}
                .monaco-editor {
                    padding: 1rem;
                }
            }`
        }

        const extraModel = modelId ? monaco.extraModels?.find((e: any) => e.id === modelId) : monaco.extraModels?.find((e: any) => e.filename === filename)
        const targetModel = extraModel?.model
        const contentElement = monaco.getLinesTable(Math.max(1, line - range), line, line + range, targetModel)
        tooltipBody.appendChild(contentElement)

        tooltip.style.display = "block"
    })

    targetElement.addEventListener("mousemove", (ev) => {
        tooltip.style.left = (ev.clientX + TooltipDistance) + 'px'
        tooltip.style.top = (ev.clientY + TooltipDistance) + 'px'

        if (document.documentElement.clientHeight < ev.clientY + TooltipDistance + tooltip.getBoundingClientRect().height) {
            tooltip.style.top = (ev.clientY - TooltipDistance  - tooltipBody.getBoundingClientRect().height) + 'px'
        }
    })
    targetElement.addEventListener("mouseout", (ev) => {
        tooltip.style.display = "none"
    })
}

const clearSearchTooltip = () => {
    initSearchTooltip()
    if (tooltip) {
        tooltip.style.display = "none"
    }
}


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
function find(searchString: string, isRegex: boolean, matchCase: boolean, matchWordOnly: boolean, decorationKey: string = "findDecorationIds") {
    const allMmatches: NodeFindMatch[] = []
    const WebuiMonacoPrompt = (window as any).WebuiMonacoPrompt
    if (WebuiMonacoPrompt && WebuiMonacoPrompt.runAllInstances) {
        (WebuiMonacoPrompt.runAllInstances as (callback: (instance: PromptEditor) => void) => void)((instance: PromptEditor) => {
            Array.prototype.push.apply(allMmatches, findInstance(instance, searchString, isRegex, matchCase, matchWordOnly, true, decorationKey))
        })
    }
    return allMmatches
}

function findInstance(instance: PromptEditor, searchString: string, isRegex: boolean, matchCase: boolean, matchWordOnly: boolean, decoration: boolean = true, decorationKey: string = "findDecorationIds") {
    const allMatches: NodeFindMatch[] = []
    const editor = instance.monaco
    const editorConfig = editor.getConfiguration()
    const wordSeparators = editorConfig.wordSeparators as unknown as string

    // メインモデルの検索
    const mainModel = editor.getModel()
    if (mainModel) {
        let mainExtraModel: any = undefined
        if (instance.extraModels) {
            mainExtraModel = instance.extraModels.find(extra => extra.model === mainModel)
        }

        if (mainModel.isDisposed()) return allMatches;

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
            filename: mainExtraModel?.filename,
            extraModel: mainExtraModel,
        })))

        // デコレーション（メインモデルのみ）
        if (decoration) {
            const decKey = decorationKey as keyof PromptEditor;
            (instance as any)[decKey] = mainModel.deltaDecorations(
                (instance as any)[decKey] || [],
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

            if (extra.model.isDisposed()) continue;

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

            // 追加モデルのデコレーション設定
            if (decoration) {
                const decKey = decorationKey as keyof ExtraModel;
                (extra as any)[decKey] = extra.model.deltaDecorations(
                    (extra as any)[decKey] || [],
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
    }

    return allMatches
}

function replace(searchString: string, replaceString: string, isRegex: boolean, matchCase: boolean, matchWordOnly: boolean) {
    const WebuiMonacoPrompt = (window as any).WebuiMonacoPrompt
    if (WebuiMonacoPrompt && WebuiMonacoPrompt.runAllInstances) {
        (WebuiMonacoPrompt.runAllInstances as (callback: (instance: PromptEditor) => void) => void)((instance: PromptEditor) => {
            replaceInInstance(instance, searchString, replaceString, isRegex, matchCase, matchWordOnly)
        })
    }
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
    const stopPropagationHandler = (ev: KeyboardEvent) => {
        ev.stopPropagation()
    }
    editor.addEventListener('keydown', stopPropagationHandler)
    editor.addEventListener('keyup', stopPropagationHandler)

    // クリック（フォーカス）時に該当のノードをアクティブにする
    const mouseHandler = () => {
        setActiveNode(app, node)
    }
    editor.addEventListener("contextmenu", mouseHandler, {capture: true})
    editor.addEventListener("click", mouseHandler, {capture: true})
}

const $el = (...args: any[]) => ui.$el(...args)

export {
    loadCodicon,
    loadStyle,
    getThemeClassName,
    updateThemeStyle,
    setActiveNode,
    applyCommonEditorSetup,
    find,
    findInstance,
    replace,
    guid,
    $el,
    getStyle,
    initSearchTooltip,
    setSearchTooltip,
    clearSearchTooltip,
}
