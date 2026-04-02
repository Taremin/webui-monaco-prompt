import {LanguageFeatureToggle} from './features'

export interface LanguagePreset {
    id: string
    label: string
    features: LanguageFeatureToggle
    isBuiltin: boolean
}

export const builtinPresets: LanguagePreset[] = [
    {
        id: 'sd-prompt',
        label: 'SD Prompt',
        isBuiltin: true,
        features: {
            'comment-hash': false,
            'comment-line': false,
            'comment-block': false,
            'dynamic-prompts': false,
            'jinja2': false,
        }
    },
    {
        id: 'sd-dynamic-prompt',
        label: 'SD Dynamic Prompt',
        isBuiltin: true,
        features: {
            'comment-hash': true,
            'comment-line': false,
            'comment-block': false,
            'dynamic-prompts': true,
            'jinja2': false,
        }
    },
    {
        id: 'comfy-prompt',
        label: 'Comfy Prompt',
        isBuiltin: true,
        features: {
            'comment-hash': false,
            'comment-line': true,
            'comment-block': true,
            'dynamic-prompts': false,
            'jinja2': false,
        }
    },
    {
        id: 'comfy-dynamic-prompt',
        label: 'Comfy Dynamic Prompt',
        isBuiltin: true,
        features: {
            'comment-hash': true,
            'comment-line': true,
            'comment-block': true,
            'dynamic-prompts': true,
            'jinja2': false,
        }
    },
    {
        id: 'full-features',
        label: 'Full (All Features)',
        isBuiltin: true,
        features: {
            'comment-hash': true,
            'comment-line': true,
            'comment-block': true,
            'dynamic-prompts': true,
            'jinja2': true,
        }
    }
]

// ユーザのカスタムプリセット用ストア
let userPresets: LanguagePreset[] = []

export function getAllPresets(): LanguagePreset[] {
    return [...builtinPresets, ...userPresets]
}

export function getPreset(id: string): LanguagePreset | undefined {
    return getAllPresets().find(p => p.id === id)
}

export function addUserPreset(preset: LanguagePreset) {
    // 同じIDがあれば上書き、なければ追加
    const index = userPresets.findIndex(p => p.id === preset.id)
    if (index >= 0) {
        userPresets[index] = preset
    } else {
        userPresets.push(preset)
    }
}

export function removeUserPreset(id: string) {
    userPresets = userPresets.filter(p => p.id !== id)
}

export function loadUserPresets(presets: LanguagePreset[]) {
    if (!Array.isArray(presets)) {
        userPresets = []
        return
    }
    userPresets = presets.filter(p => !p.isBuiltin)
}

export function getUserPresets(): LanguagePreset[] {
    return [...userPresets]
}
