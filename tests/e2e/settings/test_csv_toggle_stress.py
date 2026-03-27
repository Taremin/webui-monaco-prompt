import pytest
from playwright.sync_api import Page, expect
import time

def test_csv_toggle_stress(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    Test rapid toggling of CSV files to ensure no server errors (JSONDecodeError) occur.
    """
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    
    # Listen to console errors to catch potential network errors
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    
    # Also monitor network responses to ensure settings are saved without 500 errors
    failed_requests = []
    page.on("response", lambda response: failed_requests.append(response.url) if response.status >= 500 and "CsvToggle" in response.url else None)
    # Open settings dialog using helper
    wmp_helpers.open_settings(page)
    
    # Use search box to filter settings
    search_box = page.get_by_placeholder("Search settings")
    if search_box.is_visible():
        search_box.fill("WebuiMonacoPrompt")
    
    # Find danbooru.csv checkbox
    danbooru_checkbox = page.locator('label', has_text="danbooru.csv").locator('input[type="checkbox"]')
    expect(danbooru_checkbox).to_be_visible(timeout=5000)
    
    # Toggle rapidly multiple times
    for _ in range(10):
        danbooru_checkbox.click()
        # Small delay to simulate rapid human clicking, but enough to trigger race conditions
        page.wait_for_timeout(100)
        
    # Wait a bit for pending requests to settle
    page.wait_for_timeout(2000)
    
    # Verify no server errors occurred
    assert len(failed_requests) == 0, f"Server returned error for requests: {failed_requests}"
    
    # Force a final sync by toggling once more slowly and checking if it persists
    # First uncheck
    if danbooru_checkbox.is_checked():
        danbooru_checkbox.click()
        page.wait_for_timeout(500)
    
    # Then check
    danbooru_checkbox.click()
    page.wait_for_timeout(1000)
    
    # Close settings
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    
    # Reload page to check persistence
    page.reload()
    wait_for_comfyui(page)
    
    # Re-open settings to verify
    wmp_helpers.open_settings(page)
    if search_box.is_visible():
        search_box.fill("WebuiMonacoPrompt")
    
    danbooru_checkbox = page.locator('label', has_text="danbooru.csv").locator('input[type="checkbox"]')
    expect(danbooru_checkbox).to_be_checked()

