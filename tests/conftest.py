import os
import sys
import json
import subprocess
import time
import socket
import pytest
from pathlib import Path

# テストディレクトリと設定ファイルのパス
TESTS_DIR = Path(__file__).parent
SETTINGS_PATH = TESTS_DIR / "test_settings.json"

# グローバルなタイムアウト定数
DEFAULT_TEST_TIMEOUT = 10000  # 10秒
UI_RENDER_TIMEOUT = 10000     # UI要素の描画やアニメーション待ち
NODE_LOAD_TIMEOUT = 30000     # ノードの登録・読み込み待ち (これだけは少し長めを許容)

@pytest.fixture(autouse=True)
def setup_playwright_timeout(page):
    """すべてのテストでPlaywrightのデフォルトタイムアウトを自動設定する"""
    page.set_default_timeout(DEFAULT_TEST_TIMEOUT)

@pytest.fixture
def wmp_helpers():
    class Helpers:
        @staticmethod
        def load_comfyui(page, comfyui_server, wait_for_comfyui):
            """ComfyUIを開き、初期ロードが完了するまで待機する"""
            page.goto(comfyui_server)
            wait_for_comfyui(page)

        @staticmethod
        def wait_for_editor(page):
            # Editorの初期化は重い環境だと時間がかかるため、必要に応じて専用のタイムアウトを使用
            try:
                page.wait_for_selector("prompt-editor", state="attached", timeout=NODE_LOAD_TIMEOUT)
            except:
                pass
            page.wait_for_selector(".monaco-editor", state="visible", timeout=NODE_LOAD_TIMEOUT)
            
        @staticmethod
        def wait_for_graph_clear(page):
            page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
            page.wait_for_function("() => app.graph && app.graph._nodes.length === 0", timeout=UI_RENDER_TIMEOUT)

        @staticmethod
        def wait_for_ui_stabilize(page, timeout=1000):
            page.wait_for_timeout(timeout)

        @staticmethod
        def create_node(page, type_name, pos=(100, 100)):
            """JS経由でノードを作成してグラフに追加する"""
            return page.evaluate(f"""(args) => {{
                const node = LiteGraph.createNode(args.type);
                node.pos = args.pos;
                app.graph.add(node);
                if (app.canvas) app.canvas.centerOnNode(node);
                return node.id;
            }}""", {"type": type_name, "pos": pos})

        @staticmethod
        def run_and_wait_output(page, preview_node_type="PreviewAny"):
            """プロンプトを実行し、指定したタイプのノードに出力が現れるまで待機する"""
            page.evaluate("app.queuePrompt(0)")
            page.wait_for_function(f"""() => {{
                const preview = app.graph._nodes.find(n => n.type === "{preview_node_type}");
                if (!preview || !preview.widgets || !preview.widgets[0]) return false;
                const val = preview.widgets[0].value;
                return val && String(val).length > 0;
            }}""", timeout=NODE_LOAD_TIMEOUT)
            
            return page.evaluate(f"""() => {{
                const preview = app.graph._nodes.find(n => n.type === "{preview_node_type}");
                return preview.widgets[0].value;
            }}""")

        @staticmethod
        def open_settings(page):
            """ComfyUIの設定ダイアログを開く"""
            # Close any existing legacy modals first
            page.evaluate("""() => {
                const modals = document.querySelectorAll(".comfy-modal");
                for (const m of modals) {
                    if (m.style.display !== 'none') {
                        const btn = m.querySelector("button");
                        if (btn) btn.click();
                    }
                }
            }""")

            # Try sidebar button click (V2)
            try:
                # Wait for sidebar button to be present and click it
                btn = page.locator('button[aria-label^="Settings"]').first
                btn.wait_for(state="visible", timeout=2000)
                btn.click()
            except:
                # Try keyboard shortcut (Ctrl + ,)
                page.keyboard.press("Control+,")
            
            # Wait for V2 settings dialog (p-dialog) specifically
            try:
                page.wait_for_selector(".p-dialog:visible", timeout=10000)
            except:
                # Last resort fallback to API but try to force V2
                page.evaluate("""() => {
                    const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
                    const app = getApp();
                    if (app && app.ui && app.ui.settings) app.ui.settings.show();
                }""")
                page.wait_for_selector(".p-dialog:visible, .comfy-modal:visible", timeout=UI_RENDER_TIMEOUT)

        @staticmethod
        def switch_settings_category(page, category_name="WebuiMonacoPrompt"):
            """V2設定ダイアログでカテゴリを切り替える"""
            page.evaluate(f"""(name) => {{
                const items = document.querySelectorAll('li[aria-label], .p-listbox-item');
                for (const item of items) {{
                    if (item.getAttribute('aria-label') === name || item.textContent.trim() === name) {{
                        item.click();
                        return true;
                    }}
                }}
                return false;
            }}""", category_name)
            page.wait_for_timeout(500)

        @staticmethod
        def set_comfy_setting(page, setting_id, value):
            """ComfyUIの設定値をセットし、localStorageと同期させる"""
            page.evaluate(f"""(args) => {{
                const k = args.id;
                const v = args.val;
                const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
                const app = getApp();

                // 1. localStorage (V2用の Comfy.Settings 重層化構造)
                try {{
                    const raw = localStorage.getItem("Comfy.Settings") || "{{}}";
                    const settings = JSON.parse(raw);
                    settings[k] = v;
                    localStorage.setItem("Comfy.Settings", JSON.stringify(settings));
                    localStorage.setItem("Comfy.Settings." + k, JSON.stringify(v));
                }} catch(e) {{ console.error("LS sync failed", e); }}

                // 2. App 内部状態同期
                if (app && app.ui && app.ui.settings) {{
                    app.ui.settings.setSettingValue(k, v);
                    if (app.ui.settings.values) app.ui.settings.values[k] = v;
                    // save() を手動で呼ぶと多重リクエストになりサーバーエラーを引き起こすため削除
                }}
                
                // 通知イベント
                window.dispatchEvent(new CustomEvent("comfy-settings-changed", {{ detail: {{ id: k, value: v }} }}));
            }}""", {"id": setting_id, "val": value})
            page.wait_for_timeout(500)

        @staticmethod
        def get_comfy_setting(page, setting_id):
            """ComfyUIの設定値を取得する"""
            return page.evaluate(f"""(id) => {{
                const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
                const app = getApp();
                if (app && app.ui && app.ui.settings) {{
                    return app.ui.settings.getSettingValue(id);
                }}
                const raw = localStorage.getItem("Comfy.Settings") || "{{}}";
                return JSON.parse(raw)[id];
            }}""", setting_id)

        @staticmethod
        def open_preset_dialog(page):
            """Manage Presets ダイアログを開く"""
            clicked = page.evaluate("""() => {
                // V1 style
                let btn = document.querySelector("#webui-monaco-manage-btn button");
                if (btn) { btn.click(); return true; }
                
                // V2 style (Search by button text)
                const allBtns = Array.from(document.querySelectorAll('button'));
                const openBtn = allBtns.find(b => b.textContent === "Open Dialog" || b.textContent.includes("Manage Language Presets"));
                if (openBtn) { openBtn.click(); return true; }

                return false;
            }""")
            
            if not clicked:
                try:
                    # 最終手段: Playwright locator (timeout を短くして失敗を早く検知)
                    page.get_by_role("button", name="Open Dialog").first.click(timeout=3000)
                    clicked = True
                except Exception as e:
                    print(f"Warning: Failed to click Open Dialog button: {e}")
                    
                    # API 経由で直接ダイアログを開くフォールバック
                    print("Falling back to API to open preset dialog...")
                    page.evaluate("""() => {
                        if (window.WebuiMonacoPrompt && window.WebuiMonacoPrompt.getPresetDialog) {
                            window.WebuiMonacoPrompt.getPresetDialog().show();
                        }
                    }""")
                    clicked = True
            
            if clicked:
                page.wait_for_selector("#webui-monaco-preset-dialog", state="visible", timeout=UI_RENDER_TIMEOUT)

    return Helpers

