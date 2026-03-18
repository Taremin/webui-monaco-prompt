import {languages} from 'monaco-editor/esm/vs/editor/editor.api'
import {LanguageFeature} from './features'

// deepClone 用の簡略化ユーティリティ
// IMonarchLanguage 等のコピー用
function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj
    }

    if (obj instanceof RegExp) {
        return new RegExp(obj.source, obj.flags) as any
    }

    if (Array.isArray(obj)) {
        const copy: any[] = []
        for (let i = 0, l = obj.length; i < l; i++) {
            copy[i] = deepClone(obj[i])
        }
        return copy as any
    }

    const copy: any = {}
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            copy[key] = deepClone((obj as any)[key])
        }
    }
    return copy
}

export function composeLanguage(
    baseConf: languages.LanguageConfiguration,
    baseLang: languages.IMonarchLanguage,
    features: LanguageFeature[]
): {
    conf: languages.LanguageConfiguration,
    language: languages.IMonarchLanguage,
} {
    // 0. priority 昇順でソート（値が大きい機能ほど後でマージされ、結果的に優先される）
    const sorted = [...features].sort((a, b) => a.priority - b.priority)

    // 1. conf のマージ
    const mergedConf = deepClone(baseConf)
    
    // autoClosingPairs 等を配列として初期化されているか確認・設定
    mergedConf.brackets = mergedConf.brackets || []
    mergedConf.autoClosingPairs = mergedConf.autoClosingPairs || []
    mergedConf.surroundingPairs = mergedConf.surroundingPairs || []

    for (const f of sorted) {
        if (f.confPatch.comments) {
            mergedConf.comments = { ...mergedConf.comments, ...f.confPatch.comments }
        }
        if (f.confPatch.brackets) {
            mergedConf.brackets = [...mergedConf.brackets, ...f.confPatch.brackets]
        }
        if (f.confPatch.autoClosingPairs) {
            mergedConf.autoClosingPairs = [...mergedConf.autoClosingPairs, ...f.confPatch.autoClosingPairs]
        }
        if (f.confPatch.surroundingPairs) {
            mergedConf.surroundingPairs = [...mergedConf.surroundingPairs, ...f.confPatch.surroundingPairs]
        }
    }

    // 2. tokenizer のマージ
    const mergedTokenizer = deepClone(baseLang.tokenizer || {})
    
    // まずベースとなる promptRoot を作成（Jinja2等が参照するため）
    if (mergedTokenizer.root) {
        mergedTokenizer.promptRoot = (mergedTokenizer.root as any[]).filter(rule => {
            if (Array.isArray(rule) && typeof rule[2] === 'string' && rule[2].startsWith('@jinja')) {
                return false
            }
            return true
        })
    }

    for (const f of sorted) {
        for (const [state, rules] of Object.entries(f.tokenizer)) {
            if (!mergedTokenizer[state]) {
                // 新しい状態（jinja2Comment 等）はそのまま追加
                mergedTokenizer[state] = [...rules]
            } else if (state === 'root') {
                // root は先頭に挿入
                mergedTokenizer[state] = [...rules, ...mergedTokenizer[state]]
            } else {
                // 既存状態（whitespace 等）は先頭に挿入（ベースより機能を優先）
                mergedTokenizer[state] = [...rules, ...mergedTokenizer[state]]
            }
        }
    }

    // 2.5 promptRoot を最新の root から再生成（各機能が追加したルールも含むプロンプト本体）
    if (mergedTokenizer.root) {
        mergedTokenizer.promptRoot = (mergedTokenizer.root as any[]).filter(rule => {
            if (Array.isArray(rule) && typeof rule[2] === 'string' && rule[2].startsWith('@jinja')) {
                return false
            }
            return true
        })
    }

    // 3. brackets のマージ (IMonarchLanguage の方)
    let mergedBrackets = [...(baseLang.brackets || [])]
    for (const f of sorted) {
        if (f.brackets) {
            mergedBrackets = [...mergedBrackets, ...f.brackets]
        }
    }

    const mergedLanguage: languages.IMonarchLanguage = {
        ...deepClone(baseLang),
        tokenizer: mergedTokenizer,
        brackets: mergedBrackets,
    }

    return {
        conf: mergedConf,
        language: mergedLanguage,
    }
}
