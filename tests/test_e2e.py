import pytest
import time
from playwright.sync_api import Page, expect


def test_monaco_editor_replacement(page: Page, comfyui_server, wait_for_comfyui):
    """CLIP Text Encode ノードの textarea が Monaco Editor に置換されているか確認する"""
    # 基本タイムアウトを設定
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    # ノードが生成され、Monaco Promptがtextareaをスキャンして置換するまでの猶予
    # Stability Matrix等の重い環境では時間がかかるため最大60秒待機
    page.wait_for_selector(".monaco-editor", state="visible", timeout=60000)
    
    editor_count = page.locator(".monaco-editor").count()
    assert editor_count > 0, "Monaco Editor should be initialized and present in the UI"

def test_autocomplete_menu(page: Page, comfyui_server, wait_for_comfyui):
    """プロンプト入力時に補完メニューが表示されるか確認する"""
    page.set_default_timeout(60000)
    # コンソールログを収集するためのリスト
    console_logs = []
    page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    # prompt-editor カスタム要素が生成されるのを待つ
    try:
        page.wait_for_selector("prompt-editor", state="attached", timeout=60000)

        # prompt-editor の Shadow DOM 内の textarea にフォーカスし、
        # テキストを入力して補完をトリガーする
        # Shadow DOM 内にあるため、すべて JavaScript API 経由で操作する
        result = page.evaluate("""() => {
            const pe = document.querySelector('prompt-editor');
            if (!pe) return { error: 'prompt-editor not found' };
            
            const root = pe.shadowRoot || pe;
            const textarea = root.querySelector('textarea');
            if (!textarea) return { error: 'textarea not found in prompt-editor' };
            
            // フォーカス
            textarea.focus();
            textarea.click();
            
            return { ok: true, hasMonaco: !!pe.monaco };
        }""")
        print(f"Focus result: {result}")

        page.wait_for_timeout(500)

        # Monaco エディタの内容をクリアしてテキストを入力
        page.evaluate("""() => {
            const pe = document.querySelector('prompt-editor');
            if (!pe) throw new Error('prompt-editor not found');
            
            // 追加された API を使用して値をセット
            pe.setValue('1girl');
            
            // 追加された API を使用してフォーカス
            pe.focus();
        }""")

        page.wait_for_timeout(500)

        # Monaco の suggest（補完）をトリガー
        # keyboard.press("Control+ ") はShadow DOM越しでは機能しないため、
        # Monaco API を使って直接トリガーする
        page.evaluate("""() => {
            const pe = document.querySelector('prompt-editor');
            if (!pe || !pe.monaco) throw new Error('Monaco editor not found');
            
            // エディタにフォーカスを当てる
            pe.monaco.focus();
            
            // Monaco API経由でsuggestをトリガー
            pe.monaco.trigger('test', 'editor.action.triggerSuggest', {});
        }""")

        # 補完メニュー (suggest-widget) を確認
        # suggest-widget は Shadow DOM 内に生成されるため、JavaScript で検出
        has_suggest = False
        for i in range(15):
            has_suggest = page.evaluate("""() => {
                const editors = document.querySelectorAll('prompt-editor');
                for (const pe of editors) {
                    const root = pe.shadowRoot || pe;
                    const suggest = root.querySelector('.suggest-widget');
                    if (suggest && suggest.classList.contains('visible')) return true;
                    if (suggest && suggest.offsetHeight > 0 && suggest.style.display !== 'none') return true;
                }
                // メインドキュメントのフォールバック
                const mainSuggest = document.querySelector('.suggest-widget');
                if (mainSuggest && mainSuggest.offsetHeight > 0) return true;
                return false;
            }""")
            if has_suggest:
                break
            page.wait_for_timeout(1000)

        if not has_suggest:
            # デバッグ情報を収集
            debug = page.evaluate("""() => {
                const info = {};
                const editors = document.querySelectorAll('prompt-editor');
                info.editorCount = editors.length;
                info.activeElement = document.activeElement ? document.activeElement.tagName + '.' + document.activeElement.className : 'none';
                
                for (let i = 0; i < editors.length; i++) {
                    const pe = editors[i];
                    const root = pe.shadowRoot || pe;
                    const viewLines = root.querySelector('.view-lines');
                    info[`editor${i}_content`] = viewLines ? viewLines.innerText.trim() : 'N/A';
                    info[`editor${i}_hasMonaco`] = !!pe.monaco;
                    info[`editor${i}_monacoValue`] = pe.getValue ? pe.getValue() : 'pe.getValue not found';
                    const suggest = root.querySelector('.suggest-widget');
                    info[`editor${i}_suggestExists`] = !!suggest;
                    if (suggest) {
                        info[`editor${i}_suggestClasses`] = suggest.className;
                        info[`editor${i}_suggestHeight`] = suggest.offsetHeight;
                        info[`editor${i}_suggestDisplay`] = suggest.style.display;
                    }
                }
                return info;
            }""")
            print(f"Autocomplete debug info: {debug}")

        assert has_suggest, "Suggest widget should be visible after triggering autocomplete"

    except Exception as e:
        # ログをファイルに保存
        with open("tests/browser_console.log", "w", encoding="utf-8") as f:
            f.writelines(line + "\n" for line in console_logs)

        page.screenshot(path="tests/autocomplete_failure.png", full_page=True)
        try:
            with open("tests/autocomplete_debug.html", "w", encoding="utf-8") as f:
                f.write(page.content())
        except:
            pass
        raise e



