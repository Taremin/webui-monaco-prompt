
import * as utils from "../utils"
import {default as style} from "./index.css"
import { FindWidget, FindWidgetElements } from "./find_widget"

interface ReplaceWidgetElements extends FindWidgetElements {
    replace: HTMLInputElement
}
class ReplaceWidget extends FindWidget {
    elements: ReplaceWidgetElements
    constructor(app: any) {
        super(app)
        this.elements = {} as ReplaceWidgetElements
    }
    createWidgetHeader() {
        super.createWidgetHeader()
        const headEl = this.elements.header

        const inputContainerEl = document.createElement("div")
        inputContainerEl.classList.add(style["webui-monaco-prompt-input"])

        const replaceEl = this.elements.replace = document.createElement("input")
        replaceEl.type = "text"
        replaceEl.placeholder = "Replace"
        replaceEl.classList.add(style["webui-monaco-prompt-input-text"])
        replaceEl.addEventListener("keydown", (ev) => {
            return this.findInputHandler(ev)
        })

        inputContainerEl.appendChild(replaceEl)
        headEl.appendChild(inputContainerEl)
    }
    createWidgetBody() {
        // pass
    }
    execute() {
        const inputEl = this.elements.input
        const replaceEl = this.elements.replace
        const matchFlags = this.getMatchFlags()

        utils.replace(inputEl.value, replaceEl.value, matchFlags.isRegex, matchFlags.matchCase, matchFlags.matchWordOnly)
    }
}

export {
    ReplaceWidget,
    ReplaceWidgetElements,
}