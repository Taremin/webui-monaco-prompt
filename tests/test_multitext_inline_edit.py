import pytest
import time
from playwright.sync_api import Page, expect

# ヘルパー関数: ブラウザのコンソールログを収集
def setup_console_log(page: Page):
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.type}: {msg.text}"))
    page.on("pageerror", lambda err: print(f"BROWSER ERROR: {err}"))

# ヘルパー関数: APIを使用してMultiTextノードを直接追加
def add_node_api_force(page: Page):
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
            return found
        time.sleep(2.0)
    raise Exception("MultiText node type not found")

def test_multitext_inline_edit(page: Page, comfyui_server, wait_for_comfyui):
    """インライン編集機能の動作確認（Renameボタン, ダブルクリック, Enter, Escape, blur）"""
    setup_console_log(page)
    
    # 1. ComfyUIを開く (fixtureを使用)
    page.goto(comfyui_server)
    wait_for_comfyui(page)
    
    # 2. MultiTextノードを追加
    add_node_api_force(page)
    
    # サイドバーのアイテムが表示されるまで待機（default.txt）
    item_selector = ".webui-monaco-prompt-multitext-tree-name"
    expect(page.locator(item_selector).first).to_be_visible(timeout=10000)
    expect(page.locator(item_selector).first).to_have_text("default.txt")

    # 3. 編集ボタンをクリックしてインライン編集に切り替わるか確認
    # アクションを表示させるためにホバー
    page.locator(".webui-monaco-prompt-multitext-tree-item").first.hover()
    # Renameボタン（editアイコン）をクリック
    edit_btn = page.locator(".webui-monaco-prompt-multitext-tree-action[title='Rename']")
    edit_btn.click()

    # inputが表示されていることを確認
    input_selector = ".webui-monaco-prompt-multitext-tree-name-input"
    expect(page.locator(input_selector)).to_be_visible()
    expect(page.locator(input_selector)).to_have_value("default.txt")

    # 4. 名前を変更してEnterで確定
    page.locator(input_selector).fill("renamed_via_enter.txt")
    page.keyboard.press("Enter")
    
    # inputが消え、新しい名前が表示されていることを確認
    expect(page.locator(input_selector)).not_to_be_visible()
    expect(page.locator(item_selector)).to_have_text("renamed_via_enter.txt")

    # 5. ダブルクリックで編集開始
    page.locator(item_selector).dblclick()
    expect(page.locator(input_selector)).to_be_visible()
    
    # 6. 変更してEscapeでキャンセル
    page.locator(input_selector).fill("canceled.txt")
    page.keyboard.press("Escape")
    
    # 名前が変わっていないことを確認
    expect(page.locator(input_selector)).not_to_be_visible()
    expect(page.locator(item_selector)).to_have_text("renamed_via_enter.txt")

    # 7. blurでの確定を確認
    page.locator(item_selector).dblclick()
    page.locator(input_selector).fill("renamed_via_blur.txt")
    # 他の場所をクリックしてフォーカスを外す（キャンバス領域など）
    page.mouse.click(10, 10)
    
    expect(page.locator(input_selector)).not_to_be_visible()
    expect(page.locator(item_selector)).to_have_text("renamed_via_blur.txt")

    print("Inline edit E2E test passed!")
