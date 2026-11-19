import './script-arrows.page.ts';
import styles from '../../src/styles.css';
import {attachDockedScriptLayout} from '../../dist/script-layout-view.js';
import {readSemanticWorkspace} from '../../dist/semantic-layout-workspace.js';
import {createCodeSession} from '../../dist/index.js';
import {startCodePopout} from '../../dist/code-popout.js';
declare const Blockly: any;

(globalThis as any).setupSemantic = async (locale = 'en', comments = true) => {
    await (globalThis as any).setup();
    const f = (globalThis as any).fixture;
    const {vm, workspace} = f;
    f.arrows.dispose();
    document.documentElement.lang = locale;
    if (comments) {
        vm.editingTarget.createComment('attached-note', 'send', 'Keep this with the sender', 200, 70, 240, 160, false);
        vm.editingTarget.createComment('loose-note', null, 'This note stays fixed', 40, 500, 300, 200, false);
        vm.refreshWorkspace();
        await f.settle();
    }
    let allowed = true;
    const layout = attachDockedScriptLayout({workspace, vm, ScratchBlocks: Blockly, locale, canUse: () => allowed});
    await f.flush(); workspace.clearUndo();
    const saved = () => JSON.parse(vm.toJSON());
    const geometry = () => {
        const result = readSemanticWorkspace(workspace);
        return {scripts: result.scripts.map(({id, x, y, width, height, origin, bounds}) =>
            ({id, x, y, width, height, origin, bounds})), comments: result.comments.map(({id, rootId, x, y, origin}) =>
            ({id, rootId, x, y, origin}))};
    };
    (globalThis as any).semanticFixture = {
        ...f, geometry, saved,
        background() {workspace.showContextMenu_(new MouseEvent('contextmenu', {clientX: 460, clientY: 280}));},
        async view(value) {layout.view.setView(value); await f.settle();},
        allow(value) {allowed = value;},
        readOnly(value) {workspace.options.readOnly = value;},
        changeCode() {
            // Same block geometry; only the static program changes.
            vm.editingTarget.blocks._blocks['call-1'].mutation.proccode = 'missing';
            vm.runtime.emit('PROJECT_CHANGED');
        },
        async undo(redo = false) {workspace.undo(redo); await f.flush();},
        async reloadSaved() {await vm.loadProject(vm.toJSON()); await f.settle();},
        failNextMove() {
            const block = workspace.getBlockById('definition');
            const move = block.moveBy;
            block.moveBy = function (...args) {block.moveBy = move; move.apply(this, args); throw new Error('test move failure');};
        },
        async disposeLayout() {layout.dispose(); await f.settle();}
    };
    (globalThis as any).semanticFixture.openPopout = () => {
        const session = createCodeSession({vm, workspace, ScratchBlocks: Blockly, document, locale,
            canUse: () => true, onError: error => {throw error;}});
        const child = window.open('/#semantic-layout-test');
        const ready = event => {
            if (event.source !== child || event.data?.type !== 'stage2/ready') return;
            window.removeEventListener('message', ready);
            const channel = new MessageChannel();
            session.attach({target: vm.editingTarget, mount: {ownerDocument: child.document}, port: channel.port1,
                close: () => {session.dispose(); child.close();}});
            child.postMessage({type: 'stage2/connect', ticket: 'semantic-layout-test'}, location.origin, [channel.port2]);
        };
        window.addEventListener('message', ready);
    };
};

if (location.hash === '#semantic-layout-test') {
    const style = document.createElement('style'); style.textContent = styles as unknown as string; document.head.append(style);
    document.body.innerHTML = `<header style="position:absolute;inset:0 0 auto;height:80px;z-index:10;background:white;display:flex;align-items:center;gap:10px">
        <div id="target-picker"></div><p id="rename-error" hidden></p><p id="status"></p>
        <button id="undo">Undo</button><button id="redo">Redo</button><button id="dock">Dock</button>
        <div id="popup-layout"></div></header><div id="workspace-area" style="position:absolute;inset:80px 0 0">
        <div id="mount" style="height:100%"></div><div id="drop-zone" hidden></div></div>`;
    startCodePopout({ScratchBlocks: Blockly, PopupLayout: () => null, attachWorkspaceNavigation: () => ({dispose() {}}),
        installBlockContextMenuIcons() {}, readStartupFlags: () => ({contextMenuIcons: false})});
}
