// Real VM and Scratch Blocks fixture for script relationship drawing. All input stays inside the headless page.
import styles from '../../src/styles.css';
import {attachScriptArrows} from '../../dist/script-arrows.js';
import {setFoldedDefinition} from '../../dist/procedure-edits.js';
import {paintScripts, readScripts} from '../../dist/script-layout-workspace.js';
import {arrangeScripts} from '../../dist/script-layout.js';
import {attachScriptView} from '../../dist/script-layout-view.js';
import {attachCodeWorkspace} from '../../dist/workspace.js';
import {readScriptRelations} from '../../dist/script-relations.js';
import {attachWorkspaceOverview} from '../../dist/workspace-overview.js';

declare const EditorRuntime: any;
declare const Blockly: any;

const procedureMutation = () => ({tagName: 'mutation', children: [], proccode: 'jump',
    argumentids: '[]', argumentnames: '[]', argumentdefaults: '[]', warp: 'false'});
const block = (id: string, opcode: string, rest = {}) => ({id, opcode, inputs: {}, fields: {},
    next: null, parent: null, shadow: false, topLevel: false, ...rest});
const serializeBlocks = (blocks: object) => Object.fromEntries(Object.entries(blocks).map(([id, data]) => {
    const {id: _id, ...record} = data;
    return [id, {...record,
        fields: Object.fromEntries(Object.entries(record.fields).map(([name, field]: [string, any]) =>
            [name, field.id ? [field.value, field.id] : [field.value]])),
        inputs: Object.fromEntries(Object.entries(record.inputs).map(([name, input]: [string, any]) =>
            [name, input.shadow === input.block ? [1, input.block] : input.shadow ?
                [3, input.block, input.shadow] : [2, input.block]]))}];
}));
const target = (name: string, isStage: boolean, blocks: object) => ({name, isStage, variables: {}, lists: {},
    broadcasts: isStage ? {message: 'go'} : {}, blocks: serializeBlocks(blocks), comments: {},
    costumes: [{name: 'blank', assetId: '00000000000000000000000000000000',
        md5ext: '00000000000000000000000000000000.svg', dataFormat: 'svg', rotationCenterX: 0, rotationCenterY: 0}],
    sounds: [], currentCostume: 0,
    volume: 100, layerOrder: isStage ? 0 : 1, tempo: 60, videoTransparency: 50, videoState: 'on',
    visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'});
const receiver = (id: string, x: number, y: number) => ({
    [id]: block(id, 'event_whenbroadcastreceived', {topLevel: true, x, y, next: `${id}-body`,
        fields: {BROADCAST_OPTION: {name: 'BROADCAST_OPTION', value: 'go', id: 'message'}}}),
    [`${id}-body`]: block(`${id}-body`, 'looks_show', {parent: id})
});

(globalThis as any).setup = async () => {
    const style = document.createElement('style');
    style.textContent = styles as unknown as string;
    document.head.append(style);
    const primary = {
        start: block('start', 'event_whenflagclicked', {topLevel: true, x: 30, y: 40, next: 'call-1'}),
        'call-1': block('call-1', 'procedures_call', {parent: 'start', next: 'call-2', mutation: procedureMutation()}),
        'call-2': block('call-2', 'procedures_call', {parent: 'call-1', next: 'send', mutation: procedureMutation()}),
        send: block('send', 'event_broadcast', {parent: 'call-2', next: 'wait',
            inputs: {BROADCAST_INPUT: {name: 'BROADCAST_INPUT', block: 'send-menu', shadow: 'send-menu'}}}),
        'send-menu': block('send-menu', 'event_broadcast_menu', {parent: 'send', shadow: true,
            fields: {BROADCAST_OPTION: {name: 'BROADCAST_OPTION', value: 'go', id: 'message'}}}),
        wait: block('wait', 'event_broadcastandwait', {parent: 'send',
            inputs: {BROADCAST_INPUT: {name: 'BROADCAST_INPUT', block: 'wait-menu', shadow: 'wait-menu'}}}),
        'wait-menu': block('wait-menu', 'event_broadcast_menu', {parent: 'wait', shadow: true,
            fields: {BROADCAST_OPTION: {name: 'BROADCAST_OPTION', value: 'go', id: 'message'}}}),
        definition: block('definition', 'procedures_definition', {topLevel: true, x: 400, y: 50, next: 'recursive',
            inputs: {custom_block: {name: 'custom_block', block: 'prototype', shadow: 'prototype'}}}),
        prototype: block('prototype', 'procedures_prototype', {parent: 'definition', shadow: true,
            mutation: procedureMutation()}),
        recursive: block('recursive', 'procedures_call', {parent: 'definition', mutation: procedureMutation()}),
        unrelated: block('unrelated', 'event_whenkeypressed', {topLevel: true, x: 400, y: 420,
            fields: {KEY_OPTION: {name: 'KEY_OPTION', value: 'space'}}, next: 'unrelated-body'}),
        'unrelated-body': block('unrelated-body', 'looks_hide', {parent: 'unrelated'}),
        ...receiver('receive', 700, 120)
    };
    const project = {targets: [target('Stage', true, {}), target('Primary', false, primary),
        target('Secondary', false, receiver('remote-receive', 150, 70))], monitors: [], extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: 'script-arrows browser test'}};
    const host = await EditorRuntime.start(document.getElementById('workspace'), {locale: 'en', project});
    const {vm, workspace} = host;
    const primaryTarget = vm.editingTarget;
    const secondaryTarget = vm.runtime.targets.find((entry: any) => entry.getName() === 'Secondary');
    workspace.setScale(1);
    // Keep the test scripts outside the runtime's category palette.
    workspace.translate(310, 0);
    let arrows = attachScriptArrows({workspace, vm, getTarget: () => vm.editingTarget, getLocale: () => 'en'});
    let scriptView: ReturnType<typeof attachScriptView> | undefined;
    let overview: ReturnType<typeof attachWorkspaceOverview> | undefined;
    let bridge: ReturnType<typeof attachCodeWorkspace> | undefined;
    let procedure: ReturnType<ReturnType<typeof attachCodeWorkspace>['editProcedure']> | undefined;
    const integrationErrors: string[] = [];
    let centeredScript: string | undefined;
    let projection: HTMLDivElement | undefined;
    const settle = async () => {
        arrows.update();
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    };
    const fold = async (id: string, value: boolean, removeBody = false) => {
        const record = vm.editingTarget.blocks._blocks[id];
        setFoldedDefinition(record, value);
        const hat = workspace.getBlockById(id);
        const body = hat?.getNextBlock();
        if (removeBody && value) {
            Blockly.Events.disable();
            try {body?.dispose(false);} finally {Blockly.Events.enable();}
        } else body?.getSvgRoot()?.toggleAttribute('data-tw-plus-hidden', value);
        vm.runtime.emit('PROJECT_CHANGED');
        await settle();
    };
    (globalThis as any).fixture = {
        get arrows() {return arrows;}, vm, workspace, host, fold, settle,
        async attachOverview() {
            overview?.dispose();
            overview = attachWorkspaceOverview({workspace, ScratchBlocks: Blockly});
            await settle();
        },
        disposeOverview() {overview?.dispose();},
        async attachLayout() {
            arrows.dispose();
            scriptView?.dispose();
            scriptView = attachScriptView({workspace, ScratchBlocks: Blockly, getLocale: () => 'en',
                relations: {vm, getTarget: () => vm.editingTarget}, hasWorkspaceMenu: () => false});
            arrows = scriptView.relations!;
            await settle();
        },
        async layout(value: 'free' | 'z' | 'n') {scriptView?.setView(value); await settle();},
        async attachCatalogContext() {
            arrows.dispose();
            const relations = readScriptRelations(vm.runtime.targets);
            const catalog = new Map<string, string>(vm.runtime.targets.map((entry: any) => [entry.id, entry.getName()]));
            arrows = attachScriptArrows({workspace, getTarget: () => primaryTarget,
                getRelations: () => relations, getTargetName: id => catalog.get(id), getLocale: () => 'en'});
            await settle();
        },
        async attachProcedure() {
            arrows.dispose();
            const center = workspace.centerOnBlock;
            workspace.centerOnBlock = function (id: string) {centeredScript = id; return center.call(this, id);};
            bridge = attachCodeWorkspace({vm, ScratchBlocks: Blockly, workspace,
                options: {...workspace.options, media: './media/', zoom: {startScale: 1}},
                onError: (error: unknown) => integrationErrors.push(String(error))});
            const element = document.createElement('div');
            element.dataset.arrowTestProcedure = '';
            element.style.cssText = 'position:absolute;left:420px;top:100px;width:700px;height:400px;background:white';
            document.body.append(element);
            procedure = bridge.editProcedure(element, {target: primaryTarget, definitionId: 'definition',
                editable: true, locale: 'en'});
            await settle();
        },
        async toggleProcedureFold() {
            const options: {callback(): void}[] = [];
            procedure!.workspace.getBlockById('definition').customContextMenu(options);
            options[0].callback();
            await settle();
        },
        procedureHasBlock(id: string) {return Boolean(procedure?.workspace.getBlockById(id));},
        procedureErrors() {return integrationErrors;},
        focusedScript() {return bridge?.focusedScript;},
        lastCenteredScript() {return centeredScript;},
        async disposeProcedure() {procedure?.dispose(); bridge?.dispose(); await settle();},
        async move(id: string, x: number, y: number) {
            workspace.getBlockById(id).moveBy(x, y);
            Blockly.Events.fireNow_();
            await settle();
        },
        async zoom(scale: number) {workspace.setScale(scale); await settle();},
        async scroll(x: number, y: number) {workspace.translate(x, y); await settle();},
        async switchTarget(secondary: boolean) {
            vm.setEditingTarget((secondary ? secondaryTarget : primaryTarget).id);
            await settle();
        },
        async reload() {host.refreshBlockViews([vm.editingTarget]); await settle();},
        async rtl(value: boolean) {
            workspace.RTL = value;
            workspace.options.RTL = value;
            host.refreshBlockViews([vm.editingTarget]);
            await settle();
        },
        async moveStart(x: number, y: number) {
            workspace.getBlockById('start')?.moveBy(x, y);
            Blockly.Events.fireNow_();
            await settle();
        },
        moveStartWithoutUpdate(x: number, y: number) {
            workspace.getBlockById('start')?.moveBy(x, y);
            Blockly.Events.fireNow_();
        },
        async presentation(scale: number, x: number, y: number) {
            workspace.setScale(scale);
            workspace.translate(x, y);
            await settle();
        },
        async hideScript(id: string, value: boolean) {
            workspace.getBlockById(id)?.getSvgRoot()?.toggleAttribute('data-tw-plus-hidden', value);
            await settle();
        },
        async switchToSecondary() {vm.setEditingTarget(secondaryTarget.id); await settle();},
        async switchToPrimary() {vm.setEditingTarget(primaryTarget.id); await settle();},
        hasVMBlock(id: string) {return Boolean(vm.editingTarget.blocks._blocks[id]);},
        async project(view: 'z' | 'n' | null) {
            projection?.remove();
            projection = undefined;
            if (view) {
                projection = document.createElement('div');
                projection.dataset.arrowTestProjection = view;
                projection.style.cssText = 'position:absolute;inset:0;overflow:auto;background:white';
                document.body.append(projection);
                paintScripts(projection, arrangeScripts(readScripts(workspace), view, 'vertical'), workspace.scale);
                arrows.setProjection(projection.querySelector('svg'));
            } else arrows.setProjection(null);
            await settle();
        },
        async enable(value: boolean) {arrows.setEnabled(value); await settle();},
        async dispose() {arrows.dispose(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));}
    };
    await settle();
};
