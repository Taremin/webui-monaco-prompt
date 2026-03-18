import pytest
import time
from playwright.sync_api import Page, expect

# ブラウザのコンソールログを収集するヘルパー
def setup_console_log(page: Page):
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.type}: {msg.text}"))
    page.on("pageerror", lambda err: print(f"BROWSER ERROR: {err}"))

def add_node_api_force(page: Page):
    """LiteGraphにノードが登録されるのを待ってから、APIを使用してMultiTextノードを直接追加する"""
    for _ in range(10):
        found = page.evaluate("""
            () => {
                const lg = window.LiteGraph;
                if (!lg || !lg.registered_node_types) return null;
                const type = Object.keys(lg.registered_node_types).find(k => k.includes("MultiText"));
                if (type) {
                    const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp || (window.parent && window.parent.app);
                    const app = getApp();
                    app.graph.clear();
                    const node = lg.createNode(type);
                    node.pos = [300, 300]; 
                    node.size = [400, 400];
                    app.graph.add(node);
                    app.canvas.draw(true, true);
                    return { type, id: node.id };
                }
                return null;
            }
        """)
        if found:
            print(f"DEBUG: Added node {found}")
            return found
        time.sleep(2.0)
    raise Exception("MultiText node type not found")

def create_items_api(page: Page, items):
    """APIを使用して一括でファイル/フォルダを作成する"""
    print(f"DEBUG: Creating {len(items)} items via API...")
    success = page.evaluate("""
        (items) => {
            const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const app = getApp();
            const node = app.graph.nodes.find(n => n.type && n.type.includes("MultiText"));
            if (!node) {
                console.error("MultiText node not found in graph");
                return false;
            }
            
            // ウィジェットを見つける（multitext_widgetプロパティまたはwidgets内から）
            let widget = node.multitext_widget;
            if (!widget && node.widgets) {
                widget = node.widgets.find(w => w.addItemWithName);
            }
            
            if (!widget) {
                console.error("MultiText widget instance not found on node", node);
                return false;
            }
            
            for (const item of items) {
                widget.addItemWithName(item[0], item[1]);
            }
            return true;
        }
    """, items)
    if not success:
        print("ERROR: create_items_api failed in browser")
    time.sleep(1.0)

