import { LanguagePreset, getAllPresets, removeUserPreset } from './languages/presets'
import { LanguageFeatureToggle, allFeatures } from './languages/features'
import style from "./styles/index.css"

export class PresetDialog {
    container: HTMLElement
    onSave: (name: string, features: LanguageFeatureToggle) => void
    onApply: (presetId: string) => void
    onDelete: (presetId: string) => void
    getCurrentFeatures: () => LanguageFeatureToggle

    constructor(options: {
        onSave: (name: string, features: LanguageFeatureToggle) => void,
        onApply: (presetId: string) => void,
        onDelete: (presetId: string) => void,
        getCurrentFeatures: () => LanguageFeatureToggle
    }) {
        this.onSave = options.onSave
        this.onApply = options.onApply
        this.onDelete = options.onDelete
        this.getCurrentFeatures = options.getCurrentFeatures

        this.container = document.createElement('div')
        this.container.classList.add(style.dialogOverlay)
        this.container.style.display = 'none'
        document.body.appendChild(this.container)
        this.render()
    }

    show() {
        this.render()
        this.container.style.display = 'flex'
    }

    hide() {
        this.container.style.display = 'none'
    }

    render() {
        this.container.innerHTML = ''
        const dialog = document.createElement('div')
        dialog.id = 'webui-monaco-preset-dialog'
        dialog.classList.add(style.dialog)

        const header = document.createElement('h3')
        header.textContent = 'Manage Language Presets'
        dialog.appendChild(header)

        // Save Current Section
        const saveSection = document.createElement('div')
        saveSection.style.marginBottom = '1.5rem'
        const saveLabel = document.createElement('div')
        saveLabel.textContent = 'Save current features as preset:'
        saveLabel.style.marginBottom = '0.5rem'
        saveSection.appendChild(saveLabel)

        const inputRow = document.createElement('div')
        inputRow.style.display = 'flex'
        inputRow.style.gap = '0.5rem'

        const input = document.createElement('input')
        input.type = 'text'
        input.placeholder = 'Preset Name'
        input.style.flex = '1'
        inputRow.appendChild(input)

        const saveBtn = document.createElement('button')
        saveBtn.textContent = 'Save'
        saveBtn.onclick = () => {
            if (input.value.trim()) {
                this.onSave(input.value.trim(), this.getCurrentFeatures())
                this.render()
            }
        }
        inputRow.appendChild(saveBtn)
        saveSection.appendChild(inputRow)
        dialog.appendChild(saveSection)

        // Preset List Section
        const listLabel = document.createElement('div')
        listLabel.textContent = 'Existing Presets:'
        listLabel.style.marginBottom = '0.5rem'
        dialog.appendChild(listLabel)

        const listContainer = document.createElement('div')
        listContainer.classList.add(style["dialog-list"])

        const presets = getAllPresets()
        presets.forEach(preset => {
            const item = document.createElement('div')
            item.classList.add(style["dialog-item"])
            item.classList.add('preset-item') // テスト用固定クラス
            if (!preset.isBuiltin) {
                 item.dataset.isCustom = "true"
            }

            const label = document.createElement('span')
            label.classList.add(style["dialog-item-label"])
            label.textContent = preset.label + (preset.isBuiltin ? ' (Built-in)' : '')
            item.appendChild(label)

            const btnGroup = document.createElement('div')
            btnGroup.style.display = 'flex'
            btnGroup.style.gap = '0.5rem'

            const applyBtn = document.createElement('button')
            applyBtn.textContent = 'Apply'
            applyBtn.onclick = () => {
                this.onApply(preset.id)
                this.hide()
            }
            btnGroup.appendChild(applyBtn)

            if (!preset.isBuiltin) {
                const deleteBtn = document.createElement('button')
                deleteBtn.textContent = 'Delete'
                deleteBtn.style.color = '#ff4444'
                deleteBtn.onclick = () => {
                    if (confirm(`Delete preset "${preset.label}"?`)) {
                        this.onDelete(preset.id)
                        this.render()
                    }
                }
                btnGroup.appendChild(deleteBtn)
            }

            item.appendChild(btnGroup)
            listContainer.appendChild(item)
        })
        dialog.appendChild(listContainer)

        const footer = document.createElement('div')
        footer.classList.add(style["dialog-footer"])
        const closeBtn = document.createElement('button')
        closeBtn.textContent = 'Close'
        closeBtn.onclick = () => this.hide()
        footer.appendChild(closeBtn)
        dialog.appendChild(footer)

        this.container.appendChild(dialog)
    }
}
