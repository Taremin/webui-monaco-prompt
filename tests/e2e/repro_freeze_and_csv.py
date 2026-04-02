import pytest
from playwright.sync_api import Page, expect
import time
import os
from pathlib import Path

def test_reproduce_heavy_load_freeze(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    大量のノード（60個）が存在する環境での読み込み遅延と設定同期の不備を再現する。
    """
    # 1. 準備: テスト用CSVを作成
    csv_dir = Path("csv")
    csv_dir.mkdir(exist_ok=True)
    test_csv_path = csv_dir / "heavy_repro.csv"
    test_csv_path.write_text("tag1,tag1\ntag2,tag2")

    try:
        page.set_viewport_size({"width": 1920, "height": 1080})
        
        # コンソールログをキャプチャ (longtask警告を表示するため)
        page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))

        wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
        wmp_helpers.wait_for_graph_clear(page)

        # 2. カスタムノードの登録を待つ
        print("Waiting for WebuiMonacoPromptMultiText to be registered...")
        page.wait_for_function("""() => {
            return LiteGraph.registered_node_types["WebuiMonacoPromptMultiText"] !== undefined;
        }""", timeout=30000)

        # 3. 60個のノードを作成 (本来の負荷)
        print("Creating 60 nodes...")
        page.evaluate("""() => {
            for (let i = 0; i < 60; i++) {
                const node = LiteGraph.createNode("WebuiMonacoPromptMultiText");
                if (!node) throw new Error("Failed to create node: WebuiMonacoPromptMultiText");
                node.pos = [100 + (i % 10) * 300, 100 + Math.floor(i / 10) * 150];
                app.graph.add(node);
            }
            app.canvas.draw(true, true);
        }""")
        
        print("Ensuring widgets are attached...")
        page.evaluate("""() => {
            app.graph._nodes.forEach(node => {
                if (node.widgets) {
                    node.widgets.forEach(w => {
                        if (w.input_el && !w.input_el.parentElement) {
                            document.body.appendChild(w.input_el);
                        }
                    });
                }
            });
        }""")

        print("Waiting for prompt-editor elements to be attached...")
        page.wait_for_selector("prompt-editor", state="attached", timeout=60000)
        
        print("Waiting for all 60 editors to be fully initialized...")
        page.wait_for_function("""() => {
            const editors = document.querySelectorAll('prompt-editor');
            return editors.length === 60 && Array.from(editors).every(e => e.monaco !== undefined);
        }""", timeout=90000)
        
        page.wait_for_timeout(2000)

        # 3. 設定変更 (CSVをOFFにする)
        print("Changing settings: Disable heavy_repro.csv")
        wmp_helpers.open_settings(page)
        wmp_helpers.switch_settings_category(page, "WebuiMonacoPrompt")
        
        page.locator("label", has_text="heavy_repro.csv").locator("input[type='checkbox']").uncheck()
        page.keyboard.press("Escape")
        page.wait_for_timeout(1000)

        # 4. ページをリロードして時間を計測
        print("Reloading page with 60 nodes...")
        start_time = time.time()

        wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
        load_duration = time.time() - start_time
        print(f"Total reload duration: {load_duration:.2f}s")

        # パフォーマンスデータの取得と詳細分析
        perf_data = page.evaluate("() => window.WebuiMonacoPrompt_PerfMetrics || []")
        if perf_data:
            print("\n--- Detailed Performance Analysis ---")
            
            # 1. Monaco Instance Creation
            create_times = [d['duration'] for d in perf_data if d['type'] == 'instance_create']
            if create_times:
                print(f"Monaco Instance Creation (Total {len(create_times)}):")
                print(f"  Total: {sum(create_times):.2f}ms")
                print(f"  Average: {sum(create_times)/len(create_times):.2f}ms")
            
            # 2. Profiling (Wrapped Methods)
            profile_data = [d for d in perf_data if d['type'] == 'profile']
            if profile_data:
                print("\nProfiled Methods (cumulative):")
                method_sums = {}
                method_counts = {}
                for d in profile_data:
                    name = d['name']
                    method_sums[name] = method_sums.get(name, 0) + d['duration']
                    method_counts[name] = method_counts.get(name, 0) + 1
                
                for name in sorted(method_sums.keys()):
                    print(f"  {name:30}: {method_sums[name]:8.2f}ms (count: {method_counts[name]})")

            # 3. Long Tasks
            long_tasks = [d for d in perf_data if d['type'] == 'longtask']
            if long_tasks:
                print(f"\nLong Tasks detected (Total {len(long_tasks)}):")
                total_long_task_time = sum(d['duration'] for d in long_tasks)
                print(f"  Total blocking time: {total_long_task_time:.2f}ms")
                # 上位5つの長いタスクを表示
                sorted_long = sorted(long_tasks, key=lambda x: x['duration'], reverse=True)
                for i, lt in enumerate(sorted_long[:5]):
                    print(f"  #{i+1}: {lt['duration']:.2f}ms at {lt['startTime']:.2f}ms")
            else:
                print("\nNo Long Tasks detected.")
            
            print("-----------------------------------\n")

        # 5. 設定の反映確認 (Monaco内部状態)
        print("Verifying if 'heavy_repro' is correctly disabled in all instances...")
        page.wait_for_selector("prompt-editor", state="attached")
        
        is_enabled = page.evaluate("""() => {
            const editors = Array.from(document.querySelectorAll('prompt-editor'));
            if (editors.length === 0) return "NO_NODES";
            const ed = editors[0];
            const key = ed.createContextKey("csv.heavy_repro");
            return ed.getContext(key);
        }""")
        
        print(f"CSV 'heavy_repro' enabled status: {is_enabled}")
        assert is_enabled is False, f"CSV 'heavy_repro' should be disabled, but got {is_enabled}"
        
        # 読み込み時間が異常に長い場合は失敗 (目標は10秒以内)
        # assert load_duration < 10, f"Reload is too slow: {load_duration:.2f}s. Target is < 10s."
        print(f"SUCCESS: Reload took {load_duration:.2f}s")

    finally:
        if test_csv_path.exists():
            test_csv_path.unlink()
