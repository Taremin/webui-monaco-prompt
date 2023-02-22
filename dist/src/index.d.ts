import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { addCSV, loadCSV, getCount, addData, clearCSV } from './completion';
interface PromptEditorOptions {
    focus: boolean;
    autoLayout: boolean;
    handleTextAreaValue: boolean;
}
interface PromptEditorSettings {
    minimap: boolean;
    lineNumbers: boolean;
    mode: PromptEditorMode;
    theme: string;
    language: string;
}
interface PromptEditorElements {
    container: ShadowRoot;
    header: HTMLElement;
    main: HTMLElement;
    footer: HTMLElement;
    inner: HTMLDivElement;
    monaco: HTMLDivElement;
    language: HTMLSelectElement;
    theme: HTMLSelectElement;
    keyBindings: HTMLSelectElement;
    status: HTMLDivElement;
    lineNumbers: HTMLInputElement;
    minimap: HTMLInputElement;
}
declare enum PromptEditorMode {
    NORMAL = "NORMAL",
    VIM = "VIM"
}
declare class PromptEditor extends HTMLElement {
    elements: Partial<PromptEditorElements>;
    mode: PromptEditorMode;
    monaco: monaco.editor.IStandaloneCodeEditor;
    theme: string;
    vim: any;
    textareaDescriptor: PropertyDescriptor;
    textareaDisplay: string;
    onChangeShowLineNumbersCallback?: () => void;
    onChangeShowMinimapCallback?: () => void;
    onChangeThemeCallback?: () => void;
    onChangeModeCallback?: () => void;
    onChangeLanguageCallback?: () => void;
    constructor(textarea: HTMLTextAreaElement, options?: Partial<PromptEditorOptions>);
    changeMode(newMode: PromptEditorMode): void;
    changeTheme(newThemeId: string): void;
    changeLanguage(languageId: string): void;
    changeShowLineNumbers(show: boolean): void;
    changeShowMinimap(show: boolean): void;
    polyfillMonacoEditorConfiguration(): void;
    getThemeId(): any;
    setValue(value: string): void;
    hookTextAreaElement(textarea: HTMLTextAreaElement): void;
    initHeader(): void;
    syncLanguage(): void;
    syncKeyBindings(): void;
    syncTheme(): void;
    syncLineNumbers(): void;
    syncMinimap(): void;
    createCheckbox(labelText: string, callback: (label: HTMLLabelElement, input: HTMLInputElement) => void, isEnabledCallback: () => boolean, toggleCallback: (ev: Event) => void): HTMLLabelElement;
    createSelect(labelText: string, data: object, callback: (label: HTMLLabelElement, select: HTMLSelectElement) => void, isSelectedCallback: (dataValue: any) => boolean, changeCallback: (ev: Event) => void, getValue?: (value: any) => string): HTMLLabelElement;
    _mapToObject(map: Map<string, any>): {
        [key: string]: any;
    };
    _arrayToObject(array: string[]): {
        [key: string]: string;
    };
    handleResize(): void;
    copyStyleToShadow(): void;
    getSettings(): PromptEditorSettings;
    setSettings(settings: PromptEditorSettings): void;
    onChangeShowLineNumbers(callback: () => void): void;
    onChangeShowMinimap(callback: () => void): void;
    onChangeTheme(callback: () => void): void;
    onChangeMode(callback: () => void): void;
    onChangeLanguage(callback: () => void): void;
}
declare const runAllInstances: (callback: (instance: PromptEditor) => boolean | void) => void;
export { PromptEditor, getCount, loadCSV, addCSV, addData, clearCSV, runAllInstances, PromptEditorSettings, };
