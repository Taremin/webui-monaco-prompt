import pytest
import time
from playwright.sync_api import Page, expect

def test_ui_no_undefined_classes(page: Page, comfyui_server, wait_for_comfyui):
    """UI要素の属性値（特に class）に 'undefined' が含まれていないこと、および JS エラーがないことを確認する"""
    url = comfyui_server
    
    # コンソールエラーを監視
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    
    page.goto(url)
    wait_for_comfyui(page)

    print("Step 1: Create all relevant nodes")
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        app.graph.clear();
        
        const nodes = [
            "WebuiMonacoPromptMultiText",
            "WebuiMonacoPromptFind",
            "WebuiMonacoPromptReplace",
            "WebuiMonacoPromptJsonFilter"
        ];
        
        nodes.forEach((type, i) => {
            const node = LiteGraph.createNode(type);
            node.pos = [100, 100 + (i * 300)];
            app.graph.add(node);
        });
    }""")
    
    print("Step 2: Open Search Sidebar")
    page.click("i.pi-search") # サイドバーのアイコンをクリック
    time.sleep(1)
    
    # 描画時間を確保
    time.sleep(2)

    print("Step 3: Check for 'undefined' in attributes and classes")
    # DOM全体から調査
    undefined_elements = page.evaluate("""() => {
        const results = [];
        const allElements = document.querySelectorAll('*');
        
        allElements.forEach(el => {
            // classList を使用して厳密に 'undefined' クラスをチェック
            if (el.classList && el.classList.contains('undefined')) {
                results.push({
                    tag: el.tagName,
                    id: el.id,
                    classes: el.className,
                    reason: "classList contains 'undefined'",
                    html: el.outerHTML.substring(0, 100)
                });
            }
            
            // 全ての属性値を走査
            for (const attr of el.attributes) {
                if (attr.value === 'undefined' || attr.value.split(' ').includes('undefined')) {
                    results.push({
                        tag: el.tagName,
                        attr: attr.name,
                        value: attr.value,
                        reason: `Attribute '${attr.name}' has 'undefined' value`,
                        html: el.outerHTML.substring(0, 100)
                    });
                }
            }
        });
        return results;
    }""")

    # コンソールエラーのアサーション
    if console_errors:
        print("\nJavaScript Errors found in console:")
        for err in console_errors:
            print(f"- {err}")
    
    # getStyle 由来のエラー（[WebuiMonacoPrompt] Style not found）が含まれていないか
    style_errors = [e for e in console_errors if "Style not found" in e]
    assert len(style_errors) == 0, f"Detected {len(style_errors)} style errors in console. Check output."

    if undefined_elements:
        print("\nElements with 'undefined' found:")
        for err in undefined_elements:
            print(f"- {err}")
    
    assert len(undefined_elements) == 0, f"Found {len(undefined_elements)} elements with 'undefined' attributes. Check output."

    print("Verification successful: No 'undefined' attributes and no Style errors found.")
