import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {JSDOM} from 'jsdom';
import {createContextMenuIcons} from '../dist/context-menu-icons.js';

test('section menu icons use the host shared renderer for React and native Blockly menus', () => {
    const dom = new JSDOM('<div></div>');
    const requested: string[] = [];
    const icons = createContextMenuIcons({enabled: true, addonMessages: {}, styles: {icon: 'menu-icon'},
        renderSectionIcon: (section, className) => React.createElement('svg', {'data-section': section, className}),
        createSectionIcon(document, section, className) {
            requested.push(section);
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.classList.add(className);
            return icon;
        }});
    for (const section of ['functions', 'calls']) {
        const icon = icons.renderContextMenuIcon(section) as React.ReactElement;
        assert.equal(icon.props['data-section'], section);
        assert.equal(icon.props.className, 'menu-icon');
    }
    const blocks = {ContextMenu: {populate_: options => options}, WidgetDiv: {DIV: dom.window.document.querySelector('div')},
        Msg: {}, Constants: {Data: {VARIABLE_OPTION_CALLBACK_FACTORY: () => () => {}}}};
    icons.installBlockContextMenuIcons(blocks);
    const options = blocks.ContextMenu.populate_(['functions', 'calls'].map(section =>
        ({text: section, twPlusMenuIcon: section, enabled: true, callback() {}})));
    assert.deepEqual(requested, ['functions', 'calls']);
    assert.ok(options.every(option => option.text[0].classList.contains('menu-icon')));
    assert.deepEqual(options.map(option => option.text[1].textContent), ['functions', 'calls']);
    dom.window.close();
});

test('disabled icons keep native menu population unchanged', () => {
    const icons = createContextMenuIcons({enabled: false, addonMessages: {}, styles: {icon: 'menu-icon'},
        renderSectionIcon: () => {throw new Error('Disabled icon renderer must not run');}});
    const populate = options => options;
    const blocks = {ContextMenu: {populate_: populate}};
    icons.installBlockContextMenuIcons(blocks);
    assert.equal(blocks.ContextMenu.populate_, populate);
    assert.equal(icons.renderContextMenuIcon('functions'), null);
});
