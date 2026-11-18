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
| `./detached-block-palette` | 別窓のブロックパレット。パレットの `grouping` を渡すと、パレットと同じくグループを子ブロックパレットで開き、固定できる |
| `./palette-category-reorder`・`./palette-category-search`・`./palette-dropdown-resize` | パレットのカテゴリの並べ替えと検索、パレットのドロップダウンの大きさの変更 |
| `./palette-category-groups` | ツールボックスで別の category を含む category をグループとして表示する。アイコンをクリックすると、要素を並べた子ブロックパレットを影つきで重ねて開く（横配置のパレットではアイコンの右に横並び、縦配置では下に縦並び）。外側をクリックすると閉じる。Scratch Blocks は入れ子の category を捨てるので、`flattenCategoryGroups(tree)` と `filterGroupedToolboxTree(tree, groups, filter)` で木を整え、`prepareGroupedToolboxTree(tree, {catalog, visible})` は、機能拡張が宣言したグループの入れ子化と表示するグループの絞り込みを含めて、これを一度に行う。`hasCategoryGroups(tree)` は木が category を入れ子にしているかを返す。`attachPaletteCategoryGroups(menu, options)` で子ブロックパレットを開く。その `selectionTarget(id)` は、自分のブロックを持たないグループの代わりに選ぶ category を返し、`syncButtons(openId)` はグループのアイコンの状態を付け直す。`reorder: true` では、グループの要素を長押しして、同じグループの要素の中で並べ替えられる（子ブロックパレットの中でも、固定したグループの要素を広げた場所でも）（別のグループや階層へは動かさない）。順番はパレットを描き直しても保ち（`order` を渡せば、プロジェクトと一緒に保存するパレットの設定に保つ）、`prepare(tree, options)` はツールボックスをその順番で描かせ、`arrange(categories, rank)` がツールボックスの category をそれに合わせて、グループの後にその要素が続くように並べる。子ブロックパレットの右上にはピンがあり、押すとグループの要素を、そのグループを表示していたパレットのそのグループの直後に広げて固定する。固定したグループのアイコンにはピンが付き、押すと元のようにたたむ。固定は同じ `order` に保つので、それを渡したパレット同士は揃う。`splitExtensionCategories(tree, catalog, {nested: true})` は、グループを宣言した機能拡張をこのグループにする |
| `./palette-category-visibility`・`./palette-visibility-dialog` | スプライト・背景ごとに、パレットに出すブロックグループを選ぶ。設定はエディターの画面状態として保存し、選ぶ画面を持つ。ストアの `order`（`createPaletteOrder`）は、パレットのカテゴリーと各グループの要素を並べ替えた順番を保ち、同じ設定と一緒に保存する |
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

## スクリプト間の矢印

コードの背面に、関数呼び出しを紫系の実線、メッセージ送信を橙系の破線で表示する。「送って待つ」には待機の印を添える。通常配置、Z/N 配置、折り畳み、プレビュー、別窓で同じ表現を使う。関数の再帰はスクリプトの外へ回る線で示す。選択・ホバーによる強調は太さと不透明度で行い、関係種別の色・線種は変えない。

関係は作品データから読み、折り畳みによって表示から消えた呼び出しも保持する。展開中は呼び出しブロックから、折り畳み中は見えているハットから結ぶ。同じハットと宛先へ重なる呼び出しは件数を表示する。別スプライトや一スクリプト表示の外にある接続先は、画面端の案内から辿れる。変数などで呼び出し先が変わるものは「実行時に決定」と示し、見えていない既定値を宛先とみなさない。

スクリプトをドラッグしている間は、そこへ入る・そこから出る矢印を太く濃くし、画面にある相手のスクリプト全体を枠で強調する。関係しない矢印は薄くし、画面外の相手は接続先の案内を強調する。関数とメッセージの色・線種は維持する。折り畳み中も同じように働き、ドラッグの終了・矢印の非表示・画面の破棄で一時的な枠を解除する。移動中に Blockly がブロックを別の SVG へ移しても追従する。

