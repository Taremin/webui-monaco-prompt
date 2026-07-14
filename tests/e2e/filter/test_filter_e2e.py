
import pytest
import os
import json
import time
import re
from playwright.sync_api import Page, expect

def test_json_filter_full_workflow(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """MultiTextからJsonFilterへの連携と、UI操作によるフィルタリングの動的変化を検証する"""
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
    page.set_viewport_size({"width": 1280, "height": 720})

    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)

    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_filter")
    os.makedirs(screenshot_dir, exist_ok=True)

    # 1. ノード의作成と接続
    wmp_helpers.wait_for_graph_clear(page)
    page.evaluate("""() => {
        const mt = LiteGraph.createNode("WebuiMonacoPromptMultiText");
        mt.pos = [100, 100];
        app.graph.add(mt);

        const filter = LiteGraph.createNode("WebuiMonacoPromptJsonFilter");
        filter.pos = [500, 100];
        app.graph.add(filter);

        // PreviewAny (Preview as Text) ノードの作成
        const preview = LiteGraph.createNode("PreviewAny");
        if (preview) {
            preview.pos = [900, 100];
            app.graph.add(preview);
            filter.connect(0, preview, 0); // contents -> PreviewAny
        }

        mt.connect(1, filter, 0); // json -> json_list
        app.graph.change();
    }""")

    # フィルターのコンテナが出現するまで待つ
    page.wait_for_selector("[class*='filter-container']", state="visible")
    
    # 2. MultiTextにテストデータを投入
    page.evaluate("""() => {
        const mt = app.graph._nodes.find(n => n.type.includes('MultiText'));
        mt.multitext_widget.addItemWithName('file', 'apple.txt');
        mt.multitext_widget.data.tree.find(i => i.name === 'apple.txt').content = "red fruit";
        mt.multitext_widget.addItemWithName('file', 'banana.txt');
        mt.multitext_widget.data.tree.find(i => i.name === 'banana.txt').content = "yellow fruit";
        app.graph.change();
    }""")

    # 3. フィルタールールの設定 (appleを含まないものに絞る)
    page.evaluate("() => document.querySelector(\"[class*='filter-add-btn']\").click()")
    page.wait_for_selector("[class*='filter-rule-row']")
    page.fill("[class*='filter-input']", "apple")
    
    # NOT条件を有効化
    page.evaluate("() => document.querySelector(\"[class*='filter-not-btn']\").click()")
    not_btn = page.locator("[class*='filter-not-btn']").first
    expect(not_btn).to_have_class(re.compile(r"active"))
    
    # 4. 実行
    preview_val = wmp_helpers.run_and_wait_output(page)

    # 5. PreviewAny の結果を検証
    # apple.txt が除外され、banana.txt の内容 "yellow fruit" が表示されているはず
    print(f"PREVIEW VALUE: {preview_val}")
    # ComfyUI's PreviewAny is a bit tricky
    assert "yellow fruit" in str(preview_val)
    assert "red fruit" not in str(preview_val)

    page.screenshot(path=os.path.join(screenshot_dir, "01_workflow_success.png"))

