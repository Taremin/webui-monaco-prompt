# WebUI Monaco Prompt

これは AUTOMATIC1111 氏の [stable-diffusion-webui](https://github.com/AUTOMATIC1111/stable-diffusion-webui) と [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 用の拡張です。

プロンプトの編集をVSCodeでも使用されているエディタ実装 [Monaco Editor](https://microsoft.github.io/monaco-editor/) で行えるようにします。

## インストール

### AUTOMATIC1111 Stable Diffusion WebUI

`stable-diffusion-webui` の `Install from URL` からこのリポジトリのURL `https://github.com/Taremin/webui-monaco-prompt` を入力してインストールしてください。

### ComfyUI (Experimental)

下記の二通りからお好きな方法でインストールしてください。

1. `custom_nodes` にこのリポジトリを clone する
2. `ComfyUI Manager Menu` の `Install via Git URL` にこのリポジトリのURLを入力してインストールする

#### 以前のインストール方法

~~[Releases](https://github.com/Taremin/webui-monaco-prompt/releases) からzipファイルをダウンロードして `web/extensions` に展開してください。~~
v0.1.2からはこの方法ではインストールできなくなりました。

## 機能

- VIM キーバインディング対応 ([monaco-vim](https://github.com/brijeshb42/monaco-vim))
- 色付け機能
    - 標準表記
    - Dynamic Prompts拡張表記 
- オートコンプリート対応
    - デフォルトでは `danbooru.csv`, `extra-quality-tags.csv` を読み込んでいるので既に `a1111-sd-webui-tagcompete` を使用している方は違和感なく使えます
    - `<` を入力すると Extra Networks (HN/LoRA/LyCORIS) のみの候補を出せます
        - LyCORISは[a1111-sd-webui-lycoris](https://github.com/KohakuBlueleaf/
        a1111-sd-webui-lycoris)拡張導入時に使用可能です
        - **この機能は Deprecated (非推奨)になりました**
            - 今後のアップデートで削除される予定です
            - スニペットとモデル名サジェストを使用してください
- モデル名サジェスト
    - `Ctrl-M` から始まるショートカットキーでモデル名の挿入が行えます

      | モデル       | ショートカットキー     |
      |--------------|----------------------|
      | Checkpoint   | `Ctrl-M` -> `Ctrl-M` |
      | LoRA         | `Ctrl-M` -> `Ctrl-L` |
      | Embedding    | `Ctrl-M` -> `Ctrl-E` |
      | Hypernetwork | `Ctrl-M` -> `Ctrl-H` |
      | VAE          | `Ctrl-M` -> `Ctrl-A` |

- スニペット
    - `Ctrl-M` -> `Ctrl-S` で挿入可能
    - 詳細は後述

また、他にも Monaco に備わっている VSCode 互換のショートカットキーなども使用可能です。

### スニペット

スニペット(断片)はよく使う入力をテンプレートで行えるようにする機能です。

#### 追加方法

スニペットはこの拡張の `snippets` ディレクトリか、各カスタムノード/拡張機能以下の `snippets` ディレクトリに含まれる `.json` を読み込みます。

JSONのフォーマットは `{"label": string, "insertText": string, documentation: string}` か、その配列です。
`insertText` では下記のスニペット構文が使用可能です。
`documentation` では `Markdown` 及び一部の HTML タグが使用可能です。

#### 構文

スニペット構文は VSCode 互換のものが使用できます。
https://code.visualstudio.com/docs/editor/userdefinedsnippets#_snippet-syntax

#### ディレクトリ内のファイル一覧の挿入（動的展開機能）

`insertText` 内で `${dir:...}` タグを記述することで、そのスニペットを配置したカスタムノード配下の特定ディレクトリ内のファイル一覧を自動的に検索して選択肢やリストとして展開できます。

##### 構文
```text
${dir:パスパターン|option1=value1|option2=value2|...}
```

##### パラメータ・オプション
- **`dir` (位置引数 / 必須)**: 対象ディレクトリ・glob パターン（例: `wildcards/*.txt`, `@models/loras`）
  - パスに **`@models/<category>`**（例: `@models/loras`, `@models/diffusion_models`, `@models/checkpoints`, `@models/embeddings`）を指定すると、ComfyUI に登録されている追加パスを含むすべてのモデルファイル一覧を自動取得します。
- **`pattern` (任意)**: ファイル名に適用する抽出・置換用の正規表現（例: `pattern=\.[^.]+$`）
- **`replace` (任意)**: 置換後の文字列。`pattern` 指定時に `replace` を省略した場合はマッチ箇所が削除されます。
- **`format` (任意)**: 出力形式
  - `choice` (デフォルト): Monaco Editor 用の選択肢構文 `${1|opt1,opt2|}` に変換
  - `lines`: 改行区切りテキスト
  - `comma`: カンマ区切りテキスト
- **`var` / `index` / `num` (任意)**: `format=choice` の場合の変数番号を指定（デフォルト: `1`）。例: `var=2` → `${2|opt1,opt2|}`

##### 記述例
- **ワイルドカードの選択肢挿入（拡張子除去）**:
  `<include:${dir:wildcards/*.txt|pattern=\.[^.]+$|var=1|format=choice}>`
- **LoRA モデル選択肢の挿入**:
  `<lora:${dir:@models/loras|pattern=\.[^.]+$|var=1}:1.0>`
- **Diffusion Models 一覧を改行区切りで挿入**:
  `${dir:@models/diffusion_models|pattern=\.[^.]+$|format=lines}`

## ComfyUI カスタムノード

ComfyUI 環境において、プロンプトのパーツ化・テンプレート展開・動的フィルタリングを行える複数のカスタムノードを提供しています。

### ノード間の基本データフロー

```
[ MultiText ]
   │
   ├─ contents (テキストリスト)
   └─ json ───► [ JsonFilter ] ───► json ───► [ Template ] ───► contents (展開済プロンプト)
```

1. **`MultiText`** でプロンプトやパーツアセットを仮想ファイルツリーとして定義・編集します。
2. 出力される **`json` メタデータ**（ファイル情報リスト）を **`JsonFilter`** に渡して条件抽出・絞り込みを行います。
3. 抽出結果を **`Template`** の `entry_points` または `source_templates` に渡し、`<include:...>` や `<random:...>` タグを再帰展開して最終的なプロンプトテキストを出力します。

---

### 各ノードの詳細

#### 1. MultiText (`WebuiMonacoPromptMultiText`)

仮想ファイルシステム形式（ディレクトリ・ファイルツリー）で複数テキストやプロンプトパーツを一括管理できる Monaco エディタノードです。

- **入力**:
  - `text`: Monaco エディタ内のツリー構造（JSON）
- **出力**:
  - `contents`: 有効なファイル本文の文字列リスト (`STRING` List)
  - `json`: 各ファイルのメタデータ（パス・ファイル名・本文）を含む JSON 文字列リスト (`STRING` List)
- **特徴**:
  - UI上のツリー構造でファイルを直感的に整理・編集できます。
  - チェックボックス (`selectionMode`) を有効にすると、チェックが入っているファイルのみを出力対象として選択できます。

#### 2. JsonFilter (`WebuiMonacoPromptJsonFilter`)

`MultiText` などの出力ポート `json` から渡されたファイルリストに対し、指定した判定ルールに基づいてフィルタリング（抽出）を行うノードです。

- **入力**:
  - `json_list`: `MultiText` などの `json` 出力ポートから接続するメタデータリスト (`STRING` forceInput)
  - `rules`: 抽出ルール設定（JSON形式）
- **出力**:
  - `contents`: 条件に一致したファイル本文の文字列リスト (`STRING` List)
  - `json`: 条件に一致したファイルの JSON メタデータリスト (`STRING` List)
- **フィルタリングルール**:
  - **判定対象 (`target`)**: ファイル名 (`name`) / ファイルパス (`path`) / 本文 (`content`)
  - **マッチ方式 (`mode`)**: 部分一致 (`include`) / 正規表現 (`regex`)
  - **否定 (`not`)**: 反転判定
  - **結合条件 (`operator`)**: `AND` / `OR`

#### 3. Template (`WebuiMonacoPromptTemplate`)

`MultiText` や `JsonFilter` から受け取った `json` メタデータをもとに、ファイル内のテンプレートタグ（`<include:...>` や `<random:...>`）を再帰的に展開して最終的なプロンプトを構築するノードです。

- **入力**:
  - `source_templates`: 参照先（挿入元）となるテンプレートファイル群の `json` リスト (`STRING` forceInput)
  - `entry_points`: 展開の起点となるファイル群の `json` リスト (`STRING` forceInput)
  - `seed`: `<random:...>` タグのランダム選出に使用するシード値 (`INT`)
- **出力**:
  - `contents`: テンプレート展開後のプロンプト文字列リスト (`STRING` List)
  - `json`: 展開後の各ファイル情報の JSON メタデータリスト (`STRING` List)

##### テンプレート構文

- **`<include:ファイル参照>`** (再帰的ファイル取り込み):
  指定したファイルの内容をその場に展開・挿入します。
  - **例**: `A photo of <include:character/master.txt>, <include:bg/fantasy.txt>`
  - 挿入されたテキスト内にさらに `<include:...>` や `<random:...>` が含まれる場合、自動的に再帰展開されます。

- **`<random:ファイル参照>`** (行単位のランダム選出):
  指定したファイル内のテキスト行（空行を除く）から、1行をランダムに選出して挿入します。
  - **例**: `Wearing <random:clothing/costumes.txt> standard outfit`
  - 選択結果は `seed` ポートの値に依存するため、シード値を固定すれば常に同じ結果を再現できます。

##### ファイル参照の指定方法
`<include:参照名>` や `<random:参照名>` での参照指定は柔軟に対応しています：
1. **完全パス指定**: `<include:scenes/fantasy/forest.txt>`
2. **拡張子省略**: `<include:scenes/fantasy/forest>`
3. **ファイル名（ベースネーム）指定**: `<include:forest.txt>`
4. **ファイル名（拡張子なし）指定**: `<include:forest>`

##### 安全機能
- **循環参照の自動検知**: AファイルがBファイルを呼び出し、BファイルがAファイルを呼び出すような無限ループを検知して安全にエラーを出力します。
- **再帰深さ上限**: 最大深さ（10階層）を超えた展開をブロックし、スタックオーバーフローを防止します。

#### 4. Find (`WebuiMonacoPromptFind`) [Deprecated]

ワークフロー内のすべての Monaco エディタ（`MultiText` ノード内部の全ファイル含む）を横断してテキストを検索するノードです。

- **ステータス**: **Deprecated (非推奨)**
- **経緯**: 検索機能が ComfyUI のサイドツールバー（UI拡張機能）へ移行したため、ノードとしては非推奨となっています。

#### 5. Replace (`WebuiMonacoPromptReplace`)

ワークフロー内のすべての Monaco エディタ（`MultiText` ノード内部の全ファイル・タブ含む）を一括して検索・置換するノードです。

- **機能**: 入力した検索文字列と置換文字列に基づき、キャンバス上の Monaco エディタ全体に対して一括置換を実行します。`MultiText` ノード内の非活性なファイルタブに含まれるテキストも置換対象となります。
- **備考**: 将来的に ComfyUI のサイドツールバー機能への統合が予定されています。

## サンプルワークフロー

`examples/workflows` ディレクトリに ComfyUI 用のサンプルワークフロー JSON を同梱しています。
ComfyUI の画面に JSON ファイルをドラッグ＆ドロップすることで、設定済みのノード群をそのまま読み込んで動作確認が可能です。

- **[v0.4.0 フル機能連携デモ](./examples/workflows/v0.4.0_multitext_filter_demo.json)** (`examples/workflows/v0.4.0_multitext_filter_demo.json`)
  - **使用ノード**: `MultiText` → `JsonFilter` → `Template` → `PreviewAny`
  - **概要**: 
    1. **MultiText**: パーツアセット（キャラ/背景/品質タグ）と、それらを `<include:...>` で組み立てた完成形シーン定義（`scenes/`）を一括管理。
    2. **JsonFilter**: パス条件（`scenes/` かつ `fantasy`）を指定し、対象のシーンテンプレートのみを動的に選択・抽出。
    3. **Template**: 選択されたシーンテンプレートの `<include:...>` タグを再帰的に展開し、最終プロンプトを構築。






## 注意

### AUTOMATIC1111 Stable Diffusion WebUI

この拡張では標準のプロンプト編集で使用するtextareaを差し替えたり Extra Networks のリフレッシュへの対応などで、特定のHTML要素に依存したあまり汎用的でない手段を用いています。
そのため、HTML構造が変化したり既存機能の変更が行われた場合、利用できなくなることがあるかもしれません。
その場合は一時的に利用を中止することをおすすめします。

## その他

### 共通

ヘッダが邪魔な場合はエディタのコンテキストメニューから非表示にできます。（ヘッダで行える設定もコンテキストメニューから行えます。）

### AUTOMATIC1111 Stable Diffusion WebUI

設定はこの拡張のあるディレクトリの `settings` 内に保存されます。
認証未設定時は `global.json` 認証設定時は `user_[username].json` というファイル名です。

### オートコンプリート

`Language` が `plaintext` 以外の場合にCSVによる自動補完が有効になります。

#### CSV 追加方法

この拡張の `csv` ディレクトリにファイルを追加します。
A1111の場合は再読み込み、ComfyUIの場合は `Refresh` で使用できるようになります。

## クレジット

この拡張には [a1111-sd-webui-tagcomplete
](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete) のタグデータ(danbooru.csv, extra-quality-tags.csv)を同梱しています。

## ライセンス

[MIT](./LICENSE)
