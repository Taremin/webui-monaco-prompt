import { deepEqual } from 'fast-equals'
import * as utils from "./utils"
import * as WebuiMonacoPrompt from "../index" // for typing
import { app } from "./api"

const SETTING_MAP: Record<string, string> = {
    minimap: "WebuiMonacoPrompt.Minimap",
    lineNumbers: "WebuiMonacoPrompt.LineNumbers",
    replaceUnderscore: "WebuiMonacoPrompt.ReplaceUnderscore",
    mode: "WebuiMonacoPrompt.KeyBindings",
    theme: "WebuiMonacoPrompt.Theme",
    language: "WebuiMonacoPrompt.Language",
    showHeader: "WebuiMonacoPrompt.ShowHeader",
    fontSize: "WebuiMonacoPrompt.FontSize",
    fontFamily: "WebuiMonacoPrompt.FontFamily",
    csvToggle: "WebuiMonacoPrompt.CsvToggle",
}

let prevSettings: any = null

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
    const settings: any = {}
    for (const [key, comfyId] of Object.entries(SETTING_MAP)) {
        const val = app.ui.settings.getSettingValue(comfyId)
        if (val !== undefined) {
            settings[key] = val
        }
    }

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
    if (deepEqual(prevSettings, currentSettings)) {
        return
    }
    
    for (const [key, comfyId] of Object.entries(SETTING_MAP)) {
        if (!deepEqual(prevSettings?.[key], (currentSettings as any)[key])) {
            app.ui.settings.setSettingValue(comfyId, (currentSettings as any)[key])
        }
    }
    
    prevSettings = currentSettings
}

async function loadSetting() {
    const csvToggle = app.ui.settings.getSettingValue("WebuiMonacoPrompt.CsvToggle") || {}
    WebuiMonacoPrompt.addLoadedCSV(getEnabledCSVs(csvToggle))
}

function getSettings() {
    const settings: any = {}
    for (const [key, comfyId] of Object.entries(SETTING_MAP)) {
        const val = app.ui.settings.getSettingValue(comfyId)
        if (val !== undefined) {
            settings[key] = val
        }
    }
    return settings
}

export {
    loadSetting,
    getSettings,
    updateInstanceSettings,
    saveSettings,
}