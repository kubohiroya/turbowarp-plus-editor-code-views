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
| `./variable-merge` | 名前の変更で変数・リストを既存のものに統合し、パレットから「このスプライトのみ」と「すべてのスプライト用」を切り替える |
| `./target-combobox` | コードの窓の対象の選択 |
| `./detached-block-palette` | 別窓のブロックパレット |
| `./palette-category-reorder`・`./palette-category-search`・`./palette-dropdown-resize` | パレットのカテゴリの並べ替えと検索、パレットのドロップダウンの大きさの変更 |
| `./palette-category-visibility`・`./palette-visibility-dialog` | スプライト・背景ごとに、パレットに出すブロックグループを選ぶ。設定はエディターの画面状態として保存し、選ぶ画面を持つ |
| `./block-argument-text` | 長いテキストの引数を短く表示し、ダイアログで編集する。テキストの引数で Shift+Enter を押すと、改行を入れてダイアログで編集を続ける |
| `./block-number-input` | 数値の引数に入力した全角の数字・記号を半角にする |
| `./clean-up-comments` | 「きれいにする」でコメントをスクリプトについて動かす。ブロックのコメントはブロックとの相対位置を保ち、コメントを含めたスクリプト同士が重ならないようにし、スクリプトに重なるワークスペースのコメントはスクリプトの横へ移す（`installCleanUpComments(ScratchBlocks)`） |
| `./target-undo-history` | コードエリアの元に戻す・やり直しの履歴を、スプライト・ステージごとに保ち、切り替えて戻ったときに返す（`attachTargetUndoHistory({vm, getBlockly})`）。履歴を返すのは、離れたときからその対象のコードが変わっていない場合に限る |
| `./sprite-restore-history` | 「編集 → スプライトの復元」で、直前の1件だけでなく、削除した最近の10件まで順に戻せるようにする（`attachSpriteRestoreHistory({store, vm})`、GUI の Redux ストアを渡す） |
| `./sprite-copy-notice` | `attachSpriteCopyNotice`。スプライト一覧の上で離したスクリプトがスプライトや背景にコピーされたとき、そのタイルに印を付け、コピー先を示す通知を出す。通知の「元に戻す」でコピーを取り除く |
| `./asset-edit-session`・`./dockview-unsaved` | 素材の編集のセッションと、Dockview のタブの未保存の印。ホストが GUI のエディターとレイアウトにつなぐ |
| `./styles.css` | 上のすべてのスタイルシート |

`@kubohiroya/turbowarp-plus-editor-code-views/styles.css` をグローバルなスタイルシートとして読み込む。アイコンのメニューとダイアログの操作ボタンに使う `@kubohiroya/turbowarp-plus-editor-windows` の `styles.css` もあわせて読み込む。

### ホストが渡すもの

`attachCodeWorkspace` と `attachDockedScriptLayout` は `presentationElements(injection)` を受け取る。これはワークスペースのまわりのホストの要素（`wrapper`・`extensionButton`・`watermark`）を返す。ドックしたスクリプトの整列は、透かしに `data-code-watermark`、拡張ボタンに `data-code-extension-button` の印を付け、スタイルシートはこの印で、ホバーで出す面と非アクティブな分割表示の中でそれらを隠す。

### 保存するコードエリア

コードのペインのアダプター（`createCodePaneAdapter`）は、workbench が保存する作業領域のために `serialize(pane, presentation?)` と `deserialize(pane, value)` を持つ。Editor はこの作業領域を SB3 に保存する。タブは、コードエリアのズーム・スクロール位置・スクリプト表示を `{scale, x, y, scriptView?}` として保存する。presentation がないとき、`serialize` は画面のコードエリアを変えずに読む。`deserialize` は `readSavedCodePane` で形を確かめ、コードエリアの操作部品の写しを含まない presentation を返す。プレビューは写しなしで描く。

Editor は GUI の React 16 にこれらを描画するので、React 16.14 以降に対応する。

## 検証

`npm test` でビルドし、単体テストを実行し、React 16.14 より新しい API を使っていないことを確かめる。

## ライセンス

MPL-2.0。turbowarp-plus-editor の `packages/editor-views` と `packages/editor-ui` から移したコードで、同じ作者が書いたもの。移すときに GPL-3.0 から MPL-2.0 にした。由来の監査は [turbowarp-plus-packages の移行計画](https://github.com/kubohiroya/turbowarp-plus-packages/blob/main/docs/editor-migration-plan.ja.md)の「由来の監査（7b）」にある。

## パレットに出すブロックグループ

スプライト・背景ごとに、パレットに出すブロックグループ（標準のグループと、機能拡張のグループ）を選べる。TypeScript で言えば、作品の `extensions` が package.json、スプライトごとの設定が各ファイルの import 文にあたる。

- 設定は作品のコードではなくエディターのもので、タブの配置と同じ画面状態に入る。SB3 では `tw-plus/workspace.json`、作品フォルダでは `.tw-plus/workspace.json` の `blockPalette` のスライスになる。スプライトはタブの配置と同じく名前で、背景は `stage` で記録する。
- 設定のないスプライト・背景は、標準のグループと、そのコードが使っている機能拡張のグループを出す。
- 非表示にしても、コード領域のブロックはそのまま見えて編集できる。

`./palette-category-visibility`

| 関数 | 内容 |
| --- | --- |
| `createPaletteVisibilityStore()` | 1つの作品の設定を、実行時の対象の ID ごとに持つ。名前を変えたスプライトも設定を保つ。`visible`・`set`・`copy`（複製）・`sets`・`addSets`、画面状態のスライスへの `capture(targets)` と `apply(value, targets)`、`reset` |
| `paletteScreenStateKey` | 画面状態のスライスの名前（`blockPalette`） |
| `filterToolboxTree(tree, visible)` | パレットを描く前のツールボックスの木から、出さないカテゴリを外す |
| `usedGroups(target)`・`groupOfOpcode(opcode)`・`defaultVisibleGroups(target, extensionIds)` | コードが使っているグループとその数、設定のない対象に出すグループ |
| `paletteGroupSets(locale, projectSets)` | 「標準」「表現」「変数・リスト」「基本の制御」と、作品のセット |
| `attachPaletteMenuButton(menu, getLocale, getItems)` | カテゴリの一覧の末尾（横配置では右端、縦配置では下端）に ▼ のボタンを置く。押すと、ホストが渡す項目のメニューを出す。項目は「ブロックグループの表示・非表示の設定」（`paletteVisibilityMenuLabel`）と、ホストの機能拡張に関する項目 |

`./palette-visibility-dialog` の `openPaletteVisibilityDialog(document, props)` は「パレット内のブロックグループの表示・非表示の設定」の画面を開く。機能拡張の各行は `@kubohiroya/turbowarp-extension-security-dialog/react` の `ExtensionRow` で描くので、拡張の追加の画面と同じ見た目になる。適用すると、出すグループと、この画面で足したセットを `onApply` に渡す。`newSprite` を渡すと、追加したばかりのスプライトについて尋ねる画面になり、「新しいスプライト「名前」」と「次回から尋ねない」のチェックを出す。チェックの値は `onApply` の `dontAskAgain` になる。

ホストは `@kubohiroya/turbowarp-extension-security-dialog`（0.9.0 以上）を入れ、その `styles.css` も読み込む。設定を画面状態のスライスとして登録するのはホストの役目である。1つの機能拡張の中を複数のグループに分けて選ぶ機能は、VM がグループごとのカテゴリを作れるようになってから足す。

