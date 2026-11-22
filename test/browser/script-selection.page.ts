// Real VM and Scratch Blocks fixture for selecting several scripts. All input stays inside the headless page.
import styles from '../../src/styles.css';
import {attachCodeWorkspace} from '../../dist/workspace.js';

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
    broadcasts: {}, blocks: serializeBlocks(blocks), comments: {},
    costumes: [{name: 'blank', assetId: '00000000000000000000000000000000',
        md5ext: '00000000000000000000000000000000.svg', dataFormat: 'svg', rotationCenterX: 0, rotationCenterY: 0}],
    sounds: [], currentCostume: 0,
    volume: 100, layerOrder: isStage ? 0 : 1, tempo: 60, videoTransparency: 50, videoState: 'on',
    visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'});
const script = (id: string, x: number, y: number) => ({
    [id]: block(id, 'event_whenkeypressed', {topLevel: true, x, y, next: `${id}-body`,
        fields: {KEY_OPTION: {name: 'KEY_OPTION', value: 'space'}}}),
    [`${id}-body`]: block(`${id}-body`, 'looks_show', {parent: id})
});

(globalThis as any).setup = async () => {
    const style = document.createElement('style');
    style.textContent = styles as unknown as string;
    document.head.append(style);
    const blocks = {
        ...script('a', 40, 40), ...script('b', 320, 40), ...script('c', 40, 300), ...script('d', 320, 300),
        caller: block('caller', 'event_whenflagclicked', {topLevel: true, x: 600, y: 40, next: 'call'}),
        call: block('call', 'procedures_call', {parent: 'caller', mutation: procedureMutation()}),
        definition: block('definition', 'procedures_definition', {topLevel: true, x: 600, y: 300,
            inputs: {custom_block: {name: 'custom_block', block: 'prototype', shadow: 'prototype'}}}),
        prototype: block('prototype', 'procedures_prototype', {parent: 'definition', shadow: true,
            mutation: procedureMutation()})
    };
    const project = {targets: [target('Stage', true, {}), target('Sprite', false, blocks),
        target('Other', false, script('other', 40, 40))], monitors: [], extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: 'script-selection browser test'}};
    const host = await EditorRuntime.start(document.getElementById('workspace'), {locale: 'en', project});
    const {vm, workspace} = host;
    workspace.setScale(1);
    // Keep the test scripts outside the runtime's category palette.
    workspace.translate(310, 0);
    const errors: string[] = [];
    const bridge = attachCodeWorkspace({vm, ScratchBlocks: Blockly, workspace,
        options: {...workspace.options, media: './media/', zoom: {startScale: 1}},
        onError: (error: unknown) => errors.push(String(error))});
    const settle = async () => {
        Blockly.Events.fireNow_?.();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    };
    (globalThis as any).fixture = {
        vm, workspace, errors, settle,
        selected: () => [...document.querySelectorAll('.tw-plus-script-selected')].map(node => node.getAttribute('data-id')).sort(),
        /** Where the VM keeps each script's top block. */
        position(id: string) {
            const record = vm.editingTarget.blocks._blocks[id];
            return record ? {x: Math.round(record.x), y: Math.round(record.y)} : null;
        },
        exists: (id: string) => Boolean(vm.editingTarget.blocks._blocks[id]),
        undo: async () => {workspace.undo(false); await settle();},
        async switchTo(name: string) {
            vm.setEditingTarget(vm.runtime.targets.find((entry: any) => entry.getName() === name).id);
            await settle();
        },
        dispose() {bridge.dispose();}
    };
    await settle();
};
