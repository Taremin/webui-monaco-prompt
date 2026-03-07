import * as WebuiMonacoPrompt from "../index" // for typing
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

interface ExtraModel {
    id?: string
    filename: string
    model: monaco.editor.ITextModel
    onActivate: () => void
    decorationIds: string[]
    nodeDecorationIds: string[]
}

type PromptEditor = WebuiMonacoPrompt.PromptEditor & {
    instanceStyle?: HTMLStyleElement
    findDecorationIds?: string[]
    nodeDecorationIds?: string[]
    extraModels?: ExtraModel[]
}

interface WebuiMonacoPromptAdapter {
    textarea: HTMLTextAreaElement
    monaco: PromptEditor
    observer: MutationObserver
    node: any
}

interface NodeFindMatch {
    match: monaco.editor.FindMatch
    instanceId: number
    filename?: string
    extraModel?: ExtraModel
}

export {
    PromptEditor,
    WebuiMonacoPromptAdapter,
    NodeFindMatch,
    ExtraModel,
}
