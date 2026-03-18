import { deepEqual } from 'fast-equals'
import * as utils from "./utils"
import * as WebuiMonacoPrompt from "../index" // for typing
import { getPreset as getLocalPreset } from "../languages/presets"
import { allFeatures as localFeatures } from "../languages/features"
import { app } from "./api"

const SETTING_MAP: Record<string, string> = {
    minimap: "WebuiMonacoPrompt.Minimap",
    lineNumbers: "WebuiMonacoPrompt.LineNumbers",
    replaceUnderscore: "WebuiMonacoPrompt.ReplaceUnderscore",
    mode: "WebuiMonacoPrompt.KeyBindings",
    theme: "WebuiMonacoPrompt.Theme",
    languagePreset: "WebuiMonacoPrompt.LanguagePreset",
    showHeader: "WebuiMonacoPrompt.ShowHeader",
    fontSize: "WebuiMonacoPrompt.FontSize",
    fontFamily: "WebuiMonacoPrompt.FontFamily",
    csvToggle: "WebuiMonacoPrompt.CsvToggle",
    userPresets: "WebuiMonacoPrompt.LanguageUserPresets",
}

let prevSettings: any = null

function parseMaybeJson(raw: any) {
    if (raw === undefined || raw === null) return raw
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
            try {
                return JSON.parse(trimmed)
            } catch (e) {
                return raw
            }
        }
    }
    return raw
}

function readSettingValue(storage: any, key: string, preferApp = false) {
    if (preferApp) {
        const appValue = app?.ui?.settings?.getSettingValue?.(key)
        if (appValue !== undefined) {
            return decodeComfyString(appValue)
        }
    }

    let raw = storage ? storage[key] : undefined
    if (raw === undefined) {
        raw = localStorage.getItem(`Comfy.Settings.${key}`)
        if (raw === null) {
            raw = localStorage.getItem(key)
        }
    }
    raw = parseMaybeJson(raw)
    return decodeComfyString(raw)
}

function normalizeCsvToggleKey(rawKey: string) {
    if (rawKey.startsWith("csv.")) return rawKey
    const contextPrefix = "monacoPromptEditor.csv."
    if (rawKey.startsWith(contextPrefix)) {
        return `csv.${rawKey.slice(contextPrefix.length)}`
    }
    return `csv.${rawKey}`
}

function getEnabledCSVs(csvToggle: any) {
    if (!csvToggle) csvToggle = {}
    const loadedCSVs = WebuiMonacoPrompt.getLoadedCSV()
    let changed = false
    const enables = loadedCSVs.filter(csv => {
        const key = `csv.${csv}`
        if (key in csvToggle) {
            return csvToggle[key]
        }
        csvToggle[key] = true
        changed = true
        return true
    })
    
    if (changed) {
        // Update the ComfyUI setting if new CSVs were discovered
        app.ui.settings.setSettingValue("WebuiMonacoPrompt.CsvToggle", csvToggle)
    }
    return enables
}

function updateInstanceSettings(instance: WebuiMonacoPrompt.PromptEditor) {
    const settings = getSettings()
    if (Object.keys(settings).length > 0) {
        instance.setSettings(settings, true)
        
        if (settings.csvToggle) {
            WebuiMonacoPrompt.addLoadedCSV(getEnabledCSVs(settings.csvToggle))
        }
    }
    
    utils.updateThemeStyle(instance)
    prevSettings = instance.getSettings()
}

