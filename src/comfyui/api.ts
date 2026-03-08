// ComfyUI の内部スクリプトを Webpack の externals 経由でインポートする
// @ts-ignore
import { app } from "../../scripts/app.js";
// @ts-ignore
import { api } from "../../scripts/api.js";
// @ts-ignore
import * as ui_module from "../../scripts/ui.js";

// ui は名前付きエクスポートでない可能性があるため、モジュール全体をチェック
const ui = (ui_module as any).ui || ui_module || (window as any).ui || {
    $el: (window as any).$el
};

export {
    app,
    api,
    ui,
}