@pytest.fixture(scope="session")
def test_settings():
    """test_settings.json から設定を読み込む"""
    if not SETTINGS_PATH.exists():
        pytest.fail(f"Configuration file not found: {SETTINGS_PATH}. Please create it from {SETTINGS_PATH}.example")
    
    with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def wait_for_server(url, timeout=300.0):
    """サーバーがHTTPリクエストに応答するまで待機する"""
    import urllib.request
    print(f"[{time.strftime('%H:%M:%S')}] Connecting to {url} (timeout_per_try=5s, total_timeout={timeout}s)...")
    start_time = time.time()
    while True:
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status == 200:
                    return True
        except Exception:
            if time.time() - start_time > timeout:
                return False
            time.sleep(1.0)

@pytest.fixture(scope="session")
def comfyui_server(test_settings):
    """ComfyUIサーバーを起動し、そのベースURLを返すフィクスチャ"""
    # パスの解決
    comfyui_path = Path(test_settings["comfyui_path"]).resolve()
    python_exe = Path(test_settings["python_executable"]).resolve()
    port = test_settings["test_port"]

    # ComfyUIの起動コマンド (E2Eテスト用に軽量化)
    cmd = [
        str(python_exe), "main.py", 
        "--port", str(port), 
        "--listen", "127.0.0.1",
        "--cpu",
        "--disable-smart-memory",
        "--disable-xformers"
    ]
    
    # 環境変数の準備
    env = os.environ.copy()
    # ComfyUIのパスを絶対パスでPYTHONPATHに追加（Stability Matrix環境で必要）
    env["PYTHONPATH"] = str(comfyui_path.absolute())

    print(f"\nStarting ComfyUI server: {comfyui_path} using {python_exe} on port {port}")
    
    process = subprocess.Popen(
        cmd,
        cwd=comfyui_path,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        encoding="utf-8",
        env=env,
        bufsize=1,
        universal_newlines=True
    )

    # サーバーの出力を非ブロッキングで読み取りつつ、サーバーの応答を待機
    start_time = time.time()
    base_url = f"http://127.0.0.1:{port}"
    
    print(f"\nWaiting for ComfyUI server to respond at {base_url}...")
    
    # stdoutを非ブロッキングで読み取るための準備 (Windows対応)
    import threading
    import queue
    
    log_file = open("comfyui_server.log", "w", encoding="utf-8", buffering=1)
    output_queue = queue.Queue()
    def enqueue_output(out, queue, log):
        for line in iter(out.readline, ''):
            queue.put(line)
            log.write(line)
        out.close()
        log.close()
    
    t = threading.Thread(target=enqueue_output, args=(process.stdout, output_queue, log_file))
    t.daemon = True
    t.start()

    # サーバーの応答をポーリング
    is_ready = False
    while True:
        # ログの出力
        try:
            while True:
                line = output_queue.get_nowait()
                print(f"ComfyUI: {line.strip()}")
        except queue.Empty:
            pass

        # サーバーが立ち上がったか確認
        if wait_for_server(base_url, timeout=2.0):
            elapsed = time.time() - start_time
            print(f"\nComfyUI server is READY! (Startup time: {elapsed:.2f} seconds)")
            is_ready = True
            break
        
        if process.poll() is not None:
            print("ComfyUI process exited prematurely.")
            break
            
        if time.time() - start_time > 120:
            print("Timeout waiting for ComfyUI server.")
            break
        
        time.sleep(0.5)

    if not is_ready:
        process.terminate()
        pytest.fail(f"ComfyUI server failed to respond at {base_url} within timeout.")

    yield base_url

    print("\nShutting down ComfyUI server...")
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        print("Server termination timed out, killing process...")
        process.kill()
        process.wait()

