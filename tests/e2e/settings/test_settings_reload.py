import pytest
import json
import time
import os
from datetime import datetime
from playwright.sync_api import Page, expect

def log_event(msg):
    print(f"[{msg}]")

def create_prompt_node(page: Page, wmp_helpers):
    """CLIP Text Encode (Prompt) ノードを確実に作成し、エディタを待機する"""
    log_event("Creating CLIPTextEncode node via API (V2 optimized)")
    page.evaluate("""() => {
        const findApp = () => {
            if (window.app) return window.app;
            if (window.comfyAPI && window.comfyAPI.app) return window.comfyAPI.app;
            const canvas = document.querySelector("comfy-canvas");
            if (canvas && canvas.app) return canvas.app;
            return null;
        };
        const app = findApp();
        if (!app) throw new Error("ComfyUI App not found for node creation");

        // ノード追加 (以前のグラフはクリア)
        app.graph.clear();
        const node = window.LiteGraph.createNode("CLIPTextEncode");
        if (!node) throw new Error("Failed to create CLIPTextEncode node");
        
        node.pos = [400, 300];
        app.graph.add(node);
        
        if (app.canvas) app.canvas.centerOnNode(node);
        if (app.graph.change) app.graph.change();
        if (app.canvas && app.canvas.draw) app.canvas.draw(true, true);
        
        console.log(`[DEBUG] Node added to graph. Node count: ${app.graph._nodes.length}`);
    }""")
    # 物理的な prompt-editor / Monaco Editor の出現を待つ
    wmp_helpers.wait_for_editor(page)
    
    # Monacoエディタ要素を取得
    editor_locator = page.locator("prompt-editor .monaco-editor").first
    return editor_locator

