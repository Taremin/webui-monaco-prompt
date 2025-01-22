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
    enabledCSV: string[]
}

const tags: Partial<CompletionItem>[] = []
const data: CompletionData = {}
const state: State = {
    threshold: 100,
    filteredTags: [],
    isRplaceUnderscore: false,
    loadedCSV: {},
    enabledCSV: [],
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

    if (!state.enabledCSV.includes(filename)) {
        state.enabledCSV.push(filename)
    }

    _addCSV(csv, filename)
}

const addLoadedCSV = (files: string[]) => {
    const  diff = compareArray(state.enabledCSV, files)

    if (diff.equal) {
        return
    }

    state.enabledCSV = files
    if (diff.remove.length > 0) {
        clearCSV()
    } else if (diff.add.length > 0) {
        files = diff.add
    }

    for (const filename of files) {
        const csv = state.loadedCSV[filename]
        if (!csv) {
            console.error(`"${filename}" is not loaded`)
            continue
        }
        _addCSV(csv, filename)
    }
}

const compareArray = (array1: any[], array2: any[]) => {
    const result = {
        equal: true,
        add: [] as any[],
        remove: [] as any[],
    }
    const array2map = new Map(array2.map(v => [v, true]))

    for (const array1value of array1) {
        if (!array2map.has(array1value)) {
            result.equal = false
            result.remove.push(array1value)
        } else {
            array2map.delete(array1value)
        }
    }
    if (array2map.size > 0) {
        result.equal = false
    }
    for (const key of array2map.keys()) {
        result.add.push(key)
    }

    return result
}

const _addCSV = (csv: string, sourceName?: string) => {
    for (const row of parse(csv, {columns: ["tag", "category", "count", "alias"]})) {
        const countString = isNaN(row.count) ? row.count : (+row.count).toLocaleString()
        const description = sourceName ?
            [`(${sourceName})`, countString].join(" ") :
            countString
        const item: Partial<CompletionItem> = {
            label: {
                label: row.tag,
                description: description,
            },
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
                label: {
                    label: alias,
                    detail: ` -> ${row.tag}`,
                    description: description,
                },
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

const getEnabledCSV = () => {
    return state.enabledCSV.slice()
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

type CreateDynamicSuggestFunc = () => Promise<Partial<languages.CompletionItem>[]>
type CreateDynamicSuggest = (suggestFunc: CreateDynamicSuggestFunc, suggestCallback: () => void) => languages.CompletionItemProvider
const createDynamicSuggest: CreateDynamicSuggest = (suggestFunc, suggestOnDispose) => {
    return {
        provideCompletionItems: async function(model: editor.ITextModel, position: Position, context: languages.CompletionContext) {
            const suggestWordList = await suggestFunc()

            suggestWordList.forEach(partialCompletionItem => {
                if (!partialCompletionItem.kind) {
                    partialCompletionItem.kind = languages.CompletionItemKind.Text
                }
                partialCompletionItem.range = {
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column,
                }
            })

            return {
                suggestions: suggestWordList as languages.CompletionItem[],
                dispose: () => {
                    suggestOnDispose()
                }
            }
        }
    }
}

export {
    provider,
    createDynamicSuggest,
    clearCSV,
    addCSV,
    loadCSV,
    getCount,
    getEnabledCSV,
    getLoadedCSV,
    addLoadedCSV,
    addData,
    updateFilteredTags,
    updateReplaceUnderscore,
    getReplaceUnderscore,
}