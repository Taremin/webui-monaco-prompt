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

# パス解決のため tests ディレクトリを sys.path に追加
sys.path.append(str(TESTS_DIR))

def pytest_addoption(parser):
    """コマンドライン引数の追加"""
    parser.addoption(
        "--comfy-version",
        action="store",
        default=None,
        help="Comma-separated list of ComfyUI versions to test against (e.g., 'v0.2.0,v0.2.2')"
    )

def pytest_generate_tests(metafunc):
    """comfyui_version 引数を持つテストに動的にバージョンパラメータを注入する"""
    if "comfyui_version" in metafunc.fixturenames:
        version_opt = metafunc.config.getoption("comfy_version")
        if version_opt:
            versions = [v.strip() for v in version_opt.split(",") if v.strip()]
        else:
            try:
                with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                versions = settings.get("comfyui_versions", [])
                if not versions:
                    active = settings.get("active_version")
                    versions = [active] if active else ["local"]
            except Exception:
                versions = ["local"]

        versions = [str(v) for v in versions if v]
        metafunc.parametrize("comfyui_version", versions, scope="session")


# グローバルなタイムアウト定数
DEFAULT_TEST_TIMEOUT = 10000  # 10秒
UI_RENDER_TIMEOUT = 10000     # UI要素の描画やアニメーション待ち
NODE_LOAD_TIMEOUT = 30000     # ノードの登録・読み込み待ち (これだけは少し長めを許容)

@pytest.fixture(autouse=True)
def setup_playwright_timeout(page):
    """すべてのテストでPlaywrightのデフォルトタイムアウトを自動設定する"""
    page.set_default_timeout(DEFAULT_TEST_TIMEOUT)

