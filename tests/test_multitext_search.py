import pytest
import time
import uuid
from playwright.sync_api import Page, expect

def test_multitext_full_search(page: Page, comfyui_server, wait_for_comfyui):
    """(UI操作方式) 非アクティブファイルの内容も検索で見つかることを確認する"""
    url = comfyui_server
    page.goto(url)
    wait_for_comfyui(page)
    page.set_viewport_size({"width": 1920, "height": 1080})

    # 一意のタイトルを持つノードを作成 (隔離)
    node_title = f"MT-SEARCH-UI-{uuid.uuid4().hex[:6]}"
    print(f"Creating node with title: {node_title}")

    page.evaluate(f"""(title) => {{
        const app = window.app || window.ComfyApp;
        const node = LiteGraph.createNode("WebuiMonacoPromptMultiText");
        node.title = title;
        node.pos = [200, 200];
        node.setSize([800, 600]);
        app.graph.add(node);
    }}""", node_title)
    
    # ノードとエディタの準備待ち
    page.wait_for_function(f"""
        (title) => {{
            const app = window.app || window.ComfyApp;
            const node = app.graph && app.graph._nodes.find(n => n.title === title && n.multitext_widget);
            return node && node.multitext_widget && !!node.multitext_widget.editorInstance;
        }}
    """, arg=node_title, timeout=60000)

    print("Step 2: Setup files and content via JS")
    second_file = "search_test_ui.txt"
    page.evaluate(f"""(title) => {{
        const node = (window.app || window.ComfyApp).graph._nodes.find(n => n.title === title);
        const w = node.multitext_widget;
        
        // second file
        w.addItemWithName('file', '{second_file}');
        const f = w.data.tree.find(i => i.name === '{second_file}');
        w.openFile(f.id);
        w.editorInstance.monaco.setValue("secret search word ui");
        
        // defaultに戻す
        const d = w.data.tree.find(i => i.name === 'default.txt');
        w.openFile(d.id);
    }}""", node_title)
    time.sleep(1)

    print("Step 3: Perform Search via UI")
    # 検索タブを開く
    page.click("[title='Search']")
    
    # 検索入力欄が出るまで待つ
    page.wait_for_selector("[class*='search-input']", timeout=10000)
    search_input = page.locator("[class*='search-input']")
    search_input.fill("secret")
    search_input.press("Enter")
    
    # 検索結果が出るのを待つ
    page.wait_for_selector("[class*='search-result-item']", timeout=10000)
    
    print("Step 4: Click result and verify Switch")
    # 目的のファイルの結果をクリック
    target_row = page.locator("[class*='search-result-item']").filter(has_text=second_file).first
    target_row.click()
    
    page.wait_for_timeout(1000)
    
    # アクティブファイルが切り替わったかJSで確認
    active_name = page.evaluate(f"""(title) => {{
        const node = (window.app || window.ComfyApp).graph._nodes.find(n => n.title === title);
        const w = node.multitext_widget;
        const activeId = w.data.activeFileId;
        const file = w.data.tree.find(i => i.id === activeId) || 
                     w.data.tree.flatMap(i => i.children || []).find(i => i.id === activeId);
        return file ? file.name : null;
    }}""", node_title)
    
    assert active_name == second_file, f"Active file should be {second_file}, but got {active_name}"
    print("Verification successful: UI Search & Switch Passed.")
