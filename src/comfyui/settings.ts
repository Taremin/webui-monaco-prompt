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
    languageFeatures: "WebuiMonacoPrompt.LanguageFeatures",
    showHeader: "WebuiMonacoPrompt.ShowHeader",
    fontSize: "WebuiMonacoPrompt.FontSize",
    fontFamily: "WebuiMonacoPrompt.FontFamily",
    csvToggle: "WebuiMonacoPrompt.CsvToggle",
    userPresets: "WebuiMonacoPrompt.LanguageUserPresets",
}

let prevSettings: any = null

function normalizeCsvToggleKey(rawKey: string) {
    if (rawKey.startsWith("WebuiMonacoPrompt.csv.")) {
        return rawKey.slice("WebuiMonacoPrompt.".length)
    }
    if (rawKey.startsWith("monacoPromptEditor.csv.")) {
        return rawKey.slice("monacoPromptEditor.".length)
    }
    if (rawKey.startsWith("csv.")) {
        return rawKey
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

let isSaving = false
let needsRetry = false

async function saveSettings(instance: WebuiMonacoPrompt.PromptEditor) {
    if (isSaving) {
        needsRetry = true
        return
    }
    isSaving = true
    if (typeof window !== "undefined") (window as any).WebuiMonacoPrompt_isSaving = true;
    try {
        do {
            needsRetry = false
            const currentSettings = instance.getSettings()
            const currentPresets = WebuiMonacoPrompt.getUserPresets()
            const normalizedSettings = { ...currentSettings } as any
            if (normalizedSettings.csvToggle && typeof normalizedSettings.csvToggle === "object") {
                const normalized: Record<string, boolean> = {}
                for (const [rawKey, enabled] of Object.entries(normalizedSettings.csvToggle)) {
                    normalized[normalizeCsvToggleKey(rawKey)] = !!enabled
                }
                normalizedSettings.csvToggle = normalized
            }

            // 変更がない場合はスキップ
            if (prevSettings && deepEqual(prevSettings, normalizedSettings)) {
                if (!needsRetry) break
                continue
            }

            if (!prevSettings) {
                prevSettings = normalizedSettings
            }

            // 基本設定の同期
            for (const [key, comfyId] of Object.entries(SETTING_MAP)) {
                let nextValue = normalizedSettings[key]
                if (key === "csvToggle" && nextValue && typeof nextValue === "object") {
                    const normalized: Record<string, boolean> = {}
                    for (const [rawKey, enabled] of Object.entries(nextValue)) {
                        normalized[normalizeCsvToggleKey(rawKey)] = !!enabled
                    }
                    nextValue = normalized
                }
                
                // Skip undefined values to avoid empty body in POST requests (prevents JSONDecodeError)
                if (nextValue === undefined) continue

                if (!prevSettings || !deepEqual(prevSettings[key], nextValue)) {
                    await app.ui.settings.setSettingValue(comfyId, nextValue)
                    // Small delay to prevent backend overload and JSONDecodeError
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            // Language Features の個別同期
            if (!deepEqual(prevSettings.languageFeatures, currentSettings.languageFeatures)) {
                if (currentSettings.languageFeatures) {
                    for (const feature of WebuiMonacoPrompt.getAllFeatures()) {
                        const val = currentSettings.languageFeatures[feature.id]
                        // 変更があった場合のみ更新
                        if (prevSettings.languageFeatures?.[feature.id] !== val) {
                            await app.ui.settings.setSettingValue(`WebuiMonacoPrompt.LanguageFeature.${feature.id}`, val)
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                    }
                }
            }

            prevSettings = normalizedSettings
        } while (needsRetry)
    } finally {
        isSaving = false
        if (typeof window !== "undefined") (window as any).WebuiMonacoPrompt_isSaving = false;
    }
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

function getSettings(forceReload = false) {
    const settings: any = {}
    
    if (!app?.ui?.settings) return settings;

    for (const [key, comfyId] of Object.entries(SETTING_MAP)) {
        if (key === "csvToggle" || key === "languagePreset") continue
        const val = app.ui.settings.getSettingValue(comfyId)
        if (val !== undefined) {
            settings[key] = val
        }
    }

    // ユーザプリセットのロード
    const userPresetsRaw = app.ui.settings.getSettingValue("WebuiMonacoPrompt.LanguageUserPresets")
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
    const storedPreset = app.ui.settings.getSettingValue(SETTING_MAP.languagePreset)
    if (storedPreset !== undefined) {
        settings.languagePreset = storedPreset
    }

    // CSV Toggle (supports legacy and per-key storage)
    const csvToggle: Record<string, boolean> = {}
    const csvToggleRaw = app.ui.settings.getSettingValue(SETTING_MAP.csvToggle)
    if (csvToggleRaw && typeof csvToggleRaw === "object") {
        for (const [rawKey, enabled] of Object.entries(csvToggleRaw)) {
            csvToggle[normalizeCsvToggleKey(rawKey)] = !!enabled
        }
    }
    settings.csvToggle = csvToggle

    // individual features (for initialization)
    const languageFeatures: Record<string, boolean> = {}
    for (const feature of WebuiMonacoPrompt.getAllFeatures()) {
        const featureKey = `WebuiMonacoPrompt.LanguageFeature.${feature.id}`
        let val = app.ui.settings.getSettingValue(featureKey)
        if (val !== undefined) {
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