async function saveSettings(instance: WebuiMonacoPrompt.PromptEditor) {
    const currentSettings = instance.getSettings()
    const normalizedSettings = { ...currentSettings } as any
    if (normalizedSettings.csvToggle && typeof normalizedSettings.csvToggle === "object") {
        const normalized: Record<string, boolean> = {}
        for (const [rawKey, enabled] of Object.entries(normalizedSettings.csvToggle)) {
            normalized[normalizeCsvToggleKey(rawKey)] = !!enabled
        }
        normalizedSettings.csvToggle = normalized
    }
    
    // 変更がない場合はスキップ
    if (prevSettings && deepEqual(prevSettings, normalizedSettings) && deepEqual(prevSettings.userPresets, WebuiMonacoPrompt.getUserPresets())) {
        return
    }
    
    if (!prevSettings) {
        prevSettings = { ...normalizedSettings, userPresets: WebuiMonacoPrompt.getUserPresets() }
    }
    
    // 基本設定の同期
    for (const [key, comfyId] of Object.entries(SETTING_MAP)) {
        let nextValue = normalizedSettings[key]
        if (key === "csvToggle" && nextValue && typeof nextValue === "object") {
            // Store as csv.<name> to avoid context-key pollution
            const normalized: Record<string, boolean> = {}
            for (const [rawKey, enabled] of Object.entries(nextValue)) {
                normalized[normalizeCsvToggleKey(rawKey)] = !!enabled
            }
            nextValue = normalized
        }
        if (!deepEqual(prevSettings[key], nextValue)) {
            app.ui.settings.setSettingValue(comfyId, nextValue)
        }
    }

    // Language Features の個別同期
    if (!deepEqual(prevSettings.languageFeatures, currentSettings.languageFeatures)) {
        if (currentSettings.languageFeatures) {
            for (const feature of WebuiMonacoPrompt.getAllFeatures()) {
                const val = currentSettings.languageFeatures[feature.id]
                // 変更があった場合のみ更新
                if (prevSettings.languageFeatures?.[feature.id] !== val) {
                    app.ui.settings.setSettingValue(`WebuiMonacoPrompt.LanguageFeature.${feature.id}`, val)
                }
            }
        }
    }
    
    // ユーザプリセットの同期
    const currentPresets = WebuiMonacoPrompt.getUserPresets()
    if (!deepEqual(prevSettings.userPresets, currentPresets)) {
        app.ui.settings.setSettingValue(SETTING_MAP.userPresets, JSON.stringify(currentPresets))
        // プリセットオプションの更新（コンボボックスなどのUI同期用）
        WebuiMonacoPrompt.runAllInstances((instance: any) => {
            instance.updatePresetOptions?.()
        })
    }

    prevSettings = { ...normalizedSettings, userPresets: currentPresets }
}

async function loadSetting() {
    const settings = getSettings()
    
    const csvToggle = settings.csvToggle || {}
    WebuiMonacoPrompt.addLoadedCSV(getEnabledCSVs(csvToggle))
    
    // 全インスタンスに最新設定を強制適用（rebuildLanguage を含む）
    WebuiMonacoPrompt.runAllInstances((instance) => {
        instance.setSettings(settings, true)
    })
}

function decodeComfyString(val: any): any {
    if (val === undefined || val === null) return val;
    
    // すでに boolean や number の場合はそのまま返す
    if (typeof val === 'boolean' || typeof val === 'number') return val;

    let retval = val;
    if (typeof val === 'object' && '0' in val) {
        // 配列の長さを確認
        const keys = Object.keys(val).filter(k => /^\d+$/.test(k))
        if (keys.length === 1) {
            const innerVal = (val as any)[0]
            if (typeof innerVal === 'boolean' || typeof innerVal === 'number') {
                retval = innerVal
            } else if (typeof innerVal === 'string') {
                if (innerVal === "true") retval = true
                else if (innerVal === "false") retval = false
                else retval = innerVal
            }
        } else {
            const chars = []
            for (let i = 0; (' ' + i).trim() in (val as any); i++) {
                chars.push((val as any)[i])
            }
            retval = chars.join('')
        }
        console.log(`[WebuiMonacoPrompt] Decoded object array to:`, retval)
    } else if (typeof val === 'string') {
        if (val === "true") retval = true
        else if (val === "false") retval = false
    }
    return retval
}

