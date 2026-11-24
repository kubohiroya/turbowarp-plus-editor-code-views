import './script-arrows.page.ts';
import {createCodePaneAdapter, createFunction} from '../../dist/code-pane.js';
import {attachCodeWorkspace} from '../../dist/workspace.js';
import {createCodeSession} from '../../dist/index.js';

declare const Blockly: any;

(globalThis as any).setupMultiview = async (withSharedViews = true) => {
    await (globalThis as any).setup();
    const {vm, workspace, arrows, settle} = (globalThis as any).fixture;
    arrows.dispose();
    const errors: string[] = [];
    const bridge = attachCodeWorkspace({vm, workspace, ScratchBlocks: Blockly,
        options: {...workspace.options, media: './media/'}, onError: error => errors.push(String(error))});
    workspace.removeChangeListener(vm.blockListener);
    workspace.addChangeListener(bridge.blockListener);
    vm.prependListener('workspaceUpdate', () => bridge.beforeReload());
    vm.on('workspaceUpdate', () => bridge.afterReload());
    bridge.afterReload();
    const adapter = createCodePaneAdapter(vm, 'en');
    const target = vm.editingTarget;
    const other = vm.runtime.targets.find(entry => entry.getName() === 'Secondary');
    const release: (() => void)[] = [];
    for (const [id, codeTarget] of [['a', target], ['b', target], ['other', other]] as const) {
        const container = document.createElement('div');
        container.dataset.syncPane = id;
        container.style.cssText = 'position:relative;width:450px;height:350px';
        document.body.append(container);
        release.push(adapter.renderInactive(container, {id, targetId: codeTarget.id, section: 0}));
    }
    const shared = createCodeSession({vm, workspace, ScratchBlocks: Blockly, document, locale: 'en', canUse: () => true,
        onError: error => errors.push(String(error)), receiveBackpackDrop: undefined});
    const messages = new Map<string, any[]>();
    for (const [id, codeTarget] of (withSharedViews ? [['a', target], ['b', target], ['other', other]] : []) as [string, any][]) {
        const received: any[] = [];
        const port = Object.assign(new EventTarget(), {start() {}, postMessage(message) {received.push(structuredClone(message));}});
        const close = shared.attach({target: codeTarget, mount: document.body, port, close: () => close()});
        release.push(close);
        messages.set(id, received);
    }
    (globalThis as any).syncFixture = {
        vm, workspace, target, other, errors,
        async rename(id: string) {
            const prototype = workspace.getBlockById(id).getInputTargetBlock('custom_block');
            const mutation = prototype.mutationToDom();
            mutation.setAttribute('proccode', 'renamed function');
            Blockly.Procedures.mutateCallersAndPrototype(prototype.getProcCode(), workspace, mutation);
            Blockly.Events.fireNow_();
            await settle();
        },
        async remove(id: string) {
            workspace.getBlockById(id).dispose(false);
            Blockly.Events.fireNow_();
            await settle();
        },
        async undo(redo = false) {workspace.undo(redo); await settle();},
        updates(pane: string) {return messages.get(pane).filter(message => message.type === 'update');},
        async simultaneous() {
            await createFunction(vm, other.id, 'procedure', 'background function');
            const id = await createFunction(vm, target.id, 'procedure', 'foreground function');
            await settle();
            return {id, shown: Boolean(workspace.getBlockById(id))};
        },
        async createNative() {
            Blockly.Procedures.externalProcedureDefCallback = (mutation, apply) => {
                mutation.setAttribute('proccode', 'native function');
                apply(mutation);
            };
            Blockly.Procedures.createProcedureDefCallback_(workspace);
            Blockly.Events.fireNow_();
            await settle();
            return Object.values(target.blocks._blocks).find((block: any) => block.opcode === 'procedures_definition' &&
                target.blocks._blocks[block.inputs.custom_block.block].mutation.proccode === 'native function')?.id;
        },
        async create(background = false) {
            const id = await createFunction(vm, (background ? other : target).id, 'procedure', 'new function');
            await settle();
            return id;
        },
        async flush() {Blockly.Events.fireNow_(); await settle();},
        dispose() {release.forEach(stop => stop()); shared.dispose(); bridge.dispose();}
    };
    await settle();
};
