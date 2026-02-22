import * as WebuiMonacoPrompt from "../index" // for typing
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

interface ExtraModel {
    filename: string
    model: monaco.editor.ITextModel
    onActivate: () => void
}

type PromptEditor = WebuiMonacoPrompt.PromptEditor & {
    instanceStyle?: HTMLStyleElement
    findDecorations?: monaco.editor.IEditorDecorationsCollection
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
