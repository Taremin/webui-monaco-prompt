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
        const findByPart = (root, part) => {
            if (root.className && typeof root.className === 'string' && root.className.includes(part)) return root;
            const children = Array.from(root.children || []);
            for (const child of children) {
                const found = findByPart(child, part);
                if (found) return found;
            }
            if (root.shadowRoot) {
                const found = findByPart(root.shadowRoot, part);
                if (found) return found;
            }
            return null;
        };

        const container = findByPart(document.body, "multitext-container");
        if (!container) return { error: "Container not found" };

        const node = window.app.graph._nodes[0];
        const canvas = window.app.canvas;
        if (!canvas || !canvas.canvas) return { error: "Canvas not found" };

        const pos = node.pos;
        const size = node.size;
        const scale = canvas.ds.scale;
        
        const canvasRect = canvas.canvas.getBoundingClientRect();
        const widgetCanvasPos = [pos[0] + 10, pos[1] + 36]; 
        const uiPos = canvas.convertCanvasToOffset(widgetCanvasPos);

        const expectedX = canvasRect.left + uiPos[0];
        const expectedY = canvasRect.top + uiPos[1];
        const expectedW = (size[0] - 20) * scale;
        const expectedH = (size[1] - 36) * scale;

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
    assert "error" not in layout_info, f"Layout verification failed: {layout_info.get('error')}"
    
    expected = layout_info['expected']
    actual = layout_info['actual']
    
    # 許容誤差範囲（数pxのマージンやボーダー、シャドウ等を考慮）
    epsilon = 30  
    
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
    sidebar = page.locator("[class*='multitext-sidebar']:not([class*='toolbar']):not([class*='search'])")
    initial_width = sidebar.bounding_box()["width"]

    page.evaluate("window.RESIZE_DEBUG = []")
    
    resizer = page.locator("[class*='multitext-resizer']")
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
    
    new_width = page.locator("[class*='multitext-sidebar']:not([class*='toolbar']):not([class*='search'])").bounding_box()["width"]
    print(f"DEBUG - Initial Width: {initial_width}, New Width: {new_width}")
    assert new_width > initial_width + 100, f"Sidebar should be resized, but got {new_width}"
    page.screenshot(path=os.path.join(screenshot_dir, "02_after_resize.png"))

    # ---------------------------------------------------------
    # 2.5 タブのはみ出し検証 (新規追加)
    # ---------------------------------------------------------
    page.evaluate("""() => {
        const node = window.app.graph._nodes[0];
        for (let i = 0; i < 20; i++) {
            const id = node.multitext_widget.addItemWithName('file', `overflow_test_${i}.txt`, undefined, `content ${i}`);
            node.multitext_widget.openFile(id);
        }
    }""")
    
    # ウィジェット要素が出現するのを待つ (難読化対応属性セレクタ)
    page.wait_for_selector("[class*='multitext-tabs-container']", state="attached", timeout=10000)
    
    # デバッグ: クラス名ダンプ
    all_classes = page.evaluate("""() => {
        const getClasses = (root) => {
            let res = [];
            if (root.className) {
                const c = root.className;
                res.push(typeof c === 'string' ? c : (c.baseVal || ""));
            }
            for (const child of root.children || []) res = res.concat(getClasses(child));
            if (root.shadowRoot) res = res.concat(getClasses(root.shadowRoot));
            return res;
        };
        return getClasses(document.body).filter(c => typeof c === 'string' && c.includes("webui-monaco-prompt"));
    }""")
    print(f"DEBUG - All monaco classes: {all_classes}")

    # CSS Modules 難読化対応のセレクタで検証
    tabs_info = page.evaluate("""() => {
        const findByPart = (root, part) => {
            if (root.className && typeof root.className === 'string' && root.className.includes(part)) return root;
            for (const child of Array.from(root.children || [])) {
                const found = findByPart(child, part);
                if (found) return found;
            }
            if (root.shadowRoot) {
                const found = findByPart(root.shadowRoot, part);
                if (found) return found;
            }
            return null;
        };

        const tabs = findByPart(document.body, "multitext-tabs-container");
        const container = findByPart(document.body, "multitext-container");
        if (!tabs || !container) return { error: "Elements not found", tabsFound: !!tabs, containerFound: !!container };
        
        return {
            tabsRight: tabs.getBoundingClientRect().right,
            containerRight: container.getBoundingClientRect().right,
            overflowX: window.getComputedStyle(tabs).overflowX,
            scrollWidth: tabs.scrollWidth,
            clientWidth: tabs.clientWidth
        };
    }""")
    print(f"DEBUG - Overflow Tabs Info: {tabs_info}")
    assert "error" not in tabs_info, f"Should find tab elements: {tabs_info.get('error')}"
    assert tabs_info["overflowX"] == "hidden", f"Tabs should be hidden overflow, but got {tabs_info['overflowX']}"
    assert tabs_info["tabsRight"] <= tabs_info["containerRight"] + 15, f"Tabs should be clipped within container: tabsRight({tabs_info['tabsRight']}) > containerRight({tabs_info['containerRight']})"
    
    # スクロール検証
    scroll_debug = page.evaluate("""() => {
        const findByPart = (root, part) => {
            if (root.className && typeof root.className === 'string' && root.className.includes(part) && !root.className.includes("toolbar")) return root;
            for (const child of Array.from(root.children || [])) {
                const found = findByPart(child, part);
                if (found) return found;
            }
            if (root.shadowRoot) {
                const found = findByPart(root.shadowRoot, part);
                if (found) return found;
            }
            return null;
        };
        const tabs = findByPart(document.body, "multitext-tabs-container");
        if (!tabs) return { error: "Tabs not found" };
        return {
            scrollLeft: tabs.scrollLeft,
            scrollWidth: tabs.scrollWidth,
            clientWidth: tabs.clientWidth,
            rect: tabs.getBoundingClientRect()
        };
    }""")
    print(f"DEBUG - Scroll Initial State: {scroll_debug}")
    assert "error" not in scroll_debug, "Tabs container for scroll should be found"
    # スクロール検証: 内容がコンテナ幅を超えていることを確認
    assert scroll_debug["scrollWidth"] > scroll_debug["clientWidth"], f"Content should be wider than container: {scroll_debug['scrollWidth']} > {scroll_debug['clientWidth']}"
    
    # 既に右端までスクロールされている可能性があるため、一度左へ戻してからスクロール検証
    page.evaluate("""() => {
        const findByPart = (root, part) => {
            if (root.className && typeof root.className === 'string' && root.className.includes(part) && !root.className.includes("toolbar")) return root;
            for (const child of Array.from(root.children || [])) {
                const found = findByPart(child, part);
                if (found) return found;
            }
            if (root.shadowRoot) {
                const found = findByPart(root.shadowRoot, part);
                if (found) return found;
            }
            return null;
        };
        const tabs = findByPart(document.body, "multitext-tabs-container");
        if (tabs) tabs.scrollLeft = 0;
    }""")
    page.wait_for_timeout(500)
    
    initial_scroll = 0
    page.hover("[class*='multitext-tabs-container']")
    # JSでスクロールさせる（overflow: hidden の場合、ホイールイベントだけではスクロールしない場合があるため）
    page.evaluate("""() => {
        const findByPart = (root, part) => {
            if (root.className && typeof root.className === 'string' && root.className.includes(part) && !root.className.includes("toolbar")) return root;
            for (const child of Array.from(root.children || [])) {
                const found = findByPart(child, part);
                if (found) return found;
            }
            if (root.shadowRoot) {
                const found = findByPart(root.shadowRoot, part);
                if (found) return found;
            }
            return null;
        };
        const tabs = findByPart(document.body, "multitext-tabs-container");
        if (tabs) tabs.scrollLeft += 100;
    }""")
    page.wait_for_timeout(500)
    
    new_scroll = page.evaluate("""() => {
        const findByPart = (root, part) => {
            if (root.className && typeof root.className === 'string' && root.className.includes(part) && !root.className.includes("toolbar")) return root;
            for (const child of Array.from(root.children || [])) {
                const found = findByPart(child, part);
                if (found) return found;
            }
            if (root.shadowRoot) {
                const found = findByPart(root.shadowRoot, part);
                if (found) return found;
            }
            return null;
        };
        const tabs = findByPart(document.body, "multitext-tabs-container");
        return tabs ? tabs.scrollLeft : -1;
    }""")
    print(f"DEBUG - Scroll check: Initial={initial_scroll}, New={new_scroll}")
    # 少なくとも 0 より大きくなっていることを確認
    assert new_scroll > 0, f"Should be able to scroll tabs via JS: {new_scroll}"
    page.screenshot(path=os.path.join(screenshot_dir, "02_5_tab_overflow_fix.png"))

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

    print("DEBUG - Starting D&D verification...")
    # Drag & Drop 実行
    drag_handle = page.locator("text=DraggedFile")
    drop_target = page.locator("text=TargetFolder")
    
    # JavaScript による Drag & Drop の実行 (Playwright の drag_to ハング回避)
    print("DEBUG - Executing D&D via JavaScript events...")
    page.evaluate("""({sourceSelector, targetSelector}) => {
        const source = document.evaluate(`//*[text()='${sourceSelector}']`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        const target = document.evaluate(`//*[text()='${targetSelector}']`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        
        if (!source || !target) return {ok: false, error: 'Elements not found'};

        const dataTransfer = new DataTransfer();
        
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
        
        return {ok: true};
    }""", {"sourceSelector": "DraggedFile", "targetSelector": "TargetFolder"})
    
    print("DEBUG - D&D Events dispatched, waiting for stabilization...")
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
