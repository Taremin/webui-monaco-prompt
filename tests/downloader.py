import os
import sys
import shutil
import urllib.request
import zipfile
import re
import subprocess
from pathlib import Path

def parse_simple_yaml(yaml_text):
    """インデントベースの簡易YAMLパーサー。
    辞書（Map）、リスト（Sequence）、および複数行文字列（| や >）のパースをサポート。
    """
    import re
    result = {}
    stack = [(-1, result, None)]
    
    # 複数行文字列の収集用状態
    in_multiline = False
    multiline_indent = -1
    multiline_lines = []
    multiline_target_dict = None
    multiline_key = None
    multiline_type = '|'
    
    for line in yaml_text.splitlines():
        if in_multiline:
            # 空行はそのままバッファに追加
            if not line.strip():
                multiline_lines.append("")
                continue
                
            indent = len(line) - len(line.lstrip())
            
            # インデントが複数行定義の開始インデント以下に戻ったら複数行モード終了
            if indent <= stack[-1][0]:
                if multiline_type == '|':
                    joined = "\n".join(multiline_lines) + "\n"
                else:
                    joined = " ".join([l.strip() for l in multiline_lines if l.strip()])
                
                if multiline_target_dict is not None and multiline_key is not None:
                    multiline_target_dict[multiline_key] = joined.strip()
                    
                in_multiline = False
                multiline_lines = []
            else:
                if multiline_indent == -1:
                    multiline_indent = indent
                
                content_line = line[multiline_indent:] if len(line) >= multiline_indent else line.lstrip()
                multiline_lines.append(content_line)
                continue
                
        stripped_line = re.sub(r'#.*$', '', line).rstrip()
        if not stripped_line.strip():
            continue
            
        indent = len(line) - len(line.lstrip())
        content = stripped_line.strip()
        
        while len(stack) > 1 and stack[-1][0] >= indent:
            stack.pop()
            
        current_obj = stack[-1][1]
        
        # 1. リストの要素 (例: "- item" または "- key: val")
        if content.startswith("-"):
            if isinstance(current_obj, dict) and not current_obj:
                if len(stack) > 1:
                    parent_obj = stack[-2][1]
                    my_key = stack[-1][2]
                    if isinstance(parent_obj, dict) and my_key is not None:
                        current_obj = []
                        parent_obj[my_key] = current_obj
                        stack[-1] = (stack[-1][0], current_obj, my_key)
            
            item_val = content[1:].strip()
            if (item_val.startswith('"') and item_val.endswith('"')) or (item_val.startswith("'") and item_val.endswith("'")):
                item_val = item_val[1:-1]
                
            match_kv = re.match(r"^([\w\-]+)\s*:\s*(.*)$", item_val)
            if match_kv:
                k, v = match_kv.groups()
                v = v.strip()
                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1]
                
                # リスト内の key: | を検出
                if v in ('|', '>'):
                    new_dict = {k: ""}
                    if isinstance(current_obj, list):
                        current_obj.append(new_dict)
                    in_multiline = True
                    multiline_indent = -1
                    multiline_lines = []
                    multiline_target_dict = new_dict
                    multiline_key = k
                    multiline_type = v
                    stack.append((indent, new_dict, None))
                else:
                    new_dict = {k: v if v != "" else {}}
                    if isinstance(current_obj, list):
                        current_obj.append(new_dict)
                    
                    target_obj = new_dict[k] if v == "" and isinstance(new_dict[k], dict) else new_dict
                    stack.append((indent, target_obj, k if v == "" else None))
            else:
                if isinstance(current_obj, list):
                    current_obj.append(item_val)
                    
        # 2. key: value のパターン
        else:
            match = re.match(r"^([\w\-]+)\s*:\s*(.*)$", content)
            if match:
                key, val = match.groups()
                val = val.strip()
                if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                    
                if isinstance(current_obj, dict):
                    if val in ('|', '>'):
                        in_multiline = True
                        multiline_indent = -1
                        multiline_lines = []
                        multiline_target_dict = current_obj
                        multiline_key = key
                        multiline_type = val
                        current_obj[key] = ""
                    elif val == "":
                        new_dict = {}
                        current_obj[key] = new_dict
                        stack.append((indent, new_dict, key))
                    else:
                        # フローリスト（例: [a, b]）の簡易パース
                        if val.startswith("[") and val.endswith("]"):
                            elements = [e.strip().strip('"\'') for e in val[1:-1].split(",") if e.strip()]
                            current_obj[key] = elements
                        else:
                            current_obj[key] = val
                            
    # 最後の行が複数行文字列のまま終わった場合のクリーンアップ
    if in_multiline and multiline_target_dict is not None and multiline_key is not None:
        if multiline_type == '|':
            joined = "\n".join(multiline_lines) + "\n"
        else:
            joined = " ".join([l.strip() for l in multiline_lines if l.strip()])
        multiline_target_dict[multiline_key] = joined.strip()
        
    return result

