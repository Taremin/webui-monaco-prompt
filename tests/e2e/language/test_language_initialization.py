import pytest
import time
from playwright.sync_api import Page, expect

def verify_context_menu_selected_item(page: Page, menu_title: str, expected_item_label: str, wmp_helpers):
    """
    Monacoエディタを右クリックしてコンテキストメニューを開き、指定された項目が選択されているか確認する。
    """
    page.evaluate("""() => {
        const editorEl = document.querySelector('prompt-editor');
        if (editorEl) {
            const presetId = "full-features";
            if (editorEl.applyPreset) editorEl.applyPreset(presetId);
            if (editorEl.rebuildLanguage) editorEl.rebuildLanguage();
        }
    }""")
    wmp_helpers.wait_for_ui_stabilize(page)

    editor = page.locator(".monaco-editor").first
    box = editor.bounding_box()
    
    shadow_search_script = r"""
    async (label) => {
        const deepFind = (root, containers) => {
            if (!root) return;
            if (root.querySelectorAll) {
                const founds = root.querySelectorAll('.monaco-menu-container');
                founds.forEach(i => { if (!containers.includes(i)) containers.push(i); });
            }
            const all = Array.from(root.querySelectorAll ? root.querySelectorAll('*') : []);
            for (const el of all) { if (el.shadowRoot) deepFind(el.shadowRoot, containers); }
        };

        const getItems = () => {
            const containers = [];
            deepFind(document, containers);
            const items = [];
            for (const c of containers) {
                items.push(...Array.from(c.querySelectorAll('.action-item, .monaco-list-row, .monaco-menu-item')));
            }
            return items;
        };

        const labelMap = {
            'sd-prompt': 'SD Prompt', 'sd-dynamic-prompt': 'SD Prompt',
            'comfy-prompt': 'Comfy Prompt', 'composed-prompt': 'Comfy Prompt',
            'comfy-dynamic-prompt': 'Comfy Prompt', 'full-features': 'Full (All Features)'
        };
        const targetLabel = (labelMap[label] || label).toLowerCase();

        for (let attempt = 0; attempt < 20; attempt++) {
            const allItems = getItems();
            const parentItem = allItems.find(i => {
                const t = (i.innerText || i.textContent || i.getAttribute('aria-label') || "").toLowerCase();
                return /(language|言語)/i.test(t) && 
                       !/(theme|palette|command)/i.test(t);
            });

            if (parentItem) {
                ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach(type => {
                    parentItem.dispatchEvent(new MouseEvent(type, { bubbles: true }));
                });
                await new Promise(r => setTimeout(r, 1500));
                
                const subItems = getItems();
                const targetItem = subItems.find(i => {
                    const text = (i.innerText || i.textContent || i.getAttribute('aria-label') || "").trim().toLowerCase();
                    const cleanTarget = targetLabel.replace(/[-\s]/g, '');
                    const cleanText = text.replace(/[-\s\(\)]/g, '');
                    return cleanText.includes(cleanTarget);
                });

                if (targetItem) {
                    const labelEl = targetItem.querySelector('.action-label, .checked');
                    const isChecked = (labelEl && labelEl.classList.contains('checked')) || 
                                    (targetItem.getAttribute('aria-checked') === 'true') ||
                                    (targetItem.innerHTML.includes('selected') || targetItem.innerHTML.includes('checked'));
                    return { found: true, text: targetItem.innerText.split('\n')[0], isChecked: isChecked };
                }
            }
            await new Promise(r => setTimeout(r, 500));
        }
        return { found: false, msg: "NOT_FOUND", itemsText: getItems().map(i => i.innerText.trim().split('\n')[0]) };
    }
    """

    for i in range(3):
        print(f"--- Context Menu Attempt {i+1} ---")
        page.mouse.click(box["x"] + box["width"]/2, box["y"] + box["height"]/2, button="right")
        wmp_helpers.wait_for_ui_stabilize(page, 1500)
        
        result = page.evaluate(shadow_search_script, expected_item_label)
        print(f"DEBUG - Attempt {i+1} Result: {result}")
        
        if result.get("found"):
            assert result.get("isChecked"), f"Item '{expected_item_label}' should be CHECKED. Result: {result}"
            return
            
        page.keyboard.press("Escape")
        wmp_helpers.wait_for_ui_stabilize(page, 500)

    raise Exception(f"Failed to find and verify menu item '{expected_item_label}' after multiple attempts.")