@pytest.fixture
def wait_for_comfyui():
    """ComfyUIのUIがロードされるまで待機する共通ヘルパーフィクスチャ"""
    from playwright.sync_api import Page
    
    def _wait(page: Page):
        print(f"[{time.strftime('%H:%M:%S')}] Waiting for basic ComfyUI elements (timeout 60s)...")
        try:
            page.wait_for_selector(".comfy-menu, .comfyui-menu, .side-bar-button, #comfy-canvas-container, body", state="attached", timeout=60000)
            print(f"[{time.strftime('%H:%M:%S')}] Basic elements attached.")
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] Wait for selector failed: {e}")
            page.screenshot(path="tests/debug_selector_fail.png")
        
        # app.graph が準備できるまで待つ (複数のパスを試行)
        print(f"[{time.strftime('%H:%M:%S')}] Waiting for window.app.graph (timeout 180s)...")
        try:
            page.wait_for_function("""
                () => {
                    const findApp = (root) => {
                        if (root.app) return root.app;
                        if (root.comfyAPI && root.comfyAPI.app) return root.comfyAPI.app;
                        if (root.ComfyApp) return root.ComfyApp;
                        
                        // V2のカスタムエレメントを探す
                        const canvas = document.querySelector("comfy-canvas");
                        if (canvas && canvas.app) return canvas.app;
                        
                        const menu = document.querySelector("comfy-menu");
                        if (menu && menu.app) return menu.app;

                        return null;
                    };
                    
                    const app = findApp(window) || (window.parent && findApp(window.parent));
                    return !!(app && app.graph);
                }
            """, timeout=180000)
            print(f"[{time.strftime('%H:%M:%S')}] window.app.graph is READY.")
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] Wait for function failed: {e}")
            page.screenshot(path="tests/debug_function_fail.png")
            print(f"Current URL: {page.url}")
            raise e
        
        # ローディング画面が消えるのを待つ
        print(f"[{time.strftime('%H:%M:%S')}] Waiting for loading overlay to hide (timeout 30s)...")
        try:
            page.wait_for_selector("#comfy-file-input-overlay", state="hidden", timeout=30000)
            print(f"[{time.strftime('%H:%M:%S')}] Loading overlay hidden.")
        except:
            print(f"[{time.strftime('%H:%M:%S')}] Loading overlay wait timed out or element not found (continuing anyway).")
            pass
            
    return _wait

