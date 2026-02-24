import subprocess
import time
import sys
import json
import os
from pathlib import Path

# conftest.py と同じ設定を読み込む
current_dir = Path(__file__).parent.resolve()
SETTINGS_PATH = current_dir / "test_settings.json"

print(f"Loading settings from: {SETTINGS_PATH}")
if not SETTINGS_PATH.exists():
    print("Error: test_settings.json not found")
    sys.exit(1)

with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
    settings = json.load(f)

comfyui_path = Path(settings["comfyui_path"]).resolve()
python_exe = Path(settings["python_executable"]).resolve()
port = settings["test_port"]

cmd = [
    str(python_exe), "main.py", 
    "--port", str(port), 
    "--listen", "127.0.0.1",
    "--cpu",
    "--disable-smart-memory",
    "--disable-xformers"
]

print(f"Profiling ComfyUI startup: {comfyui_path}")
print(f"Python: {python_exe}")
print(f"Command: {' '.join(cmd)}")
print("-" * 50)

if not comfyui_path.exists():
    print(f"Error: comfyui_path does not exist: {comfyui_path}")
    sys.exit(1)
if not python_exe.exists():
    print(f"Error: python_exe does not exist: {python_exe}")
    sys.exit(1)

# 環境変数の準備 (PYTHONPATHを通す)
env = os.environ.copy()
env["PYTHONPATH"] = str(comfyui_path.absolute())

start_time = time.time()
print("Starting process...")
try:
    process = subprocess.Popen(
        cmd,
        cwd=comfyui_path,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        encoding="utf-8",
        universal_newlines=True,
        bufsize=1,
        env=env
    )
    print(f"Process started (PID: {process.pid})")
    
    for line in process.stdout:
        elapsed = time.time() - start_time
        print(f"[{elapsed:6.2f}s] {line.strip()}", flush=True)
        # 起動完了を示すメッセージ
        if "To see the GUI, go to" in line or "Starting server" in line:
            print("-" * 50)
            print(f"Startup finished in {elapsed:.2f} seconds.")
            process.terminate()
            break
        if elapsed > 120:
            print("-" * 50)
            print("Timeout reached (120s).")
            process.terminate()
            break
except Exception as e:
    print(f"Error occurred during process execution: {e}")

if process:
    process.wait()
    print(f"Process exited with code: {process.returncode}")
else:
    print("Failed to create process.")
