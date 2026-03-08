
import pytest
import os
from playwright.sync_api import Page, expect

def test_json_filter_input_selection_behavior(page: Page, comfyui_server, wait_for_comfyui):
    """入力要素内でのドラッグ操作によって文字列の範囲選択が正しく行われることを検証する"""
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1280, "height": 720})

    page.goto(comfyui_server)
    wait_for_comfyui(page)

    # 1. ルールを作成
    page.evaluate("""() => {
        try {
            app.graph.clear();
            const filter = LiteGraph.createNode("WebuiMonacoPromptJsonFilter");
            if (!filter) throw new Error("Could not create WebuiMonacoPromptJsonFilter node");
            filter.pos = [200, 200];
            app.graph.add(filter);
            app.graph.change();
        } catch (e) {
            console.error("ERROR in evaluate:", e.message, e.stack);
            throw e;
        }
    }""")

    page.wait_for_selector("[class*='filter-container']", state="visible", timeout=30000)
    page.click("[class*='filter-add-btn']")
    page.wait_for_timeout(500)
    
    # 2. テスト用文字列を入力
    input_el = page.locator("[class*='filter-input']").first
    input_el.fill("SELECT_THIS_TEXT")
    page.wait_for_timeout(500)
    
    # 3. 範囲選択をシミュレート (座標を計算してドラッグ)
    print("\n--- Verifying Text Selection via Dragging ---")
    box = input_el.bounding_box()
    
    # フォーカス
    input_el.click(position={"x": 5, "y": box["height"] / 2})
    
    # 文字列の座標を特定（等幅フォント想定でインデックスから逆算）
    # JS 側で実際の selectionStart をセットアップ
    page.evaluate("""() => {
        const inp = document.querySelector("[class*='filter-input']");
        inp.focus();
        // マウスダウンを開始位置でシミュレートするためのログ
        console.log("Starting drag simulation...");
    }""")

    start_x = box["x"] + 10
    start_y = box["y"] + box["height"] / 2
    end_x = box["x"] + box["width"] - 10
    
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.wait_for_timeout(200)
    
    # ドラッグ移動。steps を増やして滑らかに。
    page.mouse.move(end_x, start_y, steps=20)
    page.wait_for_timeout(300)
    
    page.mouse.up()
    page.wait_for_timeout(500)
    
    # 4. selectionStart / selectionEnd を確認
    selection_state = page.evaluate("""() => {
        const inp = document.querySelector("[class*='filter-input']");
        return {
            start: inp.selectionStart,
            end: inp.selectionEnd,
            value: inp.value,
            len: inp.selectionEnd - inp.selectionStart
        };
    }""")
    
    print(f"Selection State: {selection_state}")
    
    assert selection_state["len"] > 0, f"Selection should be non-empty. Current: {selection_state}"
    print("Verification passed: Selection is working!")