class ComfyUIDownloader:
    def __init__(self, base_dir=None):
        if base_dir is None:
            # tests/comfyui-versions
            self.base_dir = Path(__file__).parent.resolve() / "comfyui-versions"
        else:
            self.base_dir = Path(base_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.temp_dir = self.base_dir / "temp"
        self.temp_dir.mkdir(parents=True, exist_ok=True)

    def _download_file(self, url, dest_path):
        """ファイルをダウンロードするヘルパー関数"""
        print(f"Downloading {url} to {dest_path}...")
        try:
            urllib.request.urlretrieve(url, dest_path)
            print("Download complete.")
        except Exception as e:
            print(f"Failed to download {url}: {e}")
            raise

    def _extract_zip(self, zip_path, dest_dir):
        """zipファイルを展開するヘルパー関数"""
        print(f"Extracting {zip_path} to {dest_dir}...")
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(dest_dir)
        print("Extraction complete.")

    def download_comfyui(self, version):
        """ComfyUIソースコードをダウンロードして展開する"""
        comfy_dir = self.base_dir / f"ComfyUI-{version}"
        if comfy_dir.exists() and (comfy_dir / "main.py").exists():
            print(f"ComfyUI {version} already exists at {comfy_dir}")
            return comfy_dir

        # URLの決定 (タグ名、ブランチ名、またはコミットハッシュ)
        if re.match(r"^[0-9a-f]{40}$", version):
            # コミットハッシュ
            url = f"https://github.com/Comfy-Org/ComfyUI/archive/{version}.zip"
        elif version.startswith("v"):
            # タグ (v0.2.2など)
            url = f"https://github.com/Comfy-Org/ComfyUI/archive/refs/tags/{version}.zip"
        else:
            # ブランチ名など
            url = f"https://github.com/Comfy-Org/ComfyUI/archive/refs/heads/{version}.zip"

        zip_path = self.temp_dir / f"comfyui-{version}.zip"
        self._download_file(url, zip_path)

        # 一時ディレクトリに展開し、目的のパスへ移動
        extract_temp = self.temp_dir / f"comfy_temp_{version}"
        if extract_temp.exists():
            shutil.rmtree(extract_temp)
        
        self._extract_zip(zip_path, extract_temp)

        # 解凍されたフォルダ（通常 ComfyUI-<hash-or-tag> のような名前）を探して移動
        extracted_dirs = [d for d in extract_temp.iterdir() if d.is_dir()]
        if not extracted_dirs:
            raise Exception("No directory found in extracted ComfyUI zip")
        
        if comfy_dir.exists():
            shutil.rmtree(comfy_dir)
            
        shutil.move(str(extracted_dirs[0]), str(comfy_dir))
        
        # クリーンアップ
        shutil.rmtree(extract_temp)
        if zip_path.exists():
            zip_path.unlink()

        print(f"ComfyUI {version} setup completed at {comfy_dir}")
        return comfy_dir

    def detect_python_version(self, comfyui_dir):
        """windows_release_package.yml から Python 推奨バージョンを検出する"""
        yml_path = comfyui_dir / ".github" / "workflows" / "windows_release_package.yml"
        if not yml_path.exists():
            print(f"Warning: {yml_path} not found. Falling back to Python 3.11.9")
            return "3.11.9"

        with open(yml_path, "r", encoding="utf-8") as f:
            content = f.read()

        try:
            data = parse_simple_yaml(content)
            inputs = data.get("on", {}).get("workflow_dispatch", {}).get("inputs", {})
            minor = inputs.get("python_minor", {}).get("default", "11")
            patch = inputs.get("python_patch", {}).get("default", "9")
        except Exception as e:
            print(f"Warning: Failed to parse YAML natively ({e}). Falling back to default.")
            minor, patch = "11", "9"

        full_version = f"3.{minor}.{patch}"
        print(f"Detected recommended Python version: {full_version}")
        return full_version

    def download_python_embed(self, python_version):
        """PythonのWindows Embeddable packageをダウンロードして展開する"""
        py_dir = self.base_dir / f"python-{python_version}"
        if py_dir.exists() and (py_dir / "python.exe").exists():
            print(f"Python {python_version} already exists at {py_dir}")
            return py_dir

        url = f"https://www.python.org/ftp/python/{python_version}/python-{python_version}-embed-amd64.zip"
        zip_path = self.temp_dir / f"python-{python_version}.zip"
        
        self._download_file(url, zip_path)
        py_dir.mkdir(parents=True, exist_ok=True)
        self._extract_zip(zip_path, py_dir)
        
        # クリーンアップ
        if zip_path.exists():
            zip_path.unlink()

        print(f"Python {python_version} extracted to {py_dir}")
        return py_dir

    def patch_pth_file(self, python_dir):
        """python*._pth ファイルを削除して、環境変数（PYTHONPATH）や標準パスが正常に動作するようにする"""
        pth_files = list(python_dir.glob("*._pth"))
        if not pth_files:
            return

        for pth in pth_files:
            print(f"Removing {pth} to restore default Python behavior (enables PYTHONPATH and site-packages)...")
            try:
                pth.unlink()
            except Exception as e:
                print(f"Failed to remove {pth}: {e}")

    def install_pip(self, python_dir):
        """get-pip.py をダウンロードして pip をインストールする"""
        if (python_dir / "Scripts" / "pip.exe").exists():
            print("pip is already installed.")
            return

        pip_script = self.temp_dir / "get-pip.py"
        self._download_file("https://bootstrap.pypa.io/get-pip.py", pip_script)

        # 埋め込みPythonで get-pip.py を実行
        py_exe = python_dir / "python.exe"
        print(f"Installing pip using {py_exe}...")
        subprocess.run([str(py_exe), str(pip_script)], check=True)

        if pip_script.exists():
            pip_script.unlink()
        print("pip installation completed.")

    def install_dependencies(self, python_dir, comfyui_dir):
        """CPU版 PyTorch および ComfyUI 依存ライブラリをインストールする"""
        py_exe = python_dir / "python.exe"
        pip_cmd = [str(py_exe), "-m", "pip", "install"]

        print("Installing CPU version of PyTorch...")
        subprocess.run(
            pip_cmd + ["torch", "torchvision", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cpu"],
            check=True
        )

        print("Installing ComfyUI requirements...")
        req_file = comfyui_dir / "requirements.txt"
        if req_file.exists():
            subprocess.run(pip_cmd + ["-r", str(req_file)], check=True)
        else:
            print("Warning: requirements.txt not found in ComfyUI directory.")



    def create_custom_node_link(self, comfyui_dir):
        """本拡張機能（webui-monaco-prompt）を ComfyUI の custom_nodes に配置する"""
        custom_nodes_dir = comfyui_dir / "custom_nodes"
        custom_nodes_dir.mkdir(parents=True, exist_ok=True)
        
        target_link = custom_nodes_dir / "webui-monaco-prompt"
        project_root = Path(__file__).parent.parent.resolve()

        if target_link.exists() or target_link.is_symlink():
            print(f"Removing existing link/dir at {target_link}")
            if target_link.is_symlink() or target_link.is_file():
                target_link.unlink()
            else:
                shutil.rmtree(target_link)

        print(f"Creating link/copy from {project_root} to {target_link}")
        try:
            # Windowsの開発者モードや管理者権限で実行できる場合はシンボリックリンクを作成
            os.symlink(project_root, target_link, target_is_directory=True)
            print("Symbolic link created successfully.")
        except OSError as e:
            print(f"Warning: Failed to create symbolic link ({e}). Falling back to directory copy...")
            # シンボリックリンクが失敗した場合は、フォルダをコピー（.git, node_modules, testsなどは除外）
            ignore_pattern = shutil.ignore_patterns(
                ".git", "node_modules", "tests", "comfyui-versions", 
                "venv", "tmp", "debug_dumps", "*.log"
            )
            shutil.copytree(project_root, target_link, ignore=ignore_pattern)
            print("Directory copied successfully.")

    def setup_environment(self, version):
        """ComfyUIのダウンロードから依存関係の解決、カスタムノードの配置までを一括して行うメイン関数"""
        print(f"=== Setting up ComfyUI environment for version: {version} ===")
        
        # 最終完了フラグファイル
        build_flag = self.base_dir / f"build_complete_{version}.flag"
        comfyui_dir = self.base_dir / f"ComfyUI-{version}"
        
        # 既にビルド完了フラグがあればスキップ
        if build_flag.exists() and comfyui_dir.exists():
            # 推奨Pythonバージョンを検出して、既存のパスを返す
            py_version = self.detect_python_version(comfyui_dir)
            py_dir = self.base_dir / f"python-{py_version}"
            
            # リンクの再配置だけ行う（コードが変更されている可能性があるため）
            self.create_custom_node_link(comfyui_dir)
            
            print(f"Environment for {version} is already built.")
            return comfyui_dir, py_dir / "python.exe"

        # 1. ComfyUI ソースのダウンロード
        comfyui_dir = self.download_comfyui(version)
        
        # 2. Python 推奨バージョンの検出
        py_version = self.detect_python_version(comfyui_dir)
        
        # 3. Python 埋め込みパッケージのダウンロード・展開
        py_dir = self.download_python_embed(py_version)
        
        # 4. _pth ファイルの修正
        self.patch_pth_file(py_dir)
        
        # 5. pip のインストール
        self.install_pip(py_dir)
        
        # 6. 依存関係（CPU版 PyTorch 含む）のインストール
        self.install_dependencies(py_dir, comfyui_dir)
        
        # 7. カスタムノードの配置
        self.create_custom_node_link(comfyui_dir)
        
        # 完了フラグの作成
        with open(build_flag, "w", encoding="utf-8") as f:
            f.write("complete")
            
        print(f"=== Setup completed for ComfyUI {version} ===")
        return comfyui_dir, py_dir / "python.exe"

class Logger:
    def __init__(self, filename):
        self.terminal = sys.stdout
        self.log = open(filename, "a", encoding="utf-8", buffering=1)

    def write(self, message):
        self.terminal.write(message)
        self.log.write(message)
        self.terminal.flush()
        self.log.flush()

    def flush(self):
        self.terminal.flush()
        self.log.flush()

if __name__ == "__main__":
    # コマンドラインからの個別起動用
    if len(sys.argv) > 1:
        ver = sys.argv[1]
        
        # ログ設定
        base_log_dir = Path(__file__).parent.resolve() / "comfyui-versions"
        base_log_dir.mkdir(parents=True, exist_ok=True)
        log_file_path = base_log_dir / "downloader.log"
        
        # 実行のたびにログをクリーンアップ
        if log_file_path.exists():
            try:
                log_file_path.unlink()
            except:
                pass
                
        logger = Logger(log_file_path)
        sys.stdout = logger
        sys.stderr = logger
        
        downloader = ComfyUIDownloader()
        downloader.setup_environment(ver)
    else:
        print("Usage: python downloader.py <comfyui_version>")
