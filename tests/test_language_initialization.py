import pytest
import time
from playwright.sync_api import Page, expect

def test_language_initialization_after_reload(page: Page, comfyui_server, wait_for_comfyui):
    """
    CLIPTextEncodeノードのLanguage設定がページリロード時に
    plaintextに初期化されてしまうバグが解消されているかを確認するテスト。
    """
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    # 1. ワークフローをクリア
    page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
    page.wait_for_function("() => app.graph && app.graph._nodes.length === 0")

    # 2. グラフにCLIP Text Encodeノードを追加
    page.evaluate("""() => {
        const getApp = () => window.app || window.ComfyApp;
        const app = getApp();
        const node = window.LiteGraph.createNode("CLIPTextEncode");
        node.pos = [400, 300];
        app.graph.add(node);
        app.canvas.centerOnNode(node);
        if (app.graph.change) app.graph.change();
    }""")

    page.wait_for_function("() => app.graph && app.graph._nodes.length > 0")
    page.wait_for_timeout(2000)

    # 3. リロードの実行
    print("Reloading page with CLIPTextEncode node...")
    page.reload()
    page.wait_for_load_state("domcontentloaded")
    wait_for_comfyui(page)
    page.wait_for_function("() => app.graph && app.graph._nodes.length > 0")

    # 4. エディタがアタッチされるのを待機
    page.wait_for_selector("prompt-editor", state="attached", timeout=30000)
    page.wait_for_selector(".monaco-editor", state="visible", timeout=30000)

    # 5. エディタのLanguage IDを取得して検証（DOM経由）
    actual_language = "UNKNOWN"
    for i in range(20):
        actual_language = page.evaluate("""() => {
            const editorEl = document.querySelector('prompt-editor');
            if (editorEl && editorEl.monaco && editorEl.monaco.getModel()) {
                return editorEl.monaco.getModel().getLanguageId();
            }
            return 'UNKNOWN';
        }""")
        if actual_language != "UNKNOWN":
            break
        page.wait_for_timeout(500)

    print(f"[CLIPTextEncode] Actual Language after reload: {actual_language}")
    assert actual_language != "UNKNOWN", "Failed to retrieve Language from the restored CLIPTextEncode editor."
    assert actual_language != "plaintext", f"CLIPTextEncode editor language should NOT be 'plaintext' after reload, but got '{actual_language}'."

    # 6. コンテキストメニューの検証
    print("[CLIPTextEncode] Verifying context menu selection...")
    verify_context_menu_selected_item(page, "Language", actual_language)


def verify_context_menu_selected_item(page: Page, menu_title: str, expected_item_label: str):
    """
    Monacoエディタを右クリックしてコンテキストメニューを開き、
    特定の項目（LanguageやThemeなど）のサブメニュー内で期待する項目が選択（チェック）されているかを確認する。
    """
    # エディタ上で右クリック。中央付近を狙う
    editor = page.locator(".monaco-editor").first
    box = editor.bounding_box()
    page.mouse.click(box["x"] + box["width"]/2, box["y"] + box["height"]/2, button="right")
    
    # メニューが表示されるのを待つ
    page.wait_for_selector(".monaco-menu-container", state="visible", timeout=10000)
    
    # "Language" などのサブメニューを探してホバー
    menu_item = page.locator(f".monaco-menu .action-item:has-text('{menu_title}')")
    expect(menu_item).to_be_visible()
    print(f"DEBUG - Hovering over menu item: {menu_title}")
    menu_item.hover()
    
    # サブメニュー項目が表示されるのを待つ
    print(f"DEBUG - Waiting for submenu item: {expected_item_label}")
    page.wait_for_timeout(2000) # メニュー展開の十分な猶予

    # Shadow DOMを考慮した検索関数を含むevaluate
    shadow_search_script = """
    (label) => {
        function findAllInShadow(root, selector, results = []) {
            const founds = root.querySelectorAll(selector);
            founds.forEach(f => results.push(f));
            
            const children = Array.from(root.children || []);
            for (const child of children) {
                if (child.shadowRoot) {
                    findAllInShadow(child.shadowRoot, selector, results);
                }
                findAllInShadow(child, selector, results);
            }
            return results;
        }

        // 全てのメニューコンテナを探す（サブメニューは新しいコンテナになることが多い）
        const containers = findAllInShadow(document, '.monaco-menu-container');
        if (containers.length === 0) return { found: false, msg: "CONTAINER_NOT_FOUND" };
        
        // 全てのコンテナから全項目を集める
        let allItems = [];
        for (const container of containers) {
            const items = Array.from(container.querySelectorAll('.action-item, .monaco-list-row'));
            items.forEach(i => allItems.push(i));
        }

        const item = allItems.find(i => i.innerText.includes(label));
        if (!item) return { found: false, msg: "ITEM_NOT_FOUND", itemsText: allItems.map(i => i.innerText.split('\\n')[0]) };
        
        const labelEl = item.querySelector('.action-label, .checked');
        const isChecked = (labelEl && labelEl.classList.contains('checked')) || 
                        (item.getAttribute('aria-checked') === 'true') ||
                        (item.innerHTML.includes('selected') || item.innerHTML.includes('checked'));
        
        return {
            found: true,
            text: item.innerText.split('\\n')[0],
            isChecked: isChecked,
            checkedItems: allItems.filter(i => {
                const l = i.querySelector('.action-label, .checked');
                return (l && l.classList.contains('checked')) || (i.getAttribute('aria-checked') === 'true');
            }).map(i => i.innerText.split('\\n')[0])
        };
    }
    """
    
    result = page.evaluate(shadow_search_script, expected_item_label)
    print(f"DEBUG - Menu Research Result: {result}")
    
    if not result.get('found'):
        page.screenshot(path=f"debug_menu_not_found_{expected_item_label}.png")
        assert result.get('found'), f"Could not find menu item '{expected_item_label}'. Result: {result}"
        
    is_checked = result.get('isChecked')
    
    if not is_checked:
        page.screenshot(path=f"debug_menu_unchecked_{expected_item_label}.png")
        checked_items = result.get('checkedItems', [])
        assert is_checked, f"Menu item '{expected_item_label}' should be checked. Currently checked: {checked_items}"
    
    print(f"Verified: '{expected_item_label}' is checked.")
    
    # メニューを閉じる
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    # もう一度Escapeを押して親メニューも閉じる
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)