def test_language_initialization_after_reload(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    CLIPTextEncodeノードのLanguage設定がページリロード時に保存・復元されるかを確認する。
    """
    page.set_viewport_size({"width": 1920, "height": 1080})
    
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    # 既存のカスタムプリセットなどの影響を完全に排除するためのクリア処理
    page.evaluate("""() => {
        localStorage.clear();
        if (window.app && window.app.ui && window.app.ui.settings) {
            window.app.ui.settings.setSettingValue("WebuiMonacoPrompt.LanguageUserPresets", "[]");
            window.app.ui.settings.setSettingValue("WebuiMonacoPrompt.LanguagePreset", "comfy-prompt");
        }
    }""")
    page.reload()
    wait_for_comfyui(page)

    wmp_helpers.wait_for_graph_clear(page)
    wmp_helpers.create_node(page, "CLIPTextEncode", [400, 300])

    page.wait_for_function("() => app.graph && app.graph._nodes.length > 0")
    wmp_helpers.wait_for_editor(page)
    
    page.reload()
    wait_for_comfyui(page)
    wmp_helpers.wait_for_editor(page)

    # loadSetting()は非同期のため、エディタ出現後もlanguage設定がまだ適用されていない場合がある
    # languageがplaintext以外になるまで待機する
    page.wait_for_function("""() => {
        const editorEl = document.querySelector('prompt-editor');
        if (!editorEl || !editorEl.monaco || !editorEl.monaco.getModel()) return false;
        return editorEl.monaco.getModel().getLanguageId() !== 'plaintext';
    }""", timeout=10000)

    actual_language = page.evaluate("""() => {
        const editorEl = document.querySelector('prompt-editor');
        if (editorEl && editorEl.monaco && editorEl.monaco.getModel()) {
            return editorEl.monaco.getModel().getLanguageId();
        }
        return 'UNKNOWN';
    }""")
    print(f"[CLIPTextEncode] Actual Language after reload: {actual_language}")
    # ComfyUIのデフォルト（SD Prompt）なので sd-prompt もしくは sd-dynamic-prompt が期待される
    assert actual_language != "plaintext"


def test_multitext_language_initialization_after_reload(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    MultiTextノードにおいて、Language設定が保存・復元されるかを確認する。
    """
    page.set_viewport_size({"width": 1920, "height": 1080})
    
    # ブラウザのコンソールログ出力を有効化
    page.on("console", lambda msg: print(f"[BROWSER] {msg.type}: {msg.text}"))
    
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    # 既存のカスタムプリセットなどの影響を完全に排除するためのクリア処理
    page.evaluate("""() => {
        localStorage.clear();
        if (window.app && window.app.ui && window.app.ui.settings) {
            window.app.ui.settings.setSettingValue("WebuiMonacoPrompt.LanguageUserPresets", "[]");
            window.app.ui.settings.setSettingValue("WebuiMonacoPrompt.LanguagePreset", "sd-dynamic-prompt");
        }
    }""")
    page.reload()
    wait_for_comfyui(page)

    # 登録待ち
    page.wait_for_function("""
        () => window.LiteGraph && window.LiteGraph.registered_node_types["WebuiMonacoPromptMultiText"]
    """)

    wmp_helpers.wait_for_graph_clear(page)
    wmp_helpers.create_node(page, "WebuiMonacoPromptMultiText", [400, 300])
    wmp_helpers.wait_for_editor(page)

    # sd-dynamic-prompt に設定して保存
    page.evaluate("""() => {
        const node = app.graph._nodes.find(n => n.type === "WebuiMonacoPromptMultiText");
        if (node) {
            node.setProperty("language_id", "sd-dynamic-prompt");
            const data = app.graph.serialize();
            const json = JSON.stringify(data);
            window.localStorage.setItem("comfy_workflow", json);
            window.localStorage.setItem("Comfy.Settings.comfy_workflow", json);
            console.log("Workflow saved to localStorage. Length:", json.length);
        }
    }""")
    wmp_helpers.wait_for_ui_stabilize(page, 2000)

    print("Reloading page...")
    page.reload()
    wait_for_comfyui(page)

    # リロード後にノード型が登録されるまで待つ
    print("Waiting for registration after reload...")
    page.wait_for_function("""
        () => window.LiteGraph && window.LiteGraph.registered_node_types["WebuiMonacoPromptMultiText"]
    """)

    # 手動ロード fallback
    page.evaluate("""() => {
        const getApp = () => window.app || window.ComfyApp || (window.comfyAPI && window.comfyAPI.app);
        const app = getApp();
        
        console.log("LocalStorage keys:", Object.keys(window.localStorage));
        console.log("Current nodes before manual load:", app.graph._nodes.map(n => n.type));
        
        const json = window.localStorage.getItem("comfy_workflow") || window.localStorage.getItem("Comfy.Settings.comfy_workflow");
        if (json) {
            console.log("Found workflow in localStorage, forcing loadGraphData...");
            app.loadGraphData(JSON.parse(json));
            console.log("Manual loadGraphData DONE. Node count:", app.graph._nodes.length);
        } else {
            console.error("No workflow found in localStorage");
        }
    }""")

    wmp_helpers.wait_for_editor(page)

    actual_lang = page.evaluate("""async () => {
        const app = window.app || window.ComfyApp || (window.comfyAPI && window.comfyAPI.app);
        for (let i = 0; i < 50; i++) {
            const node = app.graph._nodes.find(n => n.type === "WebuiMonacoPromptMultiText");
            if (node) {
                console.log("Node found! language_id:", node.properties.language_id);
                return node.properties.language_id;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        console.log("Node NOT FOUND after reload. Current types:", app.graph._nodes.map(n => n.type));
        return "NODE_NOT_FOUND";
    }""")
    print(f"[MultiText] Actual Language after reload: {actual_lang}")
    assert actual_lang == "sd-dynamic-prompt"


def test_multitext_tab_switch_context_menu(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    MultiTextのタブ切り替え時にエディタの内容が同期するかを確認する。
    """
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    # 既存のカスタムプリセットなどの影響を完全に排除するためのクリア処理
    page.evaluate("""() => {
        localStorage.clear();
        if (window.app && window.app.ui && window.app.ui.settings) {
            window.app.ui.settings.setSettingValue("WebuiMonacoPrompt.LanguageUserPresets", "[]");
            window.app.ui.settings.setSettingValue("WebuiMonacoPrompt.LanguagePreset", "comfy-prompt");
        }
    }""")
    page.reload()
    wait_for_comfyui(page)

    wmp_helpers.wait_for_graph_clear(page)
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp || (window.comfyAPI && window.comfyAPI.app);
        const node = window.LiteGraph.createNode("WebuiMonacoPromptMultiText");
        if (node) {
            node.pos = [400, 300];
            app.graph.add(node);
            app.canvas.centerOnNode(node);
            if (node.multitext_widget) {
                node.multitext_widget.addItemWithName('file', 'file1.txt', null, 'Text 1 content');
                node.multitext_widget.addItemWithName('file', 'file2.txt', null, 'Text 2 content');
                const f1 = node.multitext_widget.data.tree.find(i => i.name === 'file1.txt');
                if (f1) node.multitext_widget.openFile(f1.id);
            }
        }
    }""")
    wmp_helpers.wait_for_editor(page)

    # file1.txt 確認
    val1 = page.evaluate("() => document.querySelector('prompt-editor').monaco.getValue()")
    assert "Text 1" in val1

    # file2.txt 切り替え
    page.evaluate("""() => {
        const node = app.graph._nodes.find(n => n.type === "WebuiMonacoPromptMultiText");
        const f2 = node.multitext_widget.data.tree.find(i => i.name === 'file2.txt');
        if (f2) node.multitext_widget.openFile(f2.id);
    }""")
    wmp_helpers.wait_for_ui_stabilize(page)
    
    val2 = page.evaluate("() => document.querySelector('prompt-editor').monaco.getValue()")
    assert "Text 2" in val2

    # 言語ID確認
    lang_id = page.evaluate("() => document.querySelector('prompt-editor').monaco.getModel().getLanguageId()")
    verify_context_menu_selected_item(page, "Language", lang_id, wmp_helpers)
