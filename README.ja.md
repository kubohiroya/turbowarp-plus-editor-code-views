# TurboWarp Plus Editor Code Views

[English](README.md)

TurboWarp Plus Editor のコードの画面。1つの作品と1つの取り消し履歴を共有するタブと窓のコード、別窓に切り離したブロックパレット、スクリプトの整列とスクリプト表示、関数の編集、拡張が自分で描くブロックの入力欄の編集を持つ。どの関数も VM・Blockly のワークスペース・`ScratchBlocks` をホストから受け取り、GUI のモジュールを import しない。

## 入口

| import | 内容 |
| --- | --- |
| `.` | `createCodeSession`（VM とほかの表示と同期する、対象の編集できる表示）、`refreshExternalBlockViews`、`attachDockedCodeExtensions`、`attachStageCodePrewarm` |
| `./sprite-code-windows` | スプライトのタブの中のコードの窓とペイン（`attachCodeWorkspace`・`useSpriteCodeWindows`・`SpriteCodeProvider`・コードのペインのアダプター） |
| `./script-layout` | スクリプトの整列とスクリプト表示（`attachDockedScriptLayout`・`attachScriptView`） |
| `./code-extensions` | コードの表示の拡張パレットと、入力欄の操作のダイアログ |
| `./procedure-editor` | 関数の編集ダイアログ |
| `./variable-references` | 編集中の対象に絞った変数の参照 |
| `./target-combobox` | コードの窓の対象の選択 |
| `./detached-block-palette` | 別窓のブロックパレット |
| `./palette-category-reorder`・`./palette-category-search`・`./palette-dropdown-resize` | パレットのカテゴリの並べ替えと検索、パレットのドロップダウンの大きさの変更 |
| `./block-argument-text` | 長いテキストの引数を短く表示し、ダイアログで編集する |
| `./asset-edit-session`・`./dockview-unsaved` | 素材の編集のセッションと、Dockview のタブの未保存の印。ホストが GUI のエディターとレイアウトにつなぐ |
| `./styles.css` | 上のすべてのスタイルシート |

`@kubohiroya/turbowarp-plus-editor-code-views/styles.css` をグローバルなスタイルシートとして読み込む。アイコンのメニューとダイアログの操作ボタンに使う `@kubohiroya/turbowarp-plus-editor-windows` の `styles.css` もあわせて読み込む。

### ホストが渡すもの

`attachCodeWorkspace` と `attachDockedScriptLayout` は `presentationElements(injection)` を受け取る。これはワークスペースのまわりのホストの要素（`wrapper`・`extensionButton`・`watermark`）を返す。ドックしたスクリプトの整列は、透かしに `data-code-watermark`、拡張ボタンに `data-code-extension-button` の印を付け、スタイルシートはこの印で、ホバーで出す面と非アクティブな分割表示の中でそれらを隠す。

Editor は GUI の React 16 にこれらを描画するので、React 16.14 以降に対応する。

## 検証

`npm test` でビルドし、単体テストを実行し、React 16.14 より新しい API を使っていないことを確かめる。

## ライセンス

MPL-2.0。turbowarp-plus-editor の `packages/editor-views` と `packages/editor-ui` から移したコードで、同じ作者が書いたもの。移すときに GPL-3.0 から MPL-2.0 にした。由来の監査は [turbowarp-plus-packages の移行計画](https://github.com/kubohiroya/turbowarp-plus-packages/blob/main/docs/editor-migration-plan.ja.md)の「由来の監査（7b）」にある。
