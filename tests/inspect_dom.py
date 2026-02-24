import json
from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto("http://127.0.0.1:9876")
        page.wait_for_selector(".monaco-editor", state="attached", timeout=60000)
        
        info = page.evaluate("""() => {
            const container = document.querySelector(".webui-monaco-prompt-multitext-container");
            const wrapper = container.parentElement;
            return {
                containerNodeName: container.nodeName,
                containerStyle: window.getComputedStyle(container).cssText,
                wrapperStyle: window.getComputedStyle(wrapper).cssText,
                containerBBox: container.getBoundingClientRect(),
                wrapperBBox: wrapper.getBoundingClientRect()
            };
        }""")
        with open("dom_info.json", "w") as f:
            json.dump(info, f, indent=2)
        print("DOM info saved.")
        browser.close()

if __name__ == "__main__":
    run()
