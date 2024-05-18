import { editor, languages, Position } from 'monaco-editor/esm/vs/editor/editor.api'
import { parse } from 'csv-parse/browser/esm/sync'

interface CompletionData {
    [type: string]: string[]
}

interface CompletionItemExtention {
    count: string
}
type CompletionItem = languages.CompletionItem & CompletionItemExtention 

interface State {
    threshold: number
    filteredTags: Partial<CompletionItem>[]
    isRplaceUnderscore: boolean
    loadedCSV: {
        [key: string]: string
    }
}

const tags: Partial<CompletionItem>[] = []
const data: CompletionData = {}
const state: State = {
    threshold: 100,
    filteredTags: [],
    isRplaceUnderscore: false,
    loadedCSV: {},
}

const updateReplaceUnderscore = (replace: boolean) => {
    state.isRplaceUnderscore = replace
}

const getReplaceUnderscore = () => {
    return state.isRplaceUnderscore
}

const checkThreshold = (item: CompletionItem) => {
    if (isNaN(item.count as any)) {
        return true
    }
    return (item.count as unknown as number) > state.threshold
}

const filterTags = (items: CompletionItem[]) => {
    return items.filter(checkThreshold)
}

const addData = (type: string, list: string[], clear = false) => {
    if (!data[type] || clear) {
        data[type] = list.slice()
        return
    }

    Array.prototype.push.apply(data[type], list)
}

const clearCSV = () => {
    tags.length = 0
    state.filteredTags.length = 0
}

const loadCSV = (filename: string, csv: string) => {
    if (tags.length > 0) {
        clearCSV()
    }

    addCSV(filename, csv)
}

const addCSV = (filename: string, csv: string) => {
    state.loadedCSV[filename] = csv
    _addCSV(csv)
}

const addLoadedCSV = (files: string[]) => {
    clearCSV()

    for (const filename of files) {
        const csv = state.loadedCSV[filename]
        if (!csv) {
            console.error(`"${filename}" is not loaded`)
            continue
        }
        _addCSV(csv)
    }
}

const _addCSV = (csv: string) => {
    for (const row of parse(csv, {columns: ["tag", "category", "count", "alias"]})) {
        const countString = isNaN(row.count) ? row.count : (+row.count).toLocaleString()
        const item: Partial<CompletionItem> = {
            label: {label: row.tag, description: countString},
            kind: languages.CompletionItemKind.Value,
            insertText: escape(row.tag),
            count: row.count,
        }
        tags.push(item)

        // filtered
        if (checkThreshold(item as CompletionItem)) {
            state.filteredTags.push(item)
        }

        for (const alias of row.alias.split(",")) {
            if (alias.length === 0) {
                continue
            }
            const item: Partial<CompletionItem> = {
                label: {label: alias, detail: ` -> ${row.tag}`, description: countString},
                kind: languages.CompletionItemKind.Value,
                insertText: escape(row.tag),
                count: row.count,
            }
            tags.push(item)

            // filtered
            if (checkThreshold(item as CompletionItem)) {
                state.filteredTags.push(item)
            }
        }
    }
}

const updateFilteredTags = () => {
    state.filteredTags = filterTags(tags as CompletionItem[])
}

const getCount = () => {
    return tags.length
}

const getLoadedCSV = () => {
    return Object.keys(state.loadedCSV)
}

const escape = (str: string) => {
    return str
        .replaceAll(/([\(\)\[\]])/g, '\\$1')
}

const getWordPosition = (model:editor.ITextModel, position: Position): editor.IWordAtPosition => {
    const untilPosition = model.getWordUntilPosition(position)
    const wordPosition = model.getWordAtPosition(position)
    
    if (!wordPosition) {
        return untilPosition
    }

    return {
        startColumn: untilPosition.startColumn,
        endColumn: wordPosition.endColumn,
        word: wordPosition.word
    }
}

const provider: languages.CompletionItemProvider = {
    triggerCharacters: "<1234567890".split(''),
    provideCompletionItems: function (model: editor.ITextModel, position: Position, context: languages.CompletionContext) {
        let wordPosition = getWordPosition(model, position)
        const prevChar = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: wordPosition.startColumn - 1,
            endLineNumber: position.lineNumber,
            endColumn: wordPosition.startColumn,
        })
        const triggerCharacter = context.triggerCharacter || prevChar

        // tags
        let suggestTags: languages.CompletionItem[]
        switch (triggerCharacter) {
            case '<':
                suggestTags = []
                break
            default:
                suggestTags = state.filteredTags.map((item: Partial<languages.CompletionItem>) => {
                    return Object.assign(
                        {
                            range: {
                                startLineNumber: position.lineNumber,
                                startColumn: wordPosition.startColumn,
                                endLineNumber: position.lineNumber,
                                endColumn: wordPosition.endColumn
                            }
                        },
                        item,
                        state.isRplaceUnderscore ? {insertText: item.insertText!.replaceAll('_', ' ')} : {},
                    ) as languages.CompletionItem
                })
                break
        }

        // extra networks
        const extra: languages.CompletionItem[] = []
        for (const [type, list] of Object.entries(data)) {
            if (type === "embedding" && triggerCharacter === "<") {
                continue
            }
            for (const word of list) {
                const escapedWord = escape(word)
                const insertText = `${type}:${escapedWord}:1.0`
                extra.push({
                    label: {label: escapedWord, description: type},
                    kind: languages.CompletionItemKind.Text,
                    insertText:
                        type             === "embedding" ? escapedWord :
                        triggerCharacter === "<"         ? insertText :
                        `<${insertText}>`,
                    detail: type,
                    range: {
                        startLineNumber: position.lineNumber,
                        startColumn: wordPosition.startColumn,
                        endLineNumber: position.lineNumber,
                        endColumn: wordPosition.endColumn,
                    }
                })
            }
        }
        return {
            suggestions: suggestTags.concat(extra),
        }
    },
}

export {
    provider,
    clearCSV,
    addCSV,
    loadCSV,
    getCount,
    getLoadedCSV,
    addLoadedCSV,
    addData,
    updateFilteredTags,
    updateReplaceUnderscore,
    getReplaceUnderscore,
}