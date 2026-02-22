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
    start_time = time.time()
    while True:
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status == 200:
                    return True
        except Exception:
            if time.time() - start_time > timeout:
                return False
            time.sleep(0.5)

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
    
    output_queue = queue.Queue()
    def enqueue_output(out, queue):
        for line in iter(out.readline, ''):
            queue.put(line)
        out.close()
    
    t = threading.Thread(target=enqueue_output, args=(process.stdout, output_queue))
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
        if wait_for_server(base_url, timeout=0.1):
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
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()

@pytest.fixture
def wait_for_comfyui():
    """ComfyUIのUIがロードされるまで待機する共通ヘルパーフィクスチャ"""
    from playwright.sync_api import Page
    
    def _wait(page: Page):
        print("Waiting for basic ComfyUI elements...")
        try:
            page.wait_for_selector(".comfy-menu, .comfyui-menu, .side-bar-button, #comfy-canvas-container, body", state="attached", timeout=60000)
        except Exception as e:
            print(f"Wait for selector failed: {e}")
            page.screenshot(path="tests/debug_selector_fail.png")
        
        # app.graph が準備できるまで待つ (複数のパスを試行)
        print("Waiting for window.app.graph...")
        try:
            page.wait_for_function("""
                () => {
                    const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp || (window.parent && window.parent.app);
                    const app = getApp();
                    return !!(app && app.graph);
                }
            """, timeout=180000)
        except Exception as e:
            print(f"Wait for function failed: {e}")
            page.screenshot(path="tests/debug_function_fail.png")
            print(f"Current URL: {page.url}")
            raise e
        
        # ローディング画面が消えるのを待つ
        try:
            page.wait_for_selector("#comfy-file-input-overlay", state="hidden", timeout=30000)
        except:
            pass
            
    return _wait
