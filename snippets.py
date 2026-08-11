import glob
import os
import json
import re

snippets = None

DIR_TAG_PATTERN = re.compile(r'\${dir:([^|}]+)(?:\|([^}]+))?}')


def get_snippets():
    global snippets
    return snippets


def get_node_root_from_snippet_path(snippet_json_path: str, custom_nodes_path: str) -> str:
    """
    スニペット JSON のパスから、所属するカスタムノードのルートディレクトリを取得します。
    """
    abs_snippet_path = os.path.abspath(snippet_json_path)
    abs_custom_nodes_path = os.path.abspath(custom_nodes_path)

    try:
        # custom_nodes_path の直下のディレクトリを取得を試みる
        rel_path = os.path.relpath(abs_snippet_path, abs_custom_nodes_path)
        parts = rel_path.split(os.sep)
        if len(parts) > 1 and parts[0] != "..":
            return os.path.join(abs_custom_nodes_path, parts[0])
    except ValueError:
        pass

    # フォールバック: snippets フォルダの親ディレクトリ
    parts = abs_snippet_path.split(os.sep)
    if "snippets" in parts:
        idx = parts.index("snippets")
        return os.sep.join(parts[:idx])
    
    return os.path.dirname(abs_snippet_path)


def resolve_models_files(path_pattern: str) -> list:
    """
    @models/<category>/<sub_pattern> 形式のパスからモデルファイル一覧を取得します。
    """
    if not path_pattern.startswith("@models/"):
        return None

    clean_path = path_pattern[len("@models/"):].lstrip("/")
    if not clean_path:
        return []

    parts = clean_path.split("/", 1)
    category = parts[0]
    sub_pattern = parts[1] if len(parts) > 1 else None

    # ComfyUI の folder_paths 連携
    try:
        import folder_paths
        if hasattr(folder_paths, "folder_names_and_paths") and category in folder_paths.folder_names_and_paths:
            raw_files = folder_paths.get_filename_list(category) or []
            
            # 不当な上位階層参照のチェック (Path Traversal 防御)
            safe_files = []
            for f in raw_files:
                norm_f = f.replace("\\", "/")
                if ".." not in norm_f.split("/"):
                    safe_files.append(f)

            if sub_pattern:
                import fnmatch
                filtered = []
                for f in safe_files:
                    norm_f = f.replace("\\", "/")
                    if fnmatch.fnmatch(norm_f, sub_pattern) or fnmatch.fnmatch(os.path.basename(norm_f), sub_pattern):
                        filtered.append(f)
                return filtered
            return safe_files
    except (ImportError, Exception):
        pass

    return None


def expand_dir_snippets(insert_text: str, base_dir: str) -> str:
    """
    insert_text 内の ${dir:pattern|options} 形式のタグを解析し、特定ディレクトリのファイル一覧に展開します。
    """
    if not isinstance(insert_text, str) or "${dir:" not in insert_text:
        return insert_text

    base_abs = os.path.abspath(base_dir)

    def replace_tag(match):
        path_pattern = match.group(1).strip()
        options_str = match.group(2) or ""

        # オプション解析
        opts = {}
        if options_str:
            for part in options_str.split('|'):
                part = part.strip()
                if not part:
                    continue
                if '=' in part:
                    k, v = part.split('=', 1)
                    opts[k.strip().lower()] = v.strip()
                else:
                    opts[part.lower()] = True

        pattern_reg = opts.get("pattern")
        replace_str = opts.get("replace", "")
        fmt = opts.get("format", "choice")
        var_num = opts.get("var") or opts.get("index") or opts.get("num") or "1"
        if not var_num.isdigit():
            var_num = "1"

        # 1. @models/<category> パスの判定とファイル取得
        found_files = resolve_models_files(path_pattern)

        # 2. 通常の自カスタムノード配下のファイル走査
        if found_files is None:
            target_path = os.path.abspath(os.path.join(base_abs, path_pattern))
            
            # ワイルドカード文字直前までのパスを取得
            target_path_clean = target_path.split('*')[0].split('?')[0]
            search_root = target_path_clean if os.path.isdir(target_path_clean) else os.path.dirname(target_path_clean)

            try:
                if os.path.commonpath([base_abs, search_root]) != base_abs:
                    print(f"[Webui Monaco Prompt] Access denied outside base dir: {target_path}")
                    return ""
            except ValueError:
                return ""

            # ファイル走査
            found_entries = sorted(glob.glob(target_path, recursive=True))
            found_files = [f for f in found_entries if os.path.isfile(f)]

        if not found_files:
            return ""

        processed_names = []
        for f in found_files:
            rel_name = os.path.basename(f)
            if pattern_reg:
                try:
                    rel_name = re.sub(pattern_reg, replace_str, rel_name)
                except re.error as e:
                    print(f"[Webui Monaco Prompt] Invalid regex pattern '{pattern_reg}': {e}")
            processed_names.append(rel_name)

        # フォーマット展開
        if fmt == "lines":
            return "\n".join(processed_names)
        elif fmt == "comma":
            return ", ".join(processed_names)
        else:  # choice
            choices = [n.replace(",", "\\,").replace("|", "\\|") for n in processed_names]
            return f"${{{var_num}|{','.join(choices)}|}}"

    return DIR_TAG_PATTERN.sub(replace_tag, insert_text)




def load_snippets(target_dir: str):
    global snippets
    snippets = []
    custom_nodes_path = target_dir
    for path in glob.glob(os.path.join(custom_nodes_path, "*", "snippets", "**", "*.json"), recursive=True):
        try:
            with open(path, "r", encoding="utf-8") as fp:
                loaded_snippets = json.load(fp)

                base_dir = get_node_root_from_snippet_path(path, custom_nodes_path)

                for loaded_snippet in (loaded_snippets if isinstance(loaded_snippets, list) else [loaded_snippets]):
                    label_text = loaded_snippet.get("label")
                    insert_text = loaded_snippet.get("insertText")
                    if (
                        label_text is not None and isinstance(label_text, str) and
                        insert_text is not None and isinstance(insert_text, str)
                    ):
                        # ディレクトリタグの展開処理を適用
                        expanded_insert_text = expand_dir_snippets(insert_text, base_dir)

                        snippet = {}
                        snippet["label"] = label_text
                        snippet["insertText"] = expanded_insert_text
                        snippet["path"] = os.path.relpath(path, custom_nodes_path)

                        detail_text = loaded_snippet.get("detail")
                        if detail_text is not None:
                            snippet["detail"] = detail_text

                        documentation_text = loaded_snippet.get("documentation")
                        if documentation_text is not None:
                            snippet["documentation"] = documentation_text

                        snippets.append(snippet)
        except Exception as e:
            print("[SKIP] Webui Monaco Prompt: invalid json:", path, e)

