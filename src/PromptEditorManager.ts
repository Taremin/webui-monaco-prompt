import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import type { PromptEditor, PromptEditorSettings } from "./index";
import { allFeatures } from './languages/features';
import { composeLanguage } from './languages/composer';
import { baseConf, baseLanguage } from './languages/sd-prompt';

export class PromptEditorManager {
    // グループIDごとのマネージャインスタンスを保持
    private static groups = new Map<string, PromptEditorManager>();

    static {
        // バンドルを跨いでシングルトン状態を共有するためのグローバル初期化
        const g = (typeof window !== 'undefined' ? window : global) as any;
        if (!g.__PromptEditorManager_Groups) {
            g.__PromptEditorManager_Groups = new Map<string, PromptEditorManager>();
        }
        this.groups = g.__PromptEditorManager_Groups;
    }

    /**
     * グループIDに紐づくマネージャインスタンスを取得する
     * @param groupId 管理グループ。未指定の場合はデフォルトグループを返す
     */
    public static getGroup(groupId: string = "default"): PromptEditorManager {
        if (!this.groups.has(groupId)) {
            this.groups.set(groupId, new PromptEditorManager(groupId));
        }
        return this.groups.get(groupId)!;
    }

    public editors: Set<PromptEditor> = new Set();
    private currentSettings: Partial<PromptEditorSettings> = {};
    private lastAppliedFeaturesKey: string = "";

    private constructor(public readonly groupId: string) {}

    /**
     * エディタをグループに登録し、情報の同期と通知の購読を開始する
     */
    public register(editor: PromptEditor): void {
        this.editors.add(editor);
        
        // エディタからのユーザー操作による設定変更を購読
        editor.onSettingChange = (settings, force) => {
            this.updateSettings(settings, editor, force);
        };

        // 初回登録時にグループの現在設定を適用（無駄な通知を避けるため直接適用）
        if (Object.keys(this.currentSettings).length > 0) {
            editor.setSettings(this.currentSettings);
        }
    }

    /**
     * エディタをグループの管理から除外する
     */
    public unregister(editor: PromptEditor): void {
        this.editors.delete(editor);
        if (editor.onSettingChange) {
            editor.onSettingChange = undefined;
        }
    }

    /**
     * グループに属するすべてのエディタ設定を一括で更新・波及させる
     * @param settings 更新する設定の差分
     * @param sourceEditor 変更の起点となったエディタ。指定された場合、それ以外のエディタに配布する
     */
    public updateSettings(settings: Partial<PromptEditorSettings>, sourceEditor?: PromptEditor, force = false): void {
        this.currentSettings = { ...this.currentSettings, ...settings };
        
        // 全てのエディタに確定した設定を適用する（依頼元のエディタも含むことで一貫性を保証）
        // ただし、言語定義に関わる変更がある場合は各エディタ内での個別リビルドを抑制し、
        // 最後に一括リビルドを行う
        const skipRebuild = settings.languageFeatures !== undefined || settings.languagePreset !== undefined;
        for (const editor of this.editors) {
            editor.applySettings(settings, force, { skipRebuild });
        }

        // 言語定義に関わる変更（フィーチャーの切り替え等）があれば再構築を実行
        if (settings.languageFeatures !== undefined || settings.languagePreset !== undefined) {
            this.rebuildLanguage();
        }
    }

    /**
     * 現在のグループ設定に基づいてMonacoの言語定義を再構築し、各エディタに適用する
     */
    public rebuildLanguage(): void {
        if (this.editors.size === 0) return;

        // マネージャーの最新設定をソースとしてフィーチャーを特定
        // 循環参照等の理由で allFeatures が一時的に配列でない場合を考慮した防御的実装
        const features = Array.isArray(allFeatures) ? allFeatures : [];
        if (!Array.isArray(allFeatures)) {
            console.warn(`[PromptEditorManager:${this.groupId}] allFeatures is not an array during rebuild. This may suggest a circular dependency issue.`);
        }
        
        const enabledFeatures = features.filter(f => this.currentSettings.languageFeatures?.[f.id]);
        const featuresKey = enabledFeatures.map(f => f.id).sort().join(',');

        // 当面は単一グループを想定し、IDは固定
        const langId = 'composed-prompt';

        if (this.lastAppliedFeaturesKey !== featuresKey) {
            const { conf, language } = composeLanguage(baseConf, baseLanguage, enabledFeatures);
            monaco.languages.setMonarchTokensProvider(langId, language);
            monaco.languages.setLanguageConfiguration(langId, conf);
            
            this.lastAppliedFeaturesKey = featuresKey;
            console.log(`[PromptEditorManager:${this.groupId}] Language definition updated: ${featuresKey || 'base'}`);
        }

        // 全インスタンスのモデル言語を composed-prompt に切り替え（既に設定されている場合はスキップ）
        for (const instance of this.editors) {
            if (!instance.monaco) continue;
            const model = instance.monaco.getModel();
            if (model && model.getLanguageId() !== langId) {
                monaco.editor.setModelLanguage(model, langId);
                instance.setContext(instance.createContextKey("language"), langId);
            }
        }
    }

    /**
     * 全ての登録済みグループに属する全エディタインスタンスに対してコールバックを実行する
     * (レガシーなグローバル走査の互換性、およびテスト用)
     */
    public static runAllInstances(callback: (instance: PromptEditor) => boolean|void): void {
        for (const manager of this.groups.values()) {
            for (const editor of manager.editors) {
                if (callback(editor)) return;
            }
        }
    }

    /**
     * エディタの所属グループを変更する
     */
    public static moveToGroup(editor: PromptEditor, fromGroupId: string, toGroupId: string): void {
        const fromGroup = this.groups.get(fromGroupId);
        if (fromGroup) {
            fromGroup.unregister(editor);
        }
        this.getGroup(toGroupId).register(editor);
    }

    /**
     * 現在のグループ設定を取得する（シリアライズ用など）
     */
    public getSettings(): Partial<PromptEditorSettings> {
        return { ...this.currentSettings };
    }
}