def test_settings_persistence(page: Page, comfyui_server, wait_for_comfyui):
    """設定が変更され、リロード後も維持されるか確認する"""
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    # 設定ダイアログを開ける状態か確認しつつ開く (Ctrl + ,)
    # ComfyUIのメニューがロードされ、設定ボタン（または同等のUI）が存在するのを待つ
    page.wait_for_function("() => typeof app !== 'undefined' && app.ui && app.ui.settings")
    page.keyboard.press("Control+,")
    page.wait_for_selector("div[role='dialog']:visible, .comfy-modal:visible, .p-dialog:visible", timeout=30000)

    # WebUI Monaco Prompt のカテゴリを探す
    monaco_category = page.locator("text=WebUI Monaco Prompt").or_(page.locator("text=webui-monaco-prompt"))
    if monaco_category.is_visible():
        monaco_category.click()
        
        # 「Minimap」のトグルを探して切り替えてみる (Vim Modeはバグがある可能性があるため回避)
        minimap_toggle = page.get_by_label("Minimap").or_(page.get_by_text("Minimap"))
        if minimap_toggle.is_visible():
            initial_checked = minimap_toggle.is_checked()
            minimap_toggle.click()
            
            # チェック状態が切り替わるのを待つ
            if initial_checked:
                expect(minimap_toggle).not_to_be_checked(timeout=5000)
            else:
                expect(minimap_toggle).to_be_checked(timeout=5000)
            
            # リロードして維持されているか確認
            page.reload()
            wait_for_comfyui(page)
            
            page.keyboard.press("Control+,")
            monaco_category.click()
            # リロード後はDOMが新しくなるので再取得
            new_minimap_toggle = page.get_by_label("Minimap").or_(page.get_by_text("Minimap"))
            assert new_minimap_toggle.is_checked() != initial_checked, "Settings should be persisted after reload"

