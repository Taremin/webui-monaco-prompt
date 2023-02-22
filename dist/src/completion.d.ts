import { languages } from 'monaco-editor/esm/vs/editor/editor.api';
declare const addData: (type: string, list: string[], clear?: boolean) => void;
declare const clearCSV: () => void;
declare const loadCSV: (csv: string) => void;
declare const addCSV: (csv: string) => void;
declare const updateFilteredTags: () => void;
declare const getCount: () => number;
declare const provider: languages.CompletionItemProvider;
export { provider, clearCSV, addCSV, loadCSV, getCount, addData, updateFilteredTags, };
