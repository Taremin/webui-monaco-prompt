import {languages} from 'monaco-editor/esm/vs/editor/editor.api'

// 言語機能の定義
export interface LanguageFeature {
    id: string                                              // 一意識別子
    label: string                                           // UI表示名
    priority: number                                        // ルール挿入優先度（大きいほど先にマッチ）
    // LanguageConfiguration への追加分
    confPatch: Partial<languages.LanguageConfiguration>
    // IMonarchLanguage への追加分
    tokenizer: {
        // 各トークナイザー状態に追加するルール
        [state: string]: languages.IMonarchLanguageRule[]
    }
    // ブラケット定義の追加分
    brackets?: languages.IMonarchLanguageBracket[]
}

// 機能トグルの ON/OFF 状態
export interface LanguageFeatureToggle {
    [featureId: string]: boolean
}

// 機能: # コメント
export const commentHash: LanguageFeature = {
    id: 'comment-hash',
    label: '# Comment',
    priority: 30,
    confPatch: {
        comments: { lineComment: '#' },
    },
    tokenizer: {
        whitespace: [
            [/(^#.*$)/, 'comment'],
        ],
    },
}

// 機能: // コメント
export const commentLine: LanguageFeature = {
    id: 'comment-line',
    label: '// Comment',
    priority: 30,
    confPatch: {
        comments: { lineComment: '//' },
    },
    tokenizer: {
        whitespace: [
            [/(^\/\/.*$)/, 'comment'],
        ],
    },
}

// 機能: /* */ コメント
export const commentBlock: LanguageFeature = {
    id: 'comment-block',
    label: '/* */ Comment',
    priority: 30,
    confPatch: {
        comments: { blockComment: ['/*', '*/'] },
    },
    tokenizer: {
        root: [
            [/\/\*/, 'comment', '@commentBlock'],
        ],
        commentBlock: [
            [/\*\//, 'comment', '@pop'],
            [/./, 'comment'],
        ],
    },
}

// 機能: Dynamic Prompts ({}, |)
export const dynamicPrompts: LanguageFeature = {
    id: 'dynamic-prompts',
    label: 'Dynamic Prompts',
    priority: 50,
    confPatch: {
        brackets: [[ '{', '}' ]],
        autoClosingPairs: [{ open: '{', close: '}' }],
        surroundingPairs: [{ open: '{', close: '}' }],
    },
    tokenizer: {
        root: [
            [/[,:|]/, 'delimiter'],
            [/[{}]/, '@brackets'],
        ],
    },
    brackets: [
        { open: '{', close: '}', token: 'delimiter.curly' },
    ],
}

// 機能: Jinja2
export const jinja2: LanguageFeature = {
    id: 'jinja2',
    label: 'Jinja2',
    priority: 100, // { が DynamicPrompts よりも先にマッチするように優先度を上げる
    tokenizer: {
        root: [
            [/\{#/, 'comment.jinja2', '@jinja2Comment'],
            [/\{\{-?/, 'metatag.jinja2', '@jinja2Expr'],
            [/\{%-?/, 'metatag.jinja2', '@jinja2Block'],
        ],
        jinja2Comment: [
            [/#\}/, 'comment.jinja2', '@pop'],
            [/./, 'comment.jinja2'],
        ],
        jinja2Expr: [
            [/-?\}\}/, 'metatag.jinja2', '@pop'],
            [/\|/, 'delimiter.jinja2'],
            [/\./, 'delimiter.jinja2'],
            [/[()[\]]/, 'delimiter.jinja2'],
            [/"/, 'string.jinja2.quote', '@jinja2StringDouble'],
            [/'/, 'string.jinja2.quote', '@jinja2StringSingle'],
            [/\d+(\.\d+)?/, 'number.jinja2'],
            [/\b(true|false|none|True|False|None)\b/, 'constant.jinja2'],
            [/[a-zA-Z_]\w*/, 'variable.jinja2'],
            [/\s+/, 'white'],
        ],
        jinja2Block: [
            [/-?%\}/, 'metatag.jinja2', '@pop'],
            [/\b(if|else|elif|endif|for|endfor|block|endblock|extends|include|macro|endmacro|call|endcall|filter|endfilter|set|raw|endraw|with|endwith|autoescape|endautoescape|import|from|as|in|not|and|or|is|recursive|scoped)\b/, 'keyword.jinja2'],
            [/"/, 'string.jinja2.quote', '@jinja2StringDouble'],
            [/'/, 'string.jinja2.quote', '@jinja2StringSingle'],
            [/\d+(\.\d+)?/, 'number.jinja2'],
            [/\b(true|false|none|True|False|None)\b/, 'constant.jinja2'],
            [/[a-zA-Z_]\w*/, 'variable.jinja2'],
            [/[=!<>]=?|\+|-|\*|\/|%/, 'operator.jinja2'],
            [/\|/, 'delimiter.jinja2'],
            [/\./, 'delimiter.jinja2'],
            [/[()[\],]/, 'delimiter.jinja2'],
            [/\s+/, 'white'],
        ],
        jinja2StringDouble: [
            [/"/, 'string.jinja2.quote', '@pop'],
            { include: '@promptRoot' },
            [/./, 'string.jinja2'], 
        ],
        jinja2StringSingle: [
            [/'/, 'string.jinja2.quote', '@pop'],
            { include: '@promptRoot' },
            [/./, 'string.jinja2'],
        ],
    },
    confPatch: {
        comments: { blockComment: ['{#', '#}'] },
    },
}

export const allFeatures: LanguageFeature[] = [
    commentHash,
    commentLine,
    commentBlock,
    dynamicPrompts,
    jinja2,
]

export function getFeature(id: string): LanguageFeature | undefined {
    return allFeatures.find(f => f.id === id)
}
