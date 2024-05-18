import * as WebuiMonacoPrompt from "../index" // for typing
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

type PromptEditor = WebuiMonacoPrompt.PromptEditor & {
    instanceStyle?: HTMLStyleElement
    findDecorations?: monaco.editor.IEditorDecorationsCollection
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
}

export {
    PromptEditor,
    WebuiMonacoPromptAdapter,
    NodeFindMatch,
}