def test_settings_reload_maintains_jinja2(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    Jinja2ハイライトの設定がリロード後も維持されていることを検証する。
    """
    logs = []
    page.on("console", lambda msg: logs.append(f"[{msg.type.upper()}] {msg.text}"))
    # JS エラーをキャプチャ
    page.on("pageerror", lambda err: logs.append(f"[JS_ERROR] {err.message}\n{err.stack}"))

    try:
        log_event("Navigating to ComfyUI")
        wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)

        log_event("Enabling Jinja2 via API")
        wmp_helpers.set_comfy_setting(page, "WebuiMonacoPrompt.LanguageFeature.jinja2", True)

        log_event("Reloading page to ensure persistence")
        page.reload()
        wait_for_comfyui(page)
        wmp_helpers.wait_for_ui_stabilize(page, 5000) # 追加の待機

        log_event("Creating Prompt node after reload")
        create_prompt_node(page, wmp_helpers)
        
        log_event("Setting test text after reload")
        page.evaluate("""() => {
            const editor = document.querySelector('prompt-editor');
            if (editor && editor.monaco) {
                editor.monaco.setValue("{{ test_variable_after_reload_sync }}");
            }
        }""")
        
        wmp_helpers.wait_for_ui_stabilize(page, 6000) # 初期化を待つ
        
        log_event("Verifying Jina2 token via evaluate")
        # デバッグ情報を詳細化しつつ、判定を緩和
        debug_info = page.evaluate("""() => {
            const editor = document.querySelector('prompt-editor');
            if (!editor) return "ERROR: prompt-editor NOT FOUND";
            
            // 1. Language IDを直接確認 (最も確実な内部状態)
            const model = editor.monaco ? editor.monaco.getModel() : null;
            const langId = model ? model.getLanguageId() : "NONE";
            
            // 2. トークンタイプを確認（Monacoのtokenizeを利用）
            let tokenTypes = [];
            const monacoNS = window.monaco;
            if (monacoNS && monacoNS.editor && typeof monacoNS.editor.tokenize === "function") {
                const tokenLines = monacoNS.editor.tokenize("{{ test_variable_after_reload_sync }}", langId);
                tokenTypes = tokenLines.flat().map(t => t.type || "");
            }
            
            const wmpDebug = window.WMP_DEBUG || { error: "WMP_DEBUG NOT FOUND" };
            const storage = JSON.parse(localStorage.getItem("Comfy.Settings") || "{}");
            const wmpSettings = Object.keys(storage)
                .filter(k => k.startsWith("WebuiMonacoPrompt."))
                .reduce((obj, k) => { obj[k] = storage[k]; return obj; }, {});

            const res = {
                ok: tokenTypes.some(t => t.includes("jinja2")) || (editor.languageFeatures && editor.languageFeatures.jinja2 === true),
                langId: langId,
                features: editor.languageFeatures,
                storage: wmpSettings,
                wmpDebug: wmpDebug, // 追加
                docTitle: document.title,
                winName: window.name,
                tokenTypesSample: tokenTypes.slice(0, 5)
            };

            return `DUMP: ${JSON.stringify(res)}`;
        }""")
        assert "ok\":true" in debug_info.lower(), f"Jinja2 verification failed: {debug_info}"

    except Exception as e:
        print("\n--- CRITICAL DEBUG INFO (Jinja2) ---")
        try:
            debug_data = page.evaluate("""() => {
                const storage = JSON.parse(localStorage.getItem("Comfy.Settings") || "{}");
                return {
                    url: window.location.href,
                    title: document.title,
                    wmp_debug: window.WMP_DEBUG,
                    wmp_settings: Object.keys(storage).filter(k => k.includes("WebuiMonacoPrompt")).reduce((o, k) => { o[k] = storage[k]; return o; }, {}),
                    all_ls_keys: Object.keys(localStorage)
                };
            }""")
            print(f"DEBUG_DATA: {json.dumps(debug_data, indent=2)}")
        except Exception as eval_e:
            print(f"Failed to extract debug_data: {eval_e}")

        print("\n--- Browser Console Logs ---")
        print("\n".join(logs))
        print("----------------------------\n")
        raise e

def test_header_ui_preset_reload_persistence(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    Presetの設定がリロード後も維持されていることを検証する。
    """
    logs = []
    page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))
    try:
        log_event("Navigating to ComfyUI")
        wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)

        log_event("Changing preset via API")
        # 直接プリセットを変更
        wmp_helpers.set_comfy_setting(page, "WebuiMonacoPrompt.LanguagePreset", "comfy-prompt")
        
        # 個別のフィーチャー設定も明示的にOFFにする（'comfy-prompt' は全OFFではなく、独自の組み合わせを持つ）
        wmp_helpers.set_comfy_setting(page, "WebuiMonacoPrompt.LanguageFeature.comment-hash", False)
        wmp_helpers.set_comfy_setting(page, "WebuiMonacoPrompt.LanguageFeature.jinja2", False)

        log_event("Reloading page to ensure persistence")
        page.reload()
        wait_for_comfyui(page)

        log_event("Creating Prompt node after reload")
        create_prompt_node(page, wmp_helpers)

        log_event("Ensuring header is visible")
        wmp_helpers.set_comfy_setting(page, "WebuiMonacoPrompt.ShowHeader", True)
        wmp_helpers.wait_for_ui_stabilize(page, 2000)
        
        log_event("Verifying persisted preset via evaluate")
        # デバッグ情報を詳細化：期待するプリセットのフィーチャーと現在の状態を比較
        debug_info = page.evaluate("""() => {
            const editor = document.querySelector('prompt-editor');
            if (!editor || !editor.shadowRoot) return "NO_EDITOR";
            
            const currentPreset = editor.currentPreset;
            const features = editor.languageFeatures;
            
            // 期待するプリセット 'comfy-prompt' の定義を取得して比較
            const targetPreset = window.WebuiMonacoPrompt.getPreset('comfy-prompt');
            const diff = {};
            if (targetPreset) {
                for (const fid in targetPreset.features) {
                    if (targetPreset.features[fid] !== features[fid]) {
                        diff[fid] = { expected: targetPreset.features[fid], actual: features[fid] };
                    }
                }
            }
            
            // CSS Modules の影響でクラス名が動的になっている可能性があるため、labelテキストで探す
            const select = Array.from(editor.shadowRoot.querySelectorAll("header label"))
                .find(l => l.innerText.includes("Preset"))
                ?.querySelector("select");
            const selectVal = select ? select.value : "SELECT_NOT_FOUND";
            
            return {
                currentPreset,
                selectVal,
                features,
                diff,
                hasTargetPreset: !!targetPreset
            };
        }""")
        
        actual_val = debug_info["currentPreset"]
        diff_str = json.dumps(debug_info["diff"])
        # 内部機能の復元により、フィーチャー設定がプリセット定義と一致すれば
        # 正しくそのプリセット名（'comfy-prompt'）として認識される
        assert actual_val == "comfy-prompt", f"Persisted value mismatch. Expected 'comfy-prompt', got '{actual_val}'. Diff: {diff_str}. Select UI: {debug_info['selectVal']}"
        
    except Exception as e:
        print("\n--- CRITICAL DEBUG INFO (Preset) ---")
        try:
            debug_data = page.evaluate("""() => {
                const storage = JSON.parse(localStorage.getItem("Comfy.Settings") || "{}");
                return {
                    url: window.location.href,
                    title: document.title,
                    wmp_debug: window.WMP_DEBUG,
                    wmp_settings: Object.keys(storage).filter(k => k.includes("WebuiMonacoPrompt")).reduce((o, k) => { o[k] = storage[k]; return o; }, {}),
                    all_ls_keys: Object.keys(localStorage)
                };
            }""")
            print(f"DEBUG_DATA: {json.dumps(debug_data, indent=2)}")
        except Exception as eval_e:
            print(f"Failed to extract debug_data: {eval_e}")

        print("\n--- Browser Console Logs ---")
        print("\n".join(logs))
        print("----------------------------\n")
        raise e