@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    """HTTP キャッシュを無効化してバージョン間のアセット混在を防ぐ"""
    return {
        **browser_context_args,
        "extra_http_headers": {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    }

@pytest.fixture
def wmp_helpers():
    class Helpers:
        @staticmethod
        def load_comfyui(page, comfyui_server, wait_for_comfyui):
            """ComfyUIを開き、初期ロードが完了するまで待機する"""
            page.on("console", lambda msg: print(f"BROWSER CONSOLE [{msg.type}]: {msg.text}"))
            page.on("response", lambda resp: print(f"BROWSER NET ERROR [{resp.status}]: {resp.url}") if resp.status >= 400 else None)
            
            try:
                page.context.clear_cookies()
            except Exception as e:
                print(f"Warning clearing cookies: {e}")
                
            # 一旦 blank ページへ遷移
            page.goto("about:blank")
            
            # Service Worker & Cache Storage の登録解除・削除を完全に同期して待つ
            try:
                page.evaluate("""async () => {
                    if (navigator.serviceWorker) {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        for (let r of regs) {
                            await r.unregister();
                        }
                    }
                    if (window.caches) {
                        const keys = await caches.keys();
                        for (let k of keys) {
                            await caches.delete(k);
                        }
                    }
                }""")
            except Exception as e:
                print(f"Warning clearing Service Workers: {e}")
                
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
            
            # Wait for settings dialog or search input specifically
            try:
                page.wait_for_selector(".p-dialog:visible, dialog:visible, [role='dialog']:visible, input[placeholder*='Search' i]:visible, input[placeholder*='検索' i]:visible", timeout=10000)
            except:
                # Last resort fallback to API but try to force V2
                page.evaluate("""() => {
                    const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
                    const app = getApp();
                    if (app && app.ui && app.ui.settings) app.ui.settings.show();
                }""")
                page.wait_for_selector(".p-dialog:visible, .comfy-modal:visible, dialog:visible, [role='dialog']:visible, input[placeholder*='Search' i]:visible, input[placeholder*='検索' i]:visible", timeout=UI_RENDER_TIMEOUT)

        @staticmethod
        def switch_settings_category(page, category_name="WebuiMonacoPrompt"):
            """V2設定ダイアログでカテゴリを切り替える"""
            try:
                # カテゴリがDOMにレンダリングされるまで安全に待機
                page.wait_for_selector(f'li[aria-label="{category_name}"], .p-listbox-item:has-text("{category_name}")', timeout=5000)
            except Exception as e:
                print(f"Warning: Category selector wait timed out: {e}")

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

@pytest.fixture(scope="module")
def comfyui_server(test_settings, comfyui_version):
    """ComfyUIサーバーを起動し、そのベースURLを返すフィクスチャ"""
    port = test_settings["test_port"]

    if comfyui_version == "local":
        comfyui_path = Path(test_settings["comfyui_path"]).resolve()
        python_exe = Path(test_settings["python_executable"]).resolve()
    else:
        print(f"\n[Fixture] Ensuring ComfyUI version '{comfyui_version}' is set up...")
        from downloader import ComfyUIDownloader
        downloader = ComfyUIDownloader()
        comfyui_path, python_exe = downloader.setup_environment(comfyui_version)
        comfyui_path = comfyui_path.resolve()
        python_exe = python_exe.resolve()

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
            
        if time.time() - start_time > 300:
            print("Timeout waiting for ComfyUI server.")
            break
        
        time.sleep(0.5)

    if not is_ready:
        process.terminate()
        pytest.fail(f"ComfyUI server failed to respond at {base_url} within timeout.")

    # テストコード側から拡張機能の実際のインストール先パスを参照できるように環境変数をセット
    if comfyui_version == "local":
        extension_path = Path(os.getcwd()).resolve()
    else:
        extension_path = (comfyui_path / "custom_nodes" / "webui-monaco-prompt").resolve()
    os.environ["COMFYUI_EXTENSION_PATH"] = str(extension_path.absolute())

    yield base_url

    print("\nShutting down ComfyUI server...")
    os.environ.pop("COMFYUI_EXTENSION_PATH", None)
    if os.name == "nt":
        try:
            # Windowsでは taskkill /F /T を使用して子プロセスツリーごと強制終了する
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        except Exception as e:
            print(f"Failed to taskkill ComfyUI process tree on Windows: {e}")
            process.kill()
    # サーバーのプロセス終了完了を待つ
    if os.name != "nt":
        process.wait()

    # ポートがOSによって完全に解放（バインド可能に）されるまで最大10秒間ポーリング待機する
    print(f"Waiting for port {port} to be released by OS...")
    import socket
    for i in range(10):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            # SO_REUSEADDRを無効にした状態でバインドを試み、完全にポートが解放されているか検証
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
            s.bind(("127.0.0.1", port))
            s.close()
            print(f"Port {port} has been successfully released and is ready for reuse.")
            break
        except Exception:
            time.sleep(1.0)

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
        
        # Screenshot too if possible (wrapped in try-except with short timeout to prevent hang on fonts load)
        png_filename = dump_dir / f"failure_{safe_name}_{timestamp}.png"
        try:
            page.screenshot(path=str(png_filename), timeout=3000)
            print(f"[DEBUG] Captured screenshot to {png_filename}")
        except Exception as screenshot_err:
            print(f"\n[DEBUG] Failed to capture failure screenshot: {screenshot_err}")

    except Exception as e:
        print(f"\n[DEBUG] Failed to capture failure info: {e}")

def parse_version(v_str):
    """バージョン文字列を比較可能なタプルに変換する簡易ヘルパー"""
    cleaned = v_str.lstrip("vr").split("-")[0]
    parts = []
    for p in cleaned.split("."):
        digits = "".join([c for c in p if c.isdigit()])
        parts.append(int(digits) if digits else 0)
    return tuple(parts)

def pytest_runtest_setup(item):
    """min_comfy_version マーカーを処理して条件付きでスキップする"""
    min_version_marker = item.get_closest_marker("min_comfy_version")
    if min_version_marker:
        required_version_str = min_version_marker.args[0]
        
        # item.callspec.params から現在のパラメータ（バージョン）を取得
        if hasattr(item, "callspec") and "comfyui_version" in item.callspec.params:
            current_version_str = item.callspec.params["comfyui_version"]
            
            if current_version_str == "local":
                return
            
            try:
                # packaging.version があればそれを使用、なければ自前フォールバック
                try:
                    from packaging import version
                    curr_v = version.parse(current_version_str.lstrip("v"))
                    req_v = version.parse(required_version_str.lstrip("v"))
                    is_lower = curr_v < req_v
                except ImportError:
                    curr_v = parse_version(current_version_str)
                    req_v = parse_version(required_version_str)
                    is_lower = curr_v < req_v

                if is_lower:
                    pytest.skip(
                        f"Skipping test: requires ComfyUI version >= {required_version_str}, "
                        f"but running with {current_version_str}"
                    )
            except Exception as e:
                print(f"Version comparison failed for {current_version_str} vs {required_version_str}: {e}")