function getSettings(forceReload = false) {
    const settings: any = {}
    
    // 物理メモリ共有デバッグ
    try {
        (window as any).WMP_DEBUG = {
            raw: localStorage.getItem("Comfy.Settings") || localStorage.getItem("comfy.settings"),
            time: performance.now()
        };
    } catch(e) {}

    const storageRaw = localStorage.getItem("Comfy.Settings") || localStorage.getItem("comfy.settings")
    let storage: any = {}
    try {
        storage = storageRaw ? (typeof storageRaw === 'string' ? JSON.parse(storageRaw) : storageRaw) : {}
    } catch (e) {
        console.error("[WebuiMonacoPrompt] Failed to parse settings storage", e)
    }

    for (const [key, comfyId] of Object.entries(SETTING_MAP)) {
        if (key === "csvToggle" || key === "languagePreset") continue
        const val = readSettingValue(storage, comfyId, true)
        if (val !== undefined) {
            settings[key] = val
        }
    }

    // ユーザプリセットのロード
    const userPresetsRaw = readSettingValue(storage, SETTING_MAP.userPresets, true)
    if (userPresetsRaw) {
        try {
            const presets = typeof userPresetsRaw === 'string' ? JSON.parse(userPresetsRaw) : userPresetsRaw
            if (Array.isArray(presets)) {
                WebuiMonacoPrompt.loadUserPresets(presets)
            }
        } catch (e) {
            console.error("[WebuiMonacoPrompt] Failed to parse user presets", e)
        }
    }

    // languagePreset: prefer persisted storage over app defaults
    const storedPreset = readSettingValue(storage, SETTING_MAP.languagePreset, false)
    if (storedPreset !== undefined) {
        settings.languagePreset = storedPreset
    }

    // CSV Toggle (supports legacy and per-key storage)
    const csvToggle: Record<string, boolean> = {}
    const csvToggleRaw = readSettingValue(storage, SETTING_MAP.csvToggle)
    if (csvToggleRaw && typeof csvToggleRaw === "object") {
        for (const [rawKey, enabled] of Object.entries(csvToggleRaw)) {
            csvToggle[normalizeCsvToggleKey(rawKey)] = !!enabled
        }
    }
    for (const [rawKey, rawValue] of Object.entries(storage)) {
        if (rawKey.startsWith("WebuiMonacoPrompt.CsvToggle.")) {
            const name = rawKey.slice("WebuiMonacoPrompt.CsvToggle.".length)
            csvToggle[`csv.${name}`] = !!decodeComfyString(rawValue)
        }
    }
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key) continue
        if (key.startsWith("Comfy.Settings.WebuiMonacoPrompt.CsvToggle.")) {
            const name = key.slice("Comfy.Settings.WebuiMonacoPrompt.CsvToggle.".length)
            const raw = localStorage.getItem(key)
            csvToggle[`csv.${name}`] = !!decodeComfyString(parseMaybeJson(raw))
        }
    }
    if (Object.keys(csvToggle).length > 0) {
        settings.csvToggle = csvToggle
    }

    const languageFeatures: any = {}
    
    // 現在のプリセット設定を取得（なければデフォルトプリセット）
    const presetId = settings.languagePreset || 'comfy-dynamic-prompt'
    if (settings.languagePreset === undefined) {
        settings.languagePreset = presetId
    }
    const targetPreset = WebuiMonacoPrompt.getPreset?.(presetId) || getLocalPreset(presetId)
    const baseFeatures = targetPreset?.features || {}

    const mapFeatures = readSettingValue(storage, "WebuiMonacoPrompt.LanguageFeatures", true)

    const featureList = WebuiMonacoPrompt.getAllFeatures?.() || localFeatures

    // まずプリセットのデフォルト値 or 明示的な LanguageFeatures をベースとしてセット
    for (const feature of featureList) {
        if (mapFeatures && typeof mapFeatures === "object" && feature.id in mapFeatures) {
            languageFeatures[feature.id] = !!(mapFeatures as any)[feature.id]
        } else {
            languageFeatures[feature.id] = baseFeatures[feature.id] !== undefined ? baseFeatures[feature.id] : false
        }
    }

    // 個別の設定値（ユーザーが手動でトグルしたもの）があれば、それを最優先で上書き
    for (const feature of featureList) {
        const featureKey = `WebuiMonacoPrompt.LanguageFeature.${feature.id}`
        // ComfyUI の設定オブジェクト内 (storage) と、直接の localStorage の両方を確認
        let val = readSettingValue(storage, featureKey, true)
        if (val === undefined) {
            val = decodeComfyString(localStorage.getItem(featureKey))
        }
        
        if (val !== undefined) {
            // 文字列 "true"/"false" や native boolean の両方を考慮
            languageFeatures[feature.id] = (val === "true" || val === true)
        }
    }

    settings.languageFeatures = languageFeatures

    return settings
}

export {
    loadSetting,
    getSettings,
    updateInstanceSettings,
    saveSettings,
}
