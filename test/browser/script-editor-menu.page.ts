import './script-arrows.page.ts';
import {attachFunctionCallMenu} from '../../dist/code-pane.js';
import {attachDockedScriptLayout} from '../../dist/script-layout-view.js';
import {getCodeSession} from '../../dist/workspace.js';

declare const Blockly: any;

(globalThis as any).setupScriptMenu = async (locale = 'ja') => {
    await (globalThis as any).setup();
    const {workspace, vm, arrows, settle} = (globalThis as any).fixture;
    arrows.dispose();
    const layout = attachDockedScriptLayout({workspace, vm, ScratchBlocks: Blockly, locale, canUse: () => true});
    const opened: {kind: string; id: string; block?: string; section?: string}[] = [];
    const detach = attachFunctionCallMenu(Blockly, {
        label: () => locale === 'ja' ? 'この関数を表示' : 'Show this function',
        find: id => ['call-1', 'call-2', 'recursive'].includes(id) ? 'definition' : undefined,
        open: id => opened.push({kind: 'callee', id}),
        scriptEditor: {vm, locale, open: (id, block, section) => opened.push({kind: 'script', id, block, section})}
    });
    (globalThis as any).menuFixture = {
        workspace, vm, opened,
        async view(value: 'free' | 'z' | 'n') {layout.view.setView(value); await settle();},
        focused(value: boolean) {
            getCodeSession(vm).bridge = value ? {focusedScript: 'start'} as never : undefined;
        },
        show(id: string) {
            workspace.getBlockById(id).showContextMenu_(new MouseEvent('contextmenu', {clientX: 450, clientY: 240}));
        },
        prependOption() {
            const show = Blockly.ContextMenu.show;
            Blockly.ContextMenu.show = function (event, options, rtl) {
                options.unshift({text: 'Addon first item', enabled: true, callback() {}});
                return show.call(this, event, options, rtl);
            };
        },
        detach,
        dispose() {detach(); layout.dispose();}
    };
    await settle();
};
