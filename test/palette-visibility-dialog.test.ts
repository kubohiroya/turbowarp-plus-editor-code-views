import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {dom} from './jsdom-globals.ts';
import {openPaletteReplacementDialog} from '../dist/palette-visibility-dialog.js';

// jsdom's window keeps timers alive until it is closed.
after(() => dom.window.close());

test('the alternative prompts for the shown palette layout and hides groups only on confirmation', () => {
    let hidden = 0;
    let closed = 0;
    const openReplacement = () => {
        openPaletteReplacementDialog(document, {
            locale: 'ja', layoutName: '物語用', extensions: ['代替拡張'], groups: ['lists'],
            onHide() { hidden++; },
            onClose() { closed++; }
        });
        return document.querySelector('dialog.tw-palette-replacement-dialog');
    };
    let dialog = openReplacement();
    assert.equal(dialog.getAttribute('aria-label'), '標準のリストを隠しますか？');
    assert.match(dialog.textContent, /代替拡張.*物語用/u);
    dialog.querySelector('button').click();
    assert.equal(hidden, 0);
    dialog = openReplacement();
    dialog.dispatchEvent(new dom.window.Event('cancel', {cancelable: true}));
    assert.equal(hidden, 0);
    dialog = openReplacement();
    dialog.querySelector('.tw-palette-visibility-apply').click();
    assert.equal(hidden, 1);
    assert.equal(closed, 3);
    assert.equal(document.querySelector('dialog.tw-palette-replacement-dialog'), null);
});
