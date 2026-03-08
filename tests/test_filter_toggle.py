
import pytest
import os
import re
from playwright.sync_api import Page, expect

def test_json_filter_toggle_behavior(page: Page, comfyui_server, wait_for_comfyui):
    """ルールの無効化・有効化トグルが正常に動作し、一度無効化してもオンに戻せることを検証する"""
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1280, "height": 720})

    page.goto(comfyui_server)
    wait_for_comfyui(page)

    # 1. ノードの作成
    page.evaluate("""() => {
        app.graph.clear();
        const filter = LiteGraph.createNode("WebuiMonacoPromptJsonFilter");
        filter.pos = [200, 200];
        app.graph.add(filter);
        app.graph.change();
    }""")

    page.wait_for_selector("[class*='filter-container']", state="visible")
    
    # 2. ルール追加
    page.click("[class*='filter-add-btn']")
    page.wait_for_selector("[class*='filter-rule-row']", timeout=10000)
    
    # 無効トグルボタンを取得 (⏻)
    disable_btn = page.locator("[class*='filter-disable-btn']").first
    row = page.locator("[class*='filter-rule-row']").first
    input_el = page.locator("[class*='filter-input']").first

    # 3. 無効化テスト
    print("Disabling rule...")
    disable_btn.click()
    # 行に disabled クラスが付与され、半透明（opacity低下など）になることを期待
    expect(row).to_have_class(re.compile(r"disabled"))
    # ボタン自体に active クラスが付与される（赤いアイコンなど）
    expect(disable_btn).to_have_class(re.compile(r"active"))
    
    # 入力欄が操作不能（pointer-events: none）になっているか検証
    # Playwright の computed_style で確認
    pe = input_el.evaluate("el => getComputedStyle(el).pointerEvents")
    assert pe == "none", f"Input should be pointer-events: none, but got {pe}"

    # 4. 再有効化テスト (ここが今回の修正ポイント)
    print("Re-enabling rule...")
    # pointer-events: none が行全体にかかっていると、ここでのクリックが失敗するはず
    disable_btn.click()
    
    # 元に戻ったことを確認
    expect(row).not_to_have_class(re.compile(r"disabled"))
    expect(disable_btn).not_to_have_class(re.compile(r"active"))
    
    # 入力欄が操作可能に戻ったか確認
    pe_after = input_el.evaluate("el => getComputedStyle(el).pointerEvents")
    # 標準設定では auto または規定値
    assert pe_after != "none", f"Input should be interactive, but got {pe_after}"

    print("Success: Toggle is working bidirectional!")