@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    # execute all other hooks to obtain the report object
    outcome = yield
    rep = outcome.get_result()

    # we only look at "call" phase failures (not setup/teardown)
    if rep.when != "call":
        return
        
    if not (rep.failed or (hasattr(rep, "wasxfail") and not rep.passed)):
        return

    # Check if the test has a 'page' fixture
    if "page" not in item.funcargs:
        return

    page = item.funcargs["page"]
    try:
        import datetime
        timestamp = datetime.datetime.now().strftime("%H%M%S")
        # Clean test name for filename
        safe_name = item.name.replace("[", "_").replace("]", "_").replace("/", "_").replace(":", "_")
        
        dump_dir = Path("debug_dumps")
        dump_dir.mkdir(parents=True, exist_ok=True)
        
        html_filename = dump_dir / f"failure_{safe_name}_{timestamp}.html"
        with open(html_filename, "w", encoding="utf-8") as f:
            f.write(page.content())
        
        print(f"\n[DEBUG] Captured HTML failure dump to {html_filename}")
        
        # Screenshot too if possible
        png_filename = dump_dir / f"failure_{safe_name}_{timestamp}.png"
        page.screenshot(path=str(png_filename))
        print(f"[DEBUG] Captured screenshot to {png_filename}")

    except Exception as e:
        print(f"\n[DEBUG] Failed to capture failure info: {e}")