def test_multitext_language_initialization_after_reload(page: Page, comfyui_server, wait_for_comfyui):
    """
    MultiTextノードのLanguage設定がページリロード時に正しく適用されているかを確認するテスト。
    MultiTextはファイルが存在しないとエディタが遅延初期化されないため、
    ノード追加→ファイル追加→保存→リロード のフローが必要。
    """
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    # 1. ワークフローをクリア
    page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
    page.wait_for_function("() => app.graph && app.graph._nodes.length === 0")

    # 2. MultiTextノードの登録を待機
    print("Polling for MultiText node registration...")
    node_type = page.evaluate("""async () => {
        const check = () => {
            if (typeof window.LiteGraph === 'undefined') return null;
            const types = Object.keys(window.LiteGraph.registered_node_types);
            return types.find(t => t.includes('WebuiMonacoPromptMultiText') || t.includes('MultiText')) || null;
        };
        
        let match = check();
        if (match) return match;
        
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500));
            match = check();
            if (match) return match;
        }
        return null;
    }""")
    assert node_type is not None, "Failed to find MultiText node type"
    print(f"Found MultiText node type: {node_type}")

    # 3. MultiTextノードを追加
    page.evaluate(f"""() => {{
        const getApp = () => window.app || window.ComfyApp;
        const app = getApp();
        const node = window.LiteGraph.createNode("{node_type}");
        node.pos = [400, 300];
        node.size = [800, 600];
        app.graph.add(node);
        app.canvas.centerOnNode(node);
    }}""")
    page.wait_for_function("() => app.graph && app.graph._nodes.length > 0")

    # 4. multitext_widgetの初期化を待つ
    page.wait_for_timeout(1000)
    
    # multitext_widgetの存在を確認
    has_widget = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        return !!node;
    }""")
    print(f"Has multitext_widget before file add: {has_widget}")

    # JS経由でファイルを追加（UIボタンはDOMレイヤーでの操作が不安定なため）
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        if (node && node.multitext_widget) {
            node.multitext_widget.addItem('file');
        }
    }""")
    page.wait_for_timeout(500)

    # 保存を確実にするため graphChanged イベントをディスパッチ
    page.evaluate("""() => {
        if (window.comfyAPI && window.comfyAPI.api && window.comfyAPI.api.api) {
            window.comfyAPI.api.api.dispatchEvent(new CustomEvent('graphChanged'));
        } else if (window.api) {
            window.api.dispatchEvent(new CustomEvent('graphChanged'));
        } else {
            app.graph.change();
        }
    }""")

    # 保存完了の猶予
    page.wait_for_timeout(2000)

    # 5. リロードの実行
    print("Reloading page with MultiText node (with file)...")
    page.reload()
    page.wait_for_load_state("domcontentloaded")
    wait_for_comfyui(page)

    # 復元を待つ
    page.wait_for_function("() => app.graph && app.graph._nodes.length > 0")

    # 6. MultiTextのwidget初期化を待つ（nodeCreatedイベントの処理完了まで）
    print("Waiting for multitext_widget to be initialized after reload...")
    widget_ready = False
    for i in range(30):
        check = page.evaluate("""() => {
            const app = window.app || window.ComfyApp;
            const nodes = app.graph._nodes;
            const mtNode = nodes.find(n => n.multitext_widget);
            if (mtNode) {
                return { found: true, hasEditor: !!mtNode.multitext_widget.editor, treeLen: mtNode.multitext_widget.data?.tree?.length || 0, activeFileId: mtNode.multitext_widget.data?.activeFileId || null };
            }
            return { found: false, nodeCount: nodes.length, nodeTypes: nodes.map(n => n.type) };
        }""")
        if check.get('found'):
            print(f"  [poll {i}] multitext_widget found! hasEditor: {check.get('hasEditor')}, treeLen: {check.get('treeLen')}, activeFileId: {check.get('activeFileId')}")
            if check.get('hasEditor'):
                widget_ready = True
                break
        else:
            if i < 3:
                print(f"  [poll {i}] waiting... nodeCount: {check.get('nodeCount')}, types: {check.get('nodeTypes')}")
        page.wait_for_timeout(500)
    
    assert widget_ready, "MultiText widget editor was not initialized after reload"

    # 7. エディタのLanguage IDを取得して検証
    actual_language = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const editor = node.multitext_widget.editor;
        return editor.monaco.getModel().getLanguageId();
    }""")

    print(f"[MultiText] Actual Language after reload: {actual_language}")
    assert actual_language != "plaintext", f"MultiText editor language should NOT be 'plaintext' after reload, but got '{actual_language}'."

    # 8. コンテキストメニューの検証
    print("[MultiText] Verifying context menu selection...")
    # MultiTextノード内のエディタは shadow root 内にある可能性があるが、
    # .monaco-editor クラスで特定可能。最初に見つかったもので検証（今回は1つだけのはず）
    verify_context_menu_selected_item(page, "Language", actual_language)


def test_multitext_tab_switch_context_menu(page: Page, comfyui_server, wait_for_comfyui):
    """
    MultiTextノードでタブを切り替えた際に、コンテキストメニューのLanguage選択状態が
    正しく現在のファイルの言語に同期されるかを検証する。
    """
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1280, "height": 720})
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    # 1. ワークフローをクリアしてMultiTextノードを追加
    page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = window.LiteGraph.createNode("WebuiMonacoPromptMultiText");
        node.pos = [400, 300];
        node.size = [800, 600];
        app.graph.add(node);
        app.canvas.centerOnNode(node);
    }""")
    page.wait_for_function("() => app.graph && app.graph._nodes.length > 0")
    
    # widgetの初期化を待つ
    page.wait_for_timeout(2000)

    # 2. 2つのファイルを作成し、両方を開いた状態にする
    print("Adding and opening another file to MultiText...")
    file2_id = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const widget = node.multitext_widget;
        widget.addItemWithName('file', 'test2.py');
        const file2 = widget.data.tree.find(i => i.name === 'test2.py');
        widget.openFile(file2.id); // test2.py を開く
        return file2.id;
    }""")
    
    file1_id = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const file1 = node.multitext_widget.data.tree.find(m => m.name === 'default.txt');
        return file1.id;
    }""")
    
    page.wait_for_timeout(1000)

    # 3. ファイル1を 'sd-prompt'、ファイル2を 'sd-dynamic-prompt' に設定
    print("Setting languages for files...")
    
    # ファイル1 (default.txt)
    page.evaluate(f"(id) => {{ app.graph._nodes.find(n => n.multitext_widget).multitext_widget.openFile(id); }}", file1_id)
    page.wait_for_timeout(500)
    page.evaluate("""() => {
        const editor = document.querySelector('prompt-editor');
        editor.changeLanguage('sd-prompt');
    }""")
    
    # ファイル2 (test2.py)
    page.evaluate(f"(id) => {{ app.graph._nodes.find(n => n.multitext_widget).multitext_widget.openFile(id); }}", file2_id)
    page.wait_for_timeout(500)
    page.evaluate("""() => {
        const editor = document.querySelector('prompt-editor');
        editor.changeLanguage('sd-dynamic-prompt');
    }""")

    # 4. 検証: ファイル1に切り替えてメニュー確認
    print("Switching back to File 1 (sd-prompt)...")
    page.evaluate(f"(id) => {{ app.graph._nodes.find(n => n.multitext_widget).multitext_widget.openFile(id); }}", file1_id)
    page.wait_for_timeout(1000)
    verify_context_menu_selected_item(page, "Language", "sd-prompt")

    # 5. 検証: ファイル2に切り替えてメニュー確認
    print("Switching back to File 2 (sd-dynamic-prompt)...")
    page.evaluate(f"(id) => {{ app.graph._nodes.find(n => n.multitext_widget).multitext_widget.openFile(id); }}", file2_id)
    page.wait_for_timeout(1000)
    verify_context_menu_selected_item(page, "Language", "sd-dynamic-prompt")

    print("MultiText tab switch context menu sync verified successfully.")
