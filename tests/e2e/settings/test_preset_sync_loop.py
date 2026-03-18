import pytest
from playwright.sync_api import Page, expect

def test_feature_to_custom_preset_sync_and_no_loop(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    Language Feature を変更した際に Preset が custom になること、
    かつ無限ループによるフリーズが起きないこと（タイムアウトしないこと）を検証。
    """
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    
    # 0. 少なくとも一つのインスタンスが存在するようにノードを作成
    wmp_helpers.create_node(page, "CLIPTextEncode")
    wmp_helpers.wait_for_editor(page)
    
    # 1. デフォルトのプリセットを設定しておく（例: comfy-dynamic-prompt）
    wmp_helpers.set_comfy_setting(page, "WebuiMonacoPrompt.LanguagePreset", "comfy-dynamic-prompt")
    wmp_helpers.wait_for_ui_stabilize(page, 2000)
    
    initial_preset = wmp_helpers.get_comfy_setting(page, "WebuiMonacoPrompt.LanguagePreset")
    assert initial_preset == "comfy-dynamic-prompt", f"Failed to set initial preset. Got {initial_preset}"

    # 2. 一つのFeature (例: comment-hash) の状態を反転させる
    wmp_helpers.set_comfy_setting(page, "WebuiMonacoPrompt.LanguageFeature.comment-hash", False)
    wmp_helpers.wait_for_ui_stabilize(page, 2000)
    
    # 3. プリセットが custom に変わったことを検証
    # 無限ループがある場合、ここでタイムアウトするかフリーズする。
    preset_val = wmp_helpers.get_comfy_setting(page, "WebuiMonacoPrompt.LanguagePreset")
    assert preset_val == "custom", f"Expected 'custom', but got '{preset_val}'"
    
    # 4. リロード後も custom が維持されているか検証
    page.reload()
    wait_for_comfyui(page)
    wmp_helpers.wait_for_ui_stabilize(page, 2000)
    
    reloaded_preset_val = wmp_helpers.get_comfy_setting(page, "WebuiMonacoPrompt.LanguagePreset")
    assert reloaded_preset_val == "custom", f"Expected 'custom' after reload, but got '{reloaded_preset_val}'"
    
    # 5. 後始末: 元に戻す
    wmp_helpers.set_comfy_setting(page, "WebuiMonacoPrompt.LanguagePreset", "comfy-dynamic-prompt")
    wmp_helpers.wait_for_ui_stabilize(page, 1000)
