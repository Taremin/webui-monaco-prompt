import pytest
import os
import json
from playwright.sync_api import Page, expect

def test_multitext_layout_and_features(page: Page, comfyui_server, wait_for_comfyui):
    """レイアウト、リサイズ、D&D機能を包括的に検証する"""
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1280, "height": 720})
    
    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_features")
    os.makedirs(screenshot_dir, exist_ok=True)

    page.on("console", lambda msg: print(f"BROWSER: {msg.text}"))
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    # ワークフローをクリア
    page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
    page.wait_for_function("() => app.graph && app.graph._nodes.length === 0", timeout=10000)

    print("DEBUG - Starting browser automation...")
    page.evaluate("console.log('BROWSER: HELLO - Console redirection check')")
    
    # MultiTextノードを作成
    node_type = page.evaluate("""() => {
        const types = Object.keys(window.LiteGraph.registered_node_types);
        return types.find(t => t.includes('WebuiMonacoPromptMultiText'));
    }""")
    assert node_type, "MultiText node type should be registered"
    
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const node = window.LiteGraph.createNode("{node_type}");
        node.pos = [100, 100];
        node.size = [800, 600];
        app.graph.add(node);
    }}""")
    
    # エディタの存在確認（可視性判定が厳しいため attached で待つ）
    page.wait_for_selector(".monaco-editor", state="attached")
    
    # ---------------------------------------------------------
    # 1. レイアウト検証（スクリーン座標・はみ出しチェック）
    # ---------------------------------------------------------
    layout_info = page.evaluate("""() => {
        const container = document.querySelector(".webui-monaco-prompt-multitext-container");
        const node = window.app.graph._nodes[0];
        const canvas = window.app.canvas;

        // LiteGraph内部のノード座標(pos)とサイズ(size)
        // pos[1] は通常、タイトルバー直下（ノードボディの開始行）を指します。
        const pos = node.pos;
        const size = node.size;
        
        // LiteGraphのキャンバスパン・ズーム情報
        const scale = canvas.ds.scale;
        const offset = canvas.ds.offset;
        
        // キャンバスDOM自体のスクリーン上の絶対位置
        const canvasRect = canvas.canvas.getBoundingClientRect();
                // Nodeボディのウィジェットエリア開始位置の想定スクリーン絶対座標の算出
            // pos はノードの開始座標。ウィジェットはタイトル(約30px) + マージン(約6px)下に配置され、左マージンは10px。
            // LiteGraphの公式APIを利用してキャンバス内座標からスクリーン座標上のオフセットへ変換
            const widgetCanvasPos = [pos[0] + 10, pos[1] + 36]; 
            const uiPos = canvas.convertCanvasToOffset(widgetCanvasPos);
    
            // 変換結果にキャンバスDOMの絶対位置を加算
            const expectedX = canvasRect.left + uiPos[0];
            const expectedY = canvasRect.top + uiPos[1];
            const expectedW = (size[0] - 20) * scale;
            const expectedH = (size[1] - 36) * scale;

        // 実際のUIコンテナのスクリーン絶対座標
        const containerRect = container.getBoundingClientRect();
        
        return {
            "expected": {
                "left": expectedX,
                "top": expectedY,
                "right": expectedX + expectedW,
                "bottom": expectedY + expectedH,
                "width": expectedW,
                "height": expectedH
            },
            "actual": {
                "left": containerRect.left,
                "top": containerRect.top,
                "right": containerRect.right,
                "bottom": containerRect.bottom,
                "width": containerRect.width,
                "height": containerRect.height
            }
        };
    }""")
    print(f"DEBUG - Layout Dump: {json.dumps(layout_info, indent=2)}")
    
    expected = layout_info['expected']
    actual = layout_info['actual']
    
    # 許容誤差範囲（数pxのマージンやボーダー、シャドウ等を考慮）
    epsilon = 20  
    
    # [アサーション1] ウィジェットの左上位置がノードボディの左上（タイトルバー直下）にほぼ一致していること
    assert abs(actual['left'] - expected['left']) < epsilon, f"Widget left {actual['left']} does not match node left {expected['left']}"
    assert abs(actual['top'] - expected['top']) < epsilon, f"Widget top {actual['top']} does not match node top {expected['top']}"

    # [アサーション2] ウィジェットがノード領域を下や右へ大きくはみ出していないこと
    # (ノード右下座標 に対してウィジェット右下座標が epsilon 以内に収まる)
    assert actual['right'] <= expected['right'] + epsilon, f"Widget right {actual['right']} exceeds node right {expected['right']}"
    assert actual['bottom'] <= expected['bottom'] + epsilon, f"Widget bottom {actual['bottom']} exceeds node bottom {expected['bottom']}"
    page.screenshot(path=os.path.join(screenshot_dir, "01_layout_check.png"))

    # ---------------------------------------------------------
    # 2. リサイズ検証
    # ---------------------------------------------------------
    sidebar = page.locator(".webui-monaco-prompt-multitext-sidebar")
    initial_width = sidebar.bounding_box()["width"]

    page.evaluate("window.RESIZE_DEBUG = []")
    
    resizer = page.locator(".webui-monaco-prompt-multitext-resizer")
    resizer_box = resizer.bounding_box()
    print(f"DEBUG - Resizer Bounding Box: {resizer_box}")
    
    start_x = resizer_box["x"] + resizer_box["width"] / 2
    start_y = resizer_box["y"] + resizer_box["height"] / 2
    
    # イベント泥棒（最前面要素）の特定
    hit_element = page.evaluate(f"""() => {{
        const el = document.elementFromPoint({start_x}, {start_y});
        if (!el) return 'null';
        const style = window.getComputedStyle(el);
        return el.tagName + (el.className ? '.' + el.className.split(' ').join('.') : '') + ' (z-index: ' + style.zIndex + ', pointer-events: ' + style.pointerEvents + ')';
    }}""")
    print(f"DEBUG - Element at resizer coords: {hit_element}")

    # ハンドルの中央を掴んで 150px 右へ
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(start_x + 150, start_y)
    page.mouse.up()

    page.wait_for_timeout(1000)

    debug_logs = page.evaluate("window.RESIZE_DEBUG")
    print(f"DEBUG - Browser Resize Logs: {json.dumps(debug_logs, indent=2)}")
    
    new_width = sidebar.bounding_box()["width"]
    print(f"DEBUG - Initial Width: {initial_width}, New Width: {new_width}")
    assert new_width > initial_width + 100, f"Sidebar should be resized, but got {new_width}"
    page.screenshot(path=os.path.join(screenshot_dir, "02_after_resize.png"))

    # ---------------------------------------------------------
    # 3. D&D検証
    # ---------------------------------------------------------
    page.evaluate("""() => {
        const node = window.app.graph._nodes[0];
        node.multitext_widget.addItemWithName('folder', 'TargetFolder');
        node.multitext_widget.addItemWithName('file', 'DraggedFile');
    }""")
    
    page.wait_for_selector("text=DraggedFile")
    page.wait_for_selector("text=TargetFolder")

    # Drag & Drop 実行
    drag_handle = page.locator("text=DraggedFile")
    drop_target = page.locator("text=TargetFolder")
    
    # playwright の drag_to を使用
    drag_handle.drag_to(drop_target)
    page.wait_for_timeout(1000)
    
    is_moved = page.evaluate("""() => {
        const node = window.app.graph._nodes[0];
        const folder = node.multitext_widget.data.tree.find(i => i.name === 'TargetFolder');
        return folder && folder.children && folder.children.some(i => i.name === 'DraggedFile');
    }""")
    assert is_moved, "File should be moved into TargetFolder"
    page.screenshot(path=os.path.join(screenshot_dir, "03_after_dnd.png"))

    # ---------------------------------------------------------
    # 4. 永続性検証
    # ---------------------------------------------------------
    # ComfyUI のオートセーブが完了するまで待機と強制トリガー
    page.evaluate("""() => {
        if (window.comfyAPI && window.comfyAPI.api && window.comfyAPI.api.api) {
            window.comfyAPI.api.api.dispatchEvent(new CustomEvent('graphChanged'));
        } else if (window.api) {
            window.api.dispatchEvent(new CustomEvent('graphChanged'));
        } else {
            app.graph.change();
        }
    }""")
    page.wait_for_timeout(2000)

    page.reload()
    wait_for_comfyui(page)

    # リロード後のリストアには時間がかかる可能性があるため、ある程度リトライする
    is_persisted = False
    for i in range(10):
        is_persisted = page.evaluate("""() => {
            const node = window.app.graph && window.app.graph._nodes && window.app.graph._nodes.find(n => n.type && n.type.includes('MultiText'));
            if (!node || !node.multitext_widget || !node.multitext_widget.data || !node.multitext_widget.data.tree) return false;
            const folder = node.multitext_widget.data.tree.find(i => i.name === 'TargetFolder');
            return folder && folder.children && folder.children.some(i => i.name === 'DraggedFile');
        }""")
        if is_persisted:
            break
        page.wait_for_timeout(1000)

    assert is_persisted, "Data should be persisted after reload"
    page.screenshot(path=os.path.join(screenshot_dir, "04_after_reload.png"))
