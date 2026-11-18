// Focused-script fitting uses the real VM and Blockly without native input or external assets.
import styles from '../../src/styles.css';
import {fitScriptInWorkspace} from '../../dist/script-fit.js';
import {attachCodeWorkspace} from '../../dist/workspace.js';
import {createCodePaneAdapter} from '../../dist/code-pane.js';

declare const EditorRuntime: any;
declare const Blockly: any;

const block = (id: string, opcode: string, rest = {}) => ({id, opcode, inputs: {}, fields: {},
    next: null, parent: null, shadow: false, topLevel: false, ...rest});
const stack = (id: string, length: number, x: number, y: number) => {
    const result = {[id]: block(id, 'event_whenflagclicked', {topLevel: true, x, y, next: `${id}-0`})};
    for (let index = 0; index < length; index++) result[`${id}-${index}`] = block(`${id}-${index}`, 'looks_show', {
        parent: index ? `${id}-${index - 1}` : id, next: index + 1 < length ? `${id}-${index + 1}` : null
    });
    return result;
};
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
    sounds: [], currentCostume: 0, volume: 100, layerOrder: isStage ? 0 : 1, tempo: 60,
    videoTransparency: 50, videoState: 'on', visible: true, x: 0, y: 0, size: 100,
    direction: 90, draggable: false, rotationStyle: 'all around'});

(globalThis as any).setupFit = async ({rtl = false, minScale = .2, maxScale = 2, width = 900, height = 620} = {}) => {
    const style = document.createElement('style');
    style.textContent = styles as unknown as string;
    document.head.append(style);
    const mount = document.getElementById('workspace')!;
    mount.style.cssText = `position:absolute;inset:auto;left:80px;top:40px;width:${width}px;height:${height}px`;
    const mutation = {tagName: 'mutation', children: [], proccode: `wide ${'W'.repeat(180)}`,
        argumentids: '[]', argumentnames: '[]', argumentdefaults: '[]', warp: 'false'};
    const blocks = {...stack('small', 1, 700, 500), ...stack('medium', 18, -900, -600),
        ...stack('tall', 90, 1400, 2100), ...stack('unrelated', 120, 8000, 9000),
        wide: block('wide', 'procedures_definition', {topLevel: true, x: -1200, y: -1800,
            inputs: {custom_block: {name: 'custom_block', block: 'wide-prototype', shadow: 'wide-prototype'}}}),
        'wide-prototype': block('wide-prototype', 'procedures_prototype', {parent: 'wide', shadow: true, mutation})};
    const project = {targets: [target('Stage', true, {}), target('Fit', false, blocks)], monitors: [], extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: 'focused script browser test'}};
    const host = await EditorRuntime.start(mount, {locale: 'en', project});
    const {workspace, vm} = host;
    workspace.options.zoomOptions.minScale = minScale;
    workspace.options.zoomOptions.maxScale = maxScale;
    if (rtl) {
        workspace.RTL = true;
        workspace.options.RTL = true;
        host.refreshBlockViews([vm.editingTarget]);
    }
    const errors: string[] = [];
    let bridge: ReturnType<typeof attachCodeWorkspace> | undefined;
    let adapter: ReturnType<typeof createCodePaneAdapter> | undefined;
    const pane = {id: 'focused-fit', targetId: vm.editingTarget.id, section: 0};
    const frames = async () => {
        for (let index = 0; index < 4; index++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    };
    const attach = () => {
        bridge ??= attachCodeWorkspace({vm, ScratchBlocks: Blockly, workspace,
            options: {...workspace.options, media: './media/', zoom: {startScale: 1}},
            onError: (error: unknown) => errors.push(String(error))});
        return bridge;
    };
    const inspect = (id: string) => {
        const root = workspace.getBlockById(id)?.getSvgRoot();
        const metrics = workspace.getMetrics();
        const svg = workspace.getParentSvg().getBoundingClientRect();
        const rect = root?.getBoundingClientRect();
        return {scale: workspace.scale, scrollX: workspace.scrollX, scrollY: workspace.scrollY,
            box: rect && {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
                width: rect.width, height: rect.height},
            view: {left: svg.left + metrics.absoluteLeft, top: svg.top + metrics.absoluteTop,
                width: metrics.viewWidth, height: metrics.viewHeight,
                right: svg.left + metrics.absoluteLeft + metrics.viewWidth,
                bottom: svg.top + metrics.absoluteTop + metrics.viewHeight},
            hidden: root?.hasAttribute('data-tw-plus-hidden'), focused: bridge?.focusedScript,
            undo: workspace.undoStack_.length, errors: [...errors]};
    };
    (globalThis as any).fitFixture = {
        workspace, vm, host, inspect, frames,
        async fit(id: string) {const result = fitScriptInWorkspace(workspace, id, Blockly); await frames(); return result;},
        resizeMount(width: number, height: number) {
            // Leave Blockly's cached SVG size untouched until the operation under test refreshes it.
            mount.style.width = `${width}px`;
            mount.style.height = `${height}px`;
        },
        async focus(id: string, refit = false) {attach().focusScript(id, undefined, refit); await frames();},
        async adapterFocus(id: string, presentation?: {scale: number; x: number; y: number; visible: boolean}) {
            attach();
            adapter ??= createCodePaneAdapter(vm, 'en');
            adapter.focusPane(pane.id, id);
            adapter.restore(pane, presentation);
            await frames();
        },
        async manual(scale: number, x = 170, y = 90) {
            workspace.setScale(scale); workspace.translate(x, y); await frames();
        },
        async redraw() {host.refreshBlockViews([vm.editingTarget]); await frames();},
        async visible(value: boolean) {
            mount.style.display = value ? '' : 'none';
            if (value) Blockly.svgResize(workspace);
            await frames();
        },
        locations() {return Object.fromEntries(Object.entries(vm.editingTarget.blocks._blocks)
            .map(([id, record]: [string, any]) => [id, {x: record.x, y: record.y, parent: record.parent, next: record.next}]));},
        async dispose() {adapter?.forgetPane(pane.id); bridge?.dispose(); await frames();}
    };
    Blockly.svgResize(workspace);
    await frames();
};
