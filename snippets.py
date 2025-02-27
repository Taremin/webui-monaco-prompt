import glob
import os
import json

snippets = None


def get_snippets():
    global snippets
    return snippets


def load_snippets(target_dir: str):
    global snippets
    snippets = []
    custom_nodes_path = target_dir
    for path in glob.glob(os.path.join(custom_nodes_path, "*", "snippets", "*.json")):
        try:
            with open(path, "r") as fp:
                loaded_snippets = json.load(fp)

                for loaded_snippet in (loaded_snippets if isinstance(loaded_snippets, list) else [loaded_snippets]):
                    label_text = loaded_snippet.get("label")
                    insert_text = loaded_snippet.get("insertText")
                    if (
                        label_text is not None and isinstance(label_text, str) and
                        insert_text is not None and isinstance(insert_text, str)
                    ):
                        snippet = {}
                        snippet["label"] = label_text
                        snippet["insertText"] = insert_text
                        snippet["path"] = os.path.relpath(path, custom_nodes_path)

                        detail_text = loaded_snippet.get("detail")
                        if detail_text is not None:
                            snippet["detail"] = detail_text

                        documentation_text = loaded_snippet.get("documentation")
                        if documentation_text is not None:
                            snippet["documentation"] = documentation_text

                        snippets.append(snippet)
        except Exception:
            print("[SKIP] Webui Monaco Prompt: invalid json:", path)
