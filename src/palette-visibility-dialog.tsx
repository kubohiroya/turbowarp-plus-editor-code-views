import React from 'react';
import ReactDOM from 'react-dom';
import type {ReplaceablePaletteGroup} from './palette-category-visibility.ts';

const standardNames = {
    en: {motion: 'Motion', looks: 'Looks', sound: 'Sound', events: 'Events', control: 'Control', sensing: 'Sensing',
        operators: 'Operators', variables: 'Variables', lists: 'Lists', myBlocks: 'My Blocks'},
    ja: {motion: '動き', looks: '見た目', sound: '音', events: 'イベント', control: '制御', sensing: '調べる',
        operators: '演算', variables: '変数', lists: 'リスト', myBlocks: 'ブロック定義'}
};
const isJapanese = (locale?: string) => /^ja(?:-|$)/i.test(locale ?? '');

/** Asks whether to hide the standard groups an enabled extension offers to replace. */
export function openPaletteReplacementDialog(document: Document, {locale, layoutName, extensions, groups, onHide, onClose}: {
    locale?: string;
    /** The palette layout the groups are removed from. */
    layoutName: string;
    extensions: readonly string[];
    groups: readonly ReplaceablePaletteGroup[];
    onHide(): void;
    onClose(): void;
}): () => void {
    const ja = isJapanese(locale);
    const language = ja ? 'ja' : 'en';
    const names = standardNames[language];
    const groupNames = groups.map(group => names[group]).join(ja ? '・' : ' and ');
    const extensionNames = extensions.join(ja ? '、' : ', ');
    const title = ja ? `標準の${groupNames}を隠しますか？` : `Hide standard blocks for ${groupNames}?`;
    const detail = ja ? `${extensionNames} が代替を提供します。表示中のパレット「${layoutName}」から外します。` :
        `${extensionNames} offers an alternative. They are removed from the shown palette “${layoutName}”.`;
    const dialog = document.createElement('dialog');
    dialog.className = 'tw-palette-visibility-dialog tw-palette-replacement-dialog';
    dialog.setAttribute('aria-label', title);
    document.body.append(dialog);
    const close = () => {
        if (!dialog.isConnected) return;
        ReactDOM.unmountComponentAtNode(dialog);
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        dialog.remove();
        onClose();
    };
    dialog.addEventListener('cancel', event => {
        event.preventDefault();
        close();
    });
    ReactDOM.render(<div className="tw-palette-visibility">
        <header className="tw-palette-visibility-header"><h2>{title}</h2></header>
        <section>{detail}</section>
        <footer className="tw-palette-visibility-footer">
            <button type="button" autoFocus onClick={close}>{ja ? '表示したまま' : 'Keep visible'}</button>
            <button type="button" className="tw-palette-visibility-apply" onClick={() => {
                close();
                onHide();
            }}>{ja ? '隠す' : 'Hide'}</button>
        </footer>
    </div>, dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return close;
}
