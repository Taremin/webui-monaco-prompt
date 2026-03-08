export function escapeHTML(unsafe: string) {
    return unsafe
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
}

// Monaco のテーマに合わせて検索マッチ部分の style 要素を生成・更新
const themeStyleClassName = "webui-monaco-prompt-findmatch"
export const getThemeClassName = () => themeStyleClassName

export const guid = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export const getStyle = (styleObj: any, name: string) => {
    const s = styleObj[name];
    if (s === undefined) {
        throw new Error(`[WebuiMonacoPrompt] Style not found: ${name}`);
    }
    return s;
}