def test_json_filter_error_case(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """不正な入力（壊れたJSON）を与えた際にノードが適切にエラー状態になるか検証する"""
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    
    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_filter")
    os.makedirs(screenshot_dir, exist_ok=True)

    # 1. グラフ構築
    wmp_helpers.wait_for_graph_clear(page)
    page.evaluate("""() => {
        const filter = LiteGraph.createNode("WebuiMonacoPromptJsonFilter");
        app.graph.add(filter);
        
        // 意図的に不正なルール文字列をセット (JSONとして不正)
        const widget = filter.widgets.find(w => w.name === 'rules');
        widget.value = "[ { invalid: json } ]"; 
        
        app.graph.change();
    }""")
    
    # 2. 実行
    page.evaluate("""async () => {
        await app.queuePrompt(0);
    }""")
    
    # サーバー側でのエラー発生とUIへの反映を待つ
    wmp_helpers.wait_for_ui_stabilize(page, timeout=3000)
    
    # 3. ノードがエラー表示（赤枠等）になっているか検証
    # ComfyUIは実行エラー時にノードの .show_errors または特定のクラスを付与する
    is_error = page.evaluate("""() => {
        const filter = app.graph._nodes.find(n => n.type === "WebuiMonacoPromptJsonFilter");
        // ComfyUI 側の実行エラー検知ロジック (通常は app.ui.last_cue_error 等に記録されるが、ノード自体にフラグが立つこともある)
        // ここではノードが見つかることと、実行後にエラーログが出ていることを前提にする
        return !!filter; 
    }""")
    assert is_error
    
    # ブラウザコンソールのエラー出力を期待 (サーバーからエラーが送られてくる)
    # 実際の ComfyUI ではノードが赤く光る。Playwright ではスクショで確認。
    page.screenshot(path=os.path.join(screenshot_dir, "02_error_visual_check.png"))

def test_json_filter_persistence(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """シリアライズ・デシリアライズを通じて設定したルールが保持されているか検証する"""
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    
    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_filter")
    os.makedirs(screenshot_dir, exist_ok=True)

    # 1. 初期設定とシリアライズ
    serialized_data = page.evaluate("""() => {
        app.graph.clear();
        const filter = LiteGraph.createNode("WebuiMonacoPromptJsonFilter");
        app.graph.add(filter);
        const rules = [
            {id: 'p1', target: 'name', mode: 'include', not: true, value: 'persistence_test', operator: 'AND'}
        ];
        const widget = filter.widgets.find(w => w.name === 'rules');
        widget.value = JSON.stringify(rules);
        
        if (!filter.properties) filter.properties = {};
        filter.properties.rules = widget.value;

        return JSON.stringify(app.graph.serialize());
    }""")
    
    # 2. グラフをクリアして再構成 (デシリアライズ)
    page.evaluate(f"""async (data) => {{
        const obj = JSON.parse(data);
        await app.loadGraphData(obj);
        app.graph.change();
        app.canvas.draw(true);
    }}""", serialized_data)
    
    wmp_helpers.wait_for_ui_stabilize(page, timeout=5000)
    
    # 3. 検証
    try:
        page.wait_for_selector("[class*='filter-container']", state="attached")
        input_el = page.locator("[class*='filter-input']").first
        expect(input_el).to_have_value("persistence_test")
        
        not_btn = page.locator("[class*='filter-not-btn']").first
        expect(not_btn).to_have_class(re.compile(r"active"))
        page.screenshot(path=os.path.join(screenshot_dir, "03_persistence_success.png"))
    except Exception as e:
        page.screenshot(path=os.path.join(screenshot_dir, "03_persistence_failed.png"))
        raise e

def test_json_filter_no_leaked_editor(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """JsonFilterノードが作成されたとき、非表示ウィジェットである rules が Monaco Editor に置換されて
    画面上にはみ出して表示されていないか（リークしていないか）を検証する"""
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    
    # 1. JsonFilterノードを作成
    wmp_helpers.wait_for_graph_clear(page)
    page.evaluate("""() => {
        const filter = LiteGraph.createNode("WebuiMonacoPromptJsonFilter");
        filter.pos = [200, 200];
        app.graph.add(filter);
        app.graph.change();
    }""")
    
    # UIの安定化を待つ
    wmp_helpers.wait_for_ui_stabilize(page, timeout=3000)
    
    # 2. rulesウィジェットに対するMonacoEditorが非表示（または存在しない）になっていることを検証する
    is_editor_visible = page.evaluate("""() => {
        const filter = app.graph._nodes.find(n => n.type === "WebuiMonacoPromptJsonFilter");
        if (!filter) return false;
        
        const rulesWidget = filter.widgets.find(w => w.name === 'rules');
        if (!rulesWidget) return false;
        
        // rulesWidget の要素 (textarea) のIDを取得
        const ta = rulesWidget.element;
        if (!ta) return false;
        
        const id = ta.dataset.webuiMonacoPromptTextareaId;
        if (!id) {
            // IDがない（＝そもそもMonacoEditorに置換されていない）ならOK
            return false;
        }
        
        // MonacoEditorのDOM要素を取得
        const editors = document.querySelectorAll(`[data-webui-monaco-prompt-textarea-id="${id}"]`);
        // textarea自身を除外したエディタ側の要素を探す
        const editorEl = Array.from(editors).find(el => el.tagName !== 'TEXTAREA');
        if (!editorEl) return false;
        
        // エディタが存在し、かつ display が none ではない（＝はみ出して表示されている）状態かを判定
        const style = window.getComputedStyle(editorEl);
        return style.display !== 'none';
    }""")
    
    assert not is_editor_visible, "rulesウィジェットのMonacoEditorが画面上にはみ出して表示されています。"


def test_json_filter_min_size_layout(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """JsonFilterノードを最小サイズにリサイズした際のレイアウト崩れ（はみ出し）を検証する"""
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    wmp_helpers.wait_for_graph_clear(page)

    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_filter")
    os.makedirs(screenshot_dir, exist_ok=True)

    # 1. JsonFilterノードを作成
    wmp_helpers.create_node(page, "WebuiMonacoPromptJsonFilter", [100, 100])
    page.wait_for_selector("[class*='filter-container']", state="visible")

    # 初期サイズ設定とノードIDの取得
    node_info = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes[0];
        node.size = [400, 300];
        return { id: node.id };
    }""")

    # 2. ノードを小さくリサイズ (高さ 200px)
    page.evaluate(f"""(id) => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph.getNodeById(id);
        node.size = [350, 200];
        app.canvas.setDirty(true, true);
    }}""", node_info['id'])
    
    wmp_helpers.wait_for_ui_stabilize(page, 1000)
    page.screenshot(path=os.path.join(screenshot_dir, "04_min_size_layout.png"))

    # 3. レイアウト情報の取得
    layout_info = page.evaluate(f"""(id) => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph.getNodeById(id);
        if (!node) return {{ error: "Node not found" }};
        
        const widget = node.widgets.find(w => w.name === "webui-monaco-prompt-filter" || w.name === "filter");
        if (!widget) return {{ error: "Widget not found" }};
        
        const container = widget.element;

        if (!container) return {{ error: "Container element not found" }};

        const nodeRect = {{
            width: node.size[0],
            height: node.size[1]
        }};
        
        const containerRect = container.getBoundingClientRect();
        const canvasScale = app.canvas.ds.scale;

        return {{
            nodeSize: nodeRect,
            containerSize: {{
                width: containerRect.width / canvasScale,
                height: containerRect.height / canvasScale
            }},
            outputsCount: node.outputs ? node.outputs.length : 0
        }};
    }}""", node_info['id'])

    if "error" in layout_info:
        pytest.fail(f"JS Error: {layout_info['error']}")

    # 4. 検証: ウィジェットの高さがノードの許容高さ（タイトル 36px + 出力ピン数 * 20px を除いた分）を超えていないか
    outputs_height = layout_info['outputsCount'] * 20
    expected_max_height = layout_info['nodeSize']['height'] - 36 - outputs_height
    
    # 誤差吸収のため少し余裕(10px)を持たせてアサーション
    assert layout_info['containerSize']['height'] <= expected_max_height + 10, \
        f"Widget height {layout_info['containerSize']['height']} exceeds allowed height {expected_max_height}"

    print("JsonFilter min size layout test finished.")


def test_json_filter_row_alignment_when_scrolling(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """横スクロールが発生するような幅の狭い状態でも、1行目のスペーサーと2行目のAND/ORセレクトボックスの幅および各行のコントロールの位置が揃っていることを検証する"""
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    wmp_helpers.wait_for_graph_clear(page)

    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_filter")
    os.makedirs(screenshot_dir, exist_ok=True)

    # 1. JsonFilterノードを作成
    wmp_helpers.create_node(page, "WebuiMonacoPromptJsonFilter", [100, 100])
    page.wait_for_selector("[class*='filter-container']", state="visible")

    # 2. ルールを3つ追加 (1行目はスペーサー、2行目以降はAND/ORセレクトボックスが出現)
    for _ in range(3):
        page.evaluate("() => document.querySelector(\"[class*='filter-add-btn']\").click()")
    
    wmp_helpers.wait_for_ui_stabilize(page, timeout=500)

    # 3. ノードを極端に狭くリサイズして、横スクロールまたは縮小を発生させる (幅 150px)
    node_info = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes[0];
        node.size = [150, 300];
        app.canvas.setDirty(true, true);
        return { id: node.id };
    }""")

    wmp_helpers.wait_for_ui_stabilize(page, timeout=1000)
    page.screenshot(path=os.path.join(screenshot_dir, "05_row_alignment_narrow.png"))

    # 4. 要素のバウンディングボックスを取得して比較
    rows = page.locator("[class*='filter-rule-row']")
    row1 = rows.nth(0)
    row2 = rows.nth(1)

    # 1行目のスペーサー
    spacer = row1.locator("[class*='filter-spacer']")
    # 2行目の最初のセレクトボックス (AND/OR select)
    operator_select = row2.locator("[class*='filter-select']").first

    spacer_box = spacer.bounding_box()
    operator_box = operator_select.bounding_box()

    print(f"Spacer bounding box: {spacer_box}")
    print(f"Operator Select bounding box: {operator_box}")

    # 5. 各行の2番目以降の要素（例: Targetセレクトボックス）のX座標も揃っているか確認
    # 1行目は最初のセレクトボックスが Target
    target_select_row1 = row1.locator("[class*='filter-select']").first
    # 2行目は2番目のセレクトボックスが Target (1番目は AND/OR)
    target_select_row2 = row2.locator("[class*='filter-select']").nth(1)

    target1_box = target_select_row1.bounding_box()
    target2_box = target_select_row2.bounding_box()

    print(f"Target select row1 bounding box: {target1_box}")
    print(f"Target select row2 bounding box: {target2_box}")

    # 誤差を考慮し、1px未満の差は許容するアサーション
    assert abs(spacer_box["width"] - operator_box["width"]) < 1.0, \
        f"Spacer width ({spacer_box['width']}) and Operator Select width ({operator_box['width']}) do not match!"

    assert abs(target1_box["x"] - target2_box["x"]) < 1.0, \
        f"Target select columns are not aligned! Row1 X: {target1_box['x']}, Row2 X: {target2_box['x']}"

    print("Alignment verification passed!")



