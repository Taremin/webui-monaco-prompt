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