def test_multitext_reload(page, comfyui_server, wait_for_comfyui):
    """MultiTextウィジェットで入力した内容がリロード後も復元されるか確認する"""
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(comfyui_server)
    
    # コンソールログを収集
    page.on("console", lambda msg: print(f"Browser Console [{msg.type}]: {msg.text}"))
    wait_for_comfyui(page)
    
    print("Waiting for page load...")
    page.wait_for_load_state("domcontentloaded")
    print("Page basic load finished.")

    # ワークフローをクリア
    page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
    # グラフのノードが0になるのを待機
    page.wait_for_function("() => app.graph && app.graph._nodes.length === 0")

    # 登録されているノードの一覧から正しい名前を探す
    # 登録されるまでリトライするように wait_for_function 内で行う
    print("Polling for MultiText node registration...")
    node_type = page.evaluate("""async () => {
        const check = () => {
            if (typeof window.LiteGraph === 'undefined') return null;
            const types = Object.keys(window.LiteGraph.registered_node_types);
            return types.find(t => t.includes('WebuiMonacoPromptMultiText') || t.includes('MultiText')) || null;
        };
        
        let match = check();
        if (match) return match;
        
        // 10秒間リトライ
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500));
            match = check();
            if (match) return match;
        }
        return null;
    }""")
    
    print(f"Target node type found: {node_type}")
    
    # ノード追加
    page.evaluate(f"""() => {{
        const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = getApp();
        const node = window.LiteGraph.createNode("{node_type}");
        node.pos = [400, 300];
        app.graph.add(node);
        app.canvas.centerOnNode(node);
    }}""")
    
    # ノードがグラフに追加されるのを待機
    page.wait_for_function("() => app.graph && app.graph._nodes.length > 0")

    # Monaco Editor が表示されるのを待つ
    print("Waiting for prompt-editor...")
    
    # セレクタを広範にするため prompt-editor 自体を待つ
    try:
        page.wait_for_selector("prompt-editor", state="attached", timeout=45000)
        print("prompt-editor attached.")
    except Exception as e:
        page.screenshot(path="e2e_error_editor_attached.png")
        with open("e2e_dom_dump.html", "w", encoding="utf-8") as f:
            f.write(page.content())
        raise e
    
    # 座標を取得してクリック
    box = page.locator("prompt-editor").first.bounding_box()
    if box:
        page.mouse.click(box['x'] + box['width']/2, box['y'] + box['height']/2)
    else:
        print("Warning: Could not get boundingbox for prompt-editor, using force click")
        page.locator("prompt-editor").first.click(force=True)
    
    # textarea が存在するまで待つ
    page.evaluate("""() => new Promise(resolve => {
        const check = () => {
            const editor = document.querySelector('prompt-editor');
            if (editor) {
                const root = editor.shadowRoot || editor;
                if (root.querySelector('textarea')) return resolve();
            }
            setTimeout(check, 100);
        };
        check();
    })""")
    
    # textarea にフォーカス
    page.evaluate("""() => {
        const editor = document.querySelector('prompt-editor');
        if (editor) {
            const root = editor.shadowRoot || editor;
            const textarea = root.querySelector('textarea');
            if (textarea) textarea.focus();
        }
    }""")
    test_text = "test reload persistence pattern"
    # 直接 Monaco の API を叩いて値をセットする
    page.evaluate(f"""() => {{
        const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = getApp();
        const node = app.graph._nodes.find(n => n.type && n.type.includes('MultiText'));
        if (node && node.multitext_widget && node.multitext_widget.editorInstance) {{
            node.multitext_widget.editorInstance.monaco.setValue("{test_text}");
            // 同期を促す
            node.multitext_widget.syncData();
            // ComfyUIに確実に変更を通知するため、標準ウィジェットのコールバックを叩く
            const dataWidget = node.widgets.find(w => w.name === "text");
            if (dataWidget && typeof dataWidget.callback === 'function') {{
                dataWidget.callback(dataWidget.value, app.canvas, node, node.pos);
            }}
        }}
    }}""")
    
    # 入力後の値が反映されるのを待機
    page.wait_for_function(f"""() => {{
        const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = getApp();
        const node = app.graph._nodes.find(n => n.type && n.type.includes('MultiText'));
        if (node && node.multitext_widget && node.multitext_widget.editorInstance) {{
            return node.multitext_widget.editorInstance.monaco.getValue() === "{test_text}";
        }}
        return false;
    }}""")
    
    # 入力後の値をチェック
    typed_val = page.evaluate("""() => {
        const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = getApp();
        const node = app.graph._nodes.find(n => n.type && n.type.includes('MultiText'));
        if (node && node.multitext_widget && node.multitext_widget.editorInstance) {
            return node.multitext_widget.editorInstance.monaco.getValue();
        }
        return 'ERR: node or editorInstance not found';
    }""")
    print(f"Typed value in editor: {typed_val}")
    assert test_text in typed_val, f"Test text not reflected in editor after setValue. Current value: {typed_val}"

    # ComfyUIのオートセーブ (グラフ変更検知) が作動するよう少し待機
    # ウィジェット側の setValue / syncData で app.graph.change() は発火するため、自動で保存されるはず
    page.wait_for_timeout(2000)

    # --- 診断: リロード直前にグラフの内部状態と localStorage を確認 ---
    graph_before = page.evaluate("() => JSON.stringify(window.app.graph.serialize())")
    ls_before = page.evaluate("() => localStorage.getItem('workflow')")
    print(f"Diagnosis BEFORE reload:")
    print(f"  Graph serialize size: {len(graph_before) if graph_before else 'None'}, contains text: {test_text in (graph_before or '')}")
    print(f"  localStorage size: {len(ls_before) if ls_before else 'None'}, contains text: {test_text in (ls_before or '')}")
    
    # ComfyUIのオートセーブ (グラフ変更検知) は即座にはlocalStorageへ反映されないことがあるため、
    # グラフ変更イベントを明示的に発火して保存処理を誘発します
    page.evaluate("""() => {
        if (window.comfyAPI && window.comfyAPI.api && window.comfyAPI.api.api) {
            window.comfyAPI.api.api.dispatchEvent(new CustomEvent('graphChanged'));
        } else if (window.api) {
            window.api.dispatchEvent(new CustomEvent('graphChanged'));
        } else {
            app.graph.change();
        }
    }""")
    page.wait_for_timeout(1000)

    # リロード
    print("Reloading page...")
    page.reload()
    page.wait_for_load_state("domcontentloaded")
    


    # リロード後にComfyUIが初期化されるのを待機 (time.sleepの代替)
    wait_for_comfyui(page)
    
    # ComfyUIは初期化時に自動的に localStorage の workflow をロードするため、明示的なロード処理は不要
    
    # ロード後のノード展開を待つ
    page.wait_for_function("() => { const app = window.app || window.ComfyApp; return app && app.graph && app.graph._nodes && app.graph._nodes.length > 0; }")
    
    print("Workflow re-loaded automatically.")
    
    # ComfyUI自動ロード後にもう一度 localStorage をチェック
    ls_val2 = page.evaluate("() => localStorage.getItem('workflow')")
    print(f"localStorage['workflow'] after comfyUI load: {len(ls_val2) if ls_val2 else 'None'}")
    if ls_val2 and test_text not in ls_val2:
        print("CRITICAL: test_text was OVERWRITTEN in localStorage by ComfyUI!")

    # Monaco Editor が再度表示されるのを確認
    page.wait_for_selector(".monaco-editor", state="visible", timeout=30000)

    # 値が保持されているか確認
    # リロード後のエディタの値をノード経由で取得 (リトライあり)
    page.screenshot(path="e2e_after_reload.png")
    
    val = ""
    for i in range(20):
        # デバッグ: 全ノードの状態をダンプ
        node_debug = page.evaluate("""() => {
            const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const app = getApp();
            return app.graph._nodes.filter(n => n.type && n.type.includes('MultiText')).map(n => ({
                id: n.id,
                isInitialized: n.multitext_widget ? n.multitext_widget.isInitialized : 'no_widget',
                hasEditor: n.multitext_widget ? !!n.multitext_widget.editorInstance : false,
                value: n.multitext_widget && n.multitext_widget.editorInstance ? n.multitext_widget.editorInstance.monaco.getValue() : 'N/A'
            }));
        }""")
        print(f"DEBUG (Attempt {i+1}): MultiText nodes: {node_debug}")

        val = page.evaluate("""() => {
            const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const app = getApp();
            // データを持っているノードを優先的に探す
            const nodes = app.graph._nodes.filter(n => n.type && n.type.includes('MultiText'));
            const node = nodes.find(n => n.multitext_widget && n.multitext_widget.isInitialized) || nodes[0];
            if (node && node.multitext_widget && node.multitext_widget.editorInstance) {
                return node.multitext_widget.editorInstance.monaco.getValue();
            }
            return 'ERR: node or editorInstance not found';
        }""")
        if test_text in val:
            break
        print(f"Waiting for value in editor (attempt {i+1}). Current: '{val}'")
        page.wait_for_timeout(1000)

    print(f"Value after reload: {val}")
    assert test_text in val, f"Expected text '{test_text}' not found after reload even after retry. Current value: {val}"