def test_multitext_tab_auto_scroll(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """タブの自動スクロールを確認する"""
    setup_console_log(page)
    page.goto(comfyui_server)
    wait_for_comfyui(page)
    add_node_api_force(page)
    
    # ファイルを25個作成
    items = [("file", f"file_{i:02d}.txt") for i in range(1, 26)]
    create_items_api(page, items)

    tabs_container = page.locator("[class*='multitext-tabs-container']").first
    
    # default.txtが画面に出るまで少し待機
    page.wait_for_selector("[class*='multitext-tree-name']")
    
    # 最初のファイルを選択
    page.locator("[class*='multitext-tree-name']", has_text="default.txt").first.click(force=True)
    wmp_helpers.wait_for_ui_stabilize(page, 1000)
    scroll_left_start = tabs_container.evaluate("el => el.scrollLeft")
    
    # 最後のファイルを選択
    page.locator("[class*='multitext-tree-name']", has_text="file_25.txt").first.click(force=True)
    wmp_helpers.wait_for_ui_stabilize(page, 3000)
    scroll_left_end = tabs_container.evaluate("el => el.scrollLeft")
    
    print(f"DEBUG: scrollLeft start={scroll_left_start}, end={scroll_left_end}")
    assert scroll_left_end > scroll_left_start

def test_multitext_multiple_selection_dnd(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """複数選択D&Dを確認する"""
    setup_console_log(page)
    page.goto(comfyui_server)
    wait_for_comfyui(page)
    add_node_api_force(page)
    
    # フォルダとファイル作成
    items = [("folder", "target_folder"), ("file", "move_me_1.txt"), ("file", "move_me_2.txt"), ("file", "move_me_3.txt")]
    create_items_api(page, items)

    # 確実にツリーが描画されるのを待つ
    page.wait_for_selector("[class*='multitext-tree-name']")

    # Ctrl選択
    page.locator("[class*='multitext-tree-name']", has_text="move_me_1.txt").first.click(force=True)
    page.locator("[class*='multitext-tree-name']", has_text="move_me_2.txt").first.click(modifiers=["Control"], force=True)
    page.locator("[class*='multitext-tree-name']", has_text="move_me_3.txt").first.click(modifiers=["Control"], force=True)
    
    wmp_helpers.wait_for_ui_stabilize(page, 1000)
    
    # 選択されたツリーアイテムの数を検証 (属性セレクタを使用)
    selected_count = page.evaluate("""() => {
        const items = Array.from(document.querySelectorAll("[class*='multitext-tree-item']"));
        return items.filter(el => el.className.includes('selected')).length;
    }""")
    print(f"DEBUG: selected count via JS is {selected_count}")
    assert selected_count == 3
    # ドラッグ＆ドロップ
    source = page.locator("[class*='multitext-tree-name']", has_text="move_me_1.txt").first
    target = page.locator("[class*='multitext-tree-name']", has_text="target_folder").first
    
    source.drag_to(target, force=True)
    wmp_helpers.wait_for_ui_stabilize(page, 1000)
    
    # 選択されたツリーアイテムの数を検証 (属性セレクタを使用)
    selected_count = page.evaluate("""() => {
        const items = Array.from(document.querySelectorAll("[class*='multitext-tree-item']"));
        return items.filter(el => el.className.includes('selected')).length;
    }""")
    print(f"DEBUG: selected count via JS is {selected_count}")
    assert selected_count == 3

    # 移動確認
    folder_wrapper = page.locator("[class*='multitext-tree-item-wrapper']", has_text="target_folder").first
    children = folder_wrapper.locator("[class*='multitext-tree-children']")
    
    expect(children.get_by_text("move_me_1.txt")).to_be_visible()
    expect(children.get_by_text("move_me_2.txt")).to_be_visible()
    expect(children.get_by_text("move_me_3.txt")).to_be_visible()

def test_multitext_shift_selection(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """Shift選択（範囲選択）を確認する"""
    setup_console_log(page)
    page.goto(comfyui_server)
    wait_for_comfyui(page)
    add_node_api_force(page)
    
    items = [("file", f"range_{i}.txt") for i in range(1, 6)]
    create_items_api(page, items)
    
    page.wait_for_selector("[class*='multitext-tree-name']")
    
    # 最初と最後をShiftクリック
    page.locator("[class*='multitext-tree-name']", has_text="range_1.txt").first.click(force=True)
    page.locator("[class*='multitext-tree-name']", has_text="range_5.txt").first.click(modifiers=["Shift"], force=True)
    
    wmp_helpers.wait_for_ui_stabilize(page, 1000)
    
    # 選択されたツリーアイテムの数を検証
    selected_count = page.evaluate("""() => {
        const items = Array.from(document.querySelectorAll("[class*='multitext-tree-item']"));
        return items.filter(el => el.className.includes('selected')).length;
    }""")
    print(f"DEBUG: Shift selection count via JS is {selected_count}")
    
    assert selected_count == 5

def test_multitext_search_toggle_and_clear(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """検索バーのトグル表示とクリアボタンの動作を確認する"""
    setup_console_log(page)
    page.goto(comfyui_server)
    wait_for_comfyui(page)
    add_node_api_force(page)
    
    # テスト用ファイル作成
    items = [("file", "search_test.txt")]
    create_items_api(page, items)
    
    # 検索コンテナのロケーター（CSS Modulesを考慮し、部分一致を利用）
    search_container = page.locator("div[class*='sidebar-search']").first
    search_results = page.locator("div[class*='search-results']").first
    
    # 初期状態は非表示であることを確認
    expect(search_container).to_be_hidden()
    expect(search_results).to_be_hidden()
    
    # 検索ボタンをクリックして表示させる
    search_btn_js = """() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const searchBtn = btns.find(b => b.title === 'Search' || b.innerHTML.includes('M11.742'));
        if (searchBtn) searchBtn.click();
        return !!searchBtn;
    }"""
    assert page.evaluate(search_btn_js) is True
    
    # 表示されるのを待つ
    expect(search_container).to_be_visible()
    expect(search_results).to_be_visible()
    
    # 検索入力欄に文字を入力
    search_input = page.locator("input[class*='search-input']").first
    search_input.fill("test")
    
    # 入力されたことを確認
    expect(search_input).to_have_value("test")
    
    # クリアボタンをクリック
    clear_btn_js = """() => {
        const btn = document.querySelector("button[class*='search-clear-btn']");
        if (btn) btn.click();
        return !!btn;
    }"""
    assert page.evaluate(clear_btn_js) is True
    
    # 入力が空になったことを確認
    expect(search_input).to_have_value("")
    
    # 再度検索ボタンをクリックして非表示にする
    assert page.evaluate(search_btn_js) is True
    
    # 非表示になることを確認
    expect(search_container).to_be_hidden()
    expect(search_results).to_be_hidden()
