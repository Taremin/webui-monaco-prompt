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
            time.sleep(2)

@pytest.fixture(scope="session")
def comfyui_server(test_settings):
    """ComfyUIサーバーを起動し、そのベースURLを返すフィクスチャ"""
    # パスの解決
    comfyui_path = Path(test_settings["comfyui_path"]).resolve()
    python_exe = Path(test_settings["python_executable"]).resolve()
    port = test_settings["test_port"]

    # ComfyUIの起動コマンド
    cmd = [str(python_exe), "main.py", "--port", str(port), "--listen", "127.0.0.1"]
    
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

    # サーバーの出力をリアルタイムで監視しつつ、サーバーの応答を待機
    start_time = time.time()
    base_url = f"http://127.0.0.1:{port}"
    
    def check_output():
        # 非ブロッキングで読み取るか、別スレッドで回すべきだが、
        # ここではポーリングとreadlineを組み合わせて簡易的に実装
        while True:
            line = process.stdout.readline()
            if line:
                print(f"ComfyUI: {line.strip()}")
            
            if wait_for_server(base_url, timeout=0.1):
                return True
            
            if time.time() - start_time > 300:
                break
        return False

    if not check_output():
        process.terminate()
        pytest.fail(f"ComfyUI server failed to respond at {base_url} within timeout.")

    yield base_url

    # サーバーの停止
    print("\nShutting down ComfyUI server...")
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
