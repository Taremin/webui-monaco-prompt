import json
import os
import time
from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        
        # 簡易サーバー起動などはすでに行われている前提
        page.goto("http://127.0.0.1:9876")
        page.wait_for_selector(".monaco-editor", state="attached", timeout=60000)
        
        info = page.evaluate("""() => {
            const node = window.app.graph && window.app.graph._nodes && window.app.graph._nodes[0];
            if(!node) return "No node";
            return node.widgets.map(w => ({
                name: w.name,
                type: w.type,
                hidden: w.hidden,
                computeSize: w.computeSize ? w.computeSize(100) : "no method",
                last_y: w.last_y
            }));
        }""")
        print(json.dumps(info, indent=2))
        browser.close()

if __name__ == "__main__":
    run()