`attachDockedScriptLayout` と `attachCodeWorkspace` のプレビュー・関数エディタには自動で付く。VM を持たない表示では、`attachScriptView` に `relations: {getTarget, getRelations, getTargetName, navigate}` を渡す。`getRelations` は親の `createCodeSession` が渡す `scriptRelations`、`getTarget` はその対象の `blocks` を使う。`getTargetName` は既存の対象一覧から名前を返し、同じメッセージを受信する別スプライトを案内で識別できるようにする。投影の受信後は `view.relations.update()` を呼ぶ。関係だけの更新は `relations`、接続先への移動は `relation-navigate`／`relation-focus` で既存の編集回収・対象切り替えを経由する。編集中の窓には履歴の更新のために XML を再読み込みさせない。

色は共通の CSS 変数 `--tw-script-function-stroke` と `--tw-script-message-stroke` に定義する。明暗テーマでは同じ種別のまま明度を変え、線種でも区別できる。既存の関数呼び出し図とミニマップも関数用の変数を使う。

既定は表示する。各コード画面の「呼び出しの矢印」を外すと表示を解除できる。作品の保存形式は変えない。完全に切り戻す場合は導入前のパッケージ固定と結線へ戻す。関連: [Editor #683](https://github.com/kubohiroya/turbowarp-plus-editor/issues/683)。

## 検証

`npm test` でビルドし、単体テストを実行し、React 16.14 より新しい API を使っていないことを確かめる。

`npm run test:browser` は、最小のエディター実行環境（`@kubohiroya/turbowarp-plus-editor-test-runtime`）で、Editor と同じ VM と Scratch Blocks を使い、パレットのグループとスクリプト間の矢印を Chromium で操作して確かめる。矢印は `node --test test/script-arrows.browser.ts` で限定実行でき、折り畳み・実際の関数エディタ・Z/N 配置・テーマ・別スプライトへの移動・キー入力の隔離をヘッドレスで検証する。`TWPE_CHROME_EXECUTABLE` を指定すると、Playwright のものの代わりにその Chromium を使う。

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
| `createPaletteVisibilityStore({catalog})` | 1つの作品の設定を、実行時の対象の ID ごとに持つ。名前を変えたスプライトも設定を保つ。`visible`・`set`・`copy`（複製）・`sets`・`addSets`、画面状態のスライスへの `capture(targets)` と `apply(value, targets)`、`reset` |
| `paletteScreenStateKey` | 画面状態のスライスの名前（`blockPalette`） |
| `filterToolboxTree(tree, visible, catalog)` | パレットを描く前のツールボックスの木から、出さないカテゴリを外す。カタログを渡すと、グループを宣言した機能拡張を先にグループごとのカテゴリに分ける（`splitExtensionCategories`） |
| `installExtensionPaletteGroups(runtime)`・`extensionPaletteCatalog(runtime._blockInfo)` | 機能拡張が宣言したグループを VM のカテゴリ情報に残し、読み込み済みの機能拡張のグループと、各ブロックの属するグループを一覧にする |
| `usedGroups(target, catalog)`・`groupOfOpcode(opcode, catalog)`・`defaultVisibleGroups(target, extensionGroups, catalog)` | コードが使っているグループとその数、設定のない対象に出すグループ |
| `paletteGroupSets(locale, projectSets)` | 「標準」「表現」「変数・リスト」「基本の制御」と、作品のセット |
| `attachPaletteMenuButton(menu, getLocale, getItems)` | カテゴリの一覧の末尾（横配置では右端、縦配置では下端）に ▼ のボタンを置く。押すと、ホストが渡す項目のメニューを出す。項目は「ブロックグループの表示・非表示の設定」（`paletteVisibilityMenuLabel`）と、ホストの機能拡張に関する項目 |

`./palette-visibility-dialog` の `openPaletteVisibilityDialog(document, props)` は「パレット内のブロックグループの表示・非表示の設定」の画面を開く。機能拡張の各行は `@kubohiroya/turbowarp-extension-security-dialog/react` の `ExtensionRow` で描くので、拡張の追加の画面と同じ見た目になる。画面は、「まとめて選ぶ」の欄に「設定のショートカット」（「標準」「表現」などのセット）と「設定のコピー元」を左右に並べ、その下に標準と機能拡張のブロックグループのチェックを並べる。ショートカットやコピー元にポインターを重ねるかフォーカスすると、それが選ぶグループのチェックが、そのチェックにポインターを重ねたときと同じ背景になる。「確定」を押すと、出すグループと、この画面で足したショートカットを `onApply` に渡して閉じる。`newSprite` を渡すと、追加したばかりのスプライトについて尋ねる画面になり、見出しの下に「新しいスプライト「名前」」と出す。あわせて `copySources`（作成済みのスプライトの名前と、それぞれが表示中のグループ）を渡すと、「設定のコピー元」に選ぶ一覧と「コピー」を出す。一覧は「スプライトを選ぶ」から始まり、スプライトを選んでいる間は、それが選ぶグループのチェックを強調したままにする。「コピー」を押すと、選んだスプライトのグループのうちこのスプライトに出せるものを、画面のチェックに写す。画面は閉じないので、利用者はチェックを足したり外したりしてから「確定」を押す。

ホストは `@kubohiroya/turbowarp-extension-security-dialog`（0.9.0 以上）を入れ、その `styles.css` も読み込む。設定を画面状態のスライスとして登録するのはホストの役目である。

### 1つの機能拡張の中のグループ

機能拡張は、ブロックをいくつかのグループに分け、グループごとに表示・非表示を選べるようにできる。`getInfo()` にグループを宣言し、各ブロックに `paletteGroup` を付ける。

```js
getInfo() {
    return {
        id: 'shapes', name: 'Shapes', color1: '#0fbd8c',
        groups: [{id: 'geometry', name: '図形', color1: '#ff8c1a', color2: '#db6e00', color3: '#c26200'}, {id: 'text', name: '文字'}],
        blocks: [
            {opcode: 'circle', blockType: 'command', text: 'circle', paletteGroup: 'geometry'},
            {opcode: 'write', blockType: 'command', text: 'write [TEXT]', paletteGroup: 'text', arguments: {/* ... */}},
            {opcode: 'reset', blockType: 'command', text: 'reset'}
        ]
    };
}
```

- 各グループはパレットのカテゴリ `shapes/geometry` になり、名前はグループの名前になる。設定もこの ID で記録する。`paletteGroup` のないブロック（宣言していないグループを指すものを含む）は、カテゴリ `shapes` に残る。
- グループの `id` は設定に記録する名前で、言語によって変わらない。`name` は利用者が読む表示名で、1つの文字列か、`{en: 'Speech\nand text', ja: 'セリフと\n文字'}` のような言語ごとの文字列を書く。エディターは、その言語の名前、同じ言語の名前、英語、最初の名前の順に選ぶ。`\n` は、カテゴリの一覧と設定の画面で改行になる（`resolveGroupName(name, locale)`。`extensionPaletteCatalog` に言語を渡す）。
- グループの `color1`・`color2`・`color3`・`menuIconURI` は省略でき、省略すると機能拡張のものを使う。ブロック自身の色はグループの色より優先する。
- 見出し・区切り・ボタンは、その次のブロックと同じグループに入る。オペコードは `shapes_circle` などのまま変わらないので、SB3 は変わらない。標準の TurboWarp と Scratch は `groups` と `paletteGroup` を無視し、1つのカテゴリとして表示する。
- ホストは、機能拡張を読み込む前に `installExtensionPaletteGroups(vm.runtime)` を呼び、`extensionPaletteCatalog(vm.runtime._blockInfo)` をストア、`filterToolboxTree`、`usedGroups` に渡す。設定の画面には、そのような機能拡張の項目の `groups` としてグループを渡す。画面は機能拡張の行の中に、グループごとのチェックを出す。

