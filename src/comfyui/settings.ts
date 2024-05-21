import { deepEqual } from 'fast-equals'
import * as utils from "./utils"
import * as WebuiMonacoPrompt from "../index" // for typing
import { api } from "./api"

const me = "webui-monaco-prompt"

// 設定の読み込み
let prevSettings: any = null
let settings: any = {}
const updateSettings = (newSetting: any) => {
    if (!newSetting) {
        return
    }
    Object.assign(settings, newSetting)

    WebuiMonacoPrompt.runAllInstances((instance) => updateInstanceSettings(instance))

    if (settings.editor && settings.editor.csvToggle) {
        const enables = Object.entries(settings.editor.csvToggle).filter(([contextKey, value]) => {
            return value
        }).map(([contextKey, value]) => {
            return contextKey.split('.').slice(-1)[0]
        })
        WebuiMonacoPrompt.addLoadedCSV(enables)
    }
}
function updateInstanceSettings(instance: WebuiMonacoPrompt.PromptEditor) {
    if (!settings) {
        return
    }

    if (settings.editor) {
        instance.setSettings(settings.editor, true)
    }
    
    utils.updateThemeStyle(instance)
}

async function saveSettings(instance: WebuiMonacoPrompt.PromptEditor) {
    const currentSettings = instance.getSettings()
    if (deepEqual(prevSettings, currentSettings)) {
        return
    }
    prevSettings = currentSettings

    if (settings && settings.editor) {
        settings.editor = currentSettings
    }

    api.storeSetting(me, Object.assign(settings, {
        editor: currentSettings
    })).then((res: Response) => {
    })
}

async function loadSetting() {
    const settings = await api.getSetting(me)
    updateSettings(settings)
}

function getSettings() {
    return settings
}

export {
    loadSetting,
    getSettings,
    updateSettings,
    updateInstanceSettings,
    saveSettings,
}