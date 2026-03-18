import pytest
import time
from playwright.sync_api import Page, expect

def setup_console_log(page: Page):
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.type}: {msg.text}"))
    page.on("pageerror", lambda err: print(f"BROWSER ERROR: {err}"))

def add_node_api_force(page: Page, wmp_helpers):
    """LiteGraphにノードが登録されるのを待ってから、APIを使用してMultiTextノードを直接追加する"""
    wmp_helpers.wait_for_graph_clear(page)
    # Wait for node type to be registered
    page.wait_for_function("""
        () => {
            const lg = window.LiteGraph;
            return lg && lg.registered_node_types && Object.keys(lg.registered_node_types).some(k => k.includes("MultiText"));
        }
    """, timeout=30000)
    
    type_name = page.evaluate("""
        () => Object.keys(window.LiteGraph.registered_node_types).find(k => k.includes("MultiText"))
    """)
    
    wmp_helpers.create_node(page, type_name, [300, 300])
    
    # multitext_widget が生成されるまで待機
    page.wait_for_function("""
        () => {
            const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const app = getApp();
            const node = app.graph._nodes.find(n => n.multitext_widget);
            return node && node.multitext_widget && !!node.multitext_widget.editorInstance;
        }
    """, timeout=30000)
    wmp_helpers.wait_for_ui_stabilize(page, 2000)

def test_multitext_search_highlight_visibility(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """マルチテキストノード内での検索ハイライトが表示されることを確認する"""
    setup_console_log(page)
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    add_node_api_force(page, wmp_helpers)
    
    # ファイルにテキストを入力
    page.evaluate("""
        () => {
            const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const app = getApp();
            const node = app.graph._nodes.find(n => n.type && n.type.includes("MultiText"));
            const controller = node.multitext_widget;
            const firstFile = controller.data.tree.find(item => item.type === 'file');
            const model = controller.models[firstFile.id];
            model.setValue("hello world\\nthis is a test\\nsearching for keyword");
        }
    """)
    wmp_helpers.wait_for_ui_stabilize(page)
    
    # 検索バーを開く
    page.locator("button[title='Search']").first.click()
    page.locator("input[class*='search-input']").first.fill("keyword")
    wmp_helpers.wait_for_ui_stabilize(page, 2000)
    
    # Monaco エディタ内のハイライトを確認
    highlight_exists = page.evaluate("""
        () => {
            const app = window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const node = app.graph._nodes.find(n => n.type && n.type.includes("MultiText"));
            if (!node || !node.multitext_widget || !node.multitext_widget.editor) return false;

            const editor = node.multitext_widget.editor.monaco;
            if (!editor) return false;

            // 1. Monaco のデコレーションを確認 (より確実)
            const model = editor.getModel();
            if (!model) return false;

            // モデルから全てのデコレーションを取得
            const decorations = model.getAllDecorations();
            const utils = window.WebuiMonacoPrompt && window.WebuiMonacoPrompt.utils;
            const targetClass = (utils && utils.getThemeClassName) ? utils.getThemeClassName() : "webui-monaco-prompt-findmatch";

            // 検索ハイライトに関連するクラスを持つデコレーションを探す
            const hasSearchDecoration = decorations.some(d => {
                const options = d.options;
                return (options.inlineClassName && options.inlineClassName.includes(targetClass)) ||
                       (options.className && options.className.includes("findMatch"));
            });

            if (hasSearchDecoration) return true;

            // 2. フォールバック: DOM スキャン
            const scan = (root) => {
                if (!root) return false;
                if (root.querySelectorAll) {
                    if (root.querySelectorAll(`.${targetClass}, [class*="findMatch"]`).length > 0) return true;
                }
                const children = Array.from(root.children || []);
                for (const child of children) {
                    if (scan(child)) return true;
                    if (child.shadowRoot && scan(child.shadowRoot)) return true;
                }
                return false;
            };

            return scan(document.body);
        }
    """)
    assert highlight_exists, "Search highlight not found in Monaco editor"

def test_multitext_preview_highlight_visibility(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """検索結果のプレビューツールチップ内でもハイライトが表示されることを確認する"""
    setup_console_log(page)
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    add_node_api_force(page, wmp_helpers)
    
    # テキスト設定
    page.evaluate("""
        () => {
            const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const app = getApp();
            const node = app.graph._nodes.find(n => n.type && n.type.includes("MultiText"));
            const controller = node.multitext_widget;
            const firstFile = controller.data.tree.find(item => item.type === 'file');
            const model = controller.models[firstFile.id];
            model.setValue("find me in preview keywords");
        }
    """)
    wmp_helpers.wait_for_ui_stabilize(page)
    
    # 検索
    page.locator("button[title='Search']").first.click()
    page.locator("input[class*='search-input']").first.fill("preview")
    wmp_helpers.wait_for_ui_stabilize(page, 2000)
    
    # 検索結果アイテムをホバー
    result_item = page.locator("[class*='multitext-search-result-item']").first
    result_item.hover()
    wmp_helpers.wait_for_ui_stabilize(page, 3000)
    
    # ツールチップのハイライトを確認
    preview_highlight_exists = page.evaluate("""
        () => {
            const utils = window.WebuiMonacoPrompt && window.WebuiMonacoPrompt.utils;
            const targetClass = (utils && utils.getThemeClassName) ? utils.getThemeClassName() : "webui-monaco-prompt-findmatch";

            const tooltip = document.querySelector("[class*='monaco-prompt-search-tooltip']");
            if (!tooltip) return false;
            
            const matches = tooltip.querySelectorAll(`.${targetClass}, [class*="findMatch"]`);
            if (matches.length > 0) {
                const style = window.getComputedStyle(matches[0]);
                return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
            }
            return false;
        }
    """)
    assert preview_highlight_exists, "Search highlight not found or not styled in preview tooltip"
