import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {registerCodeWorkspace} from '../dist/code-workspace-registry.js';
import {applyPlan, attachVariableMerge, describePlan, describeRefusal, installVariableMerge, planMerge, planScopeChange,
    undoPlan, variableMergeMessages} from '../dist/variable-merge.js';

// Shapes from scratch-vm: Target.variables, Blocks._blocks with fields {name, id, value, variableType},
// sensing_of with its OBJECT menu shadow, and runtime.monitorBlocks.

const variable = (id, name, value = 0, type = '', isCloud = false) => ({id, name, type, value, isCloud});

const blocks = (list = []) => {
    const _blocks = Object.fromEntries(list.map(block => [block.id, block]));
    let resets = 0;
    return {
        _blocks,
        getBlock: id => _blocks[id],
        resetCache () {
            resets++;
        },
        get resets () {
            return resets;
        }
    };
};

const target = (id, name, isStage, vars = [], blockList = []) => ({
    id, isStage, isOriginal: true, sprite: {name},
    variables: Object.fromEntries(vars.map(v => [v.id, v])),
    blocks: blocks(blockList),
    getName: () => name
});

const reporter = (id, varId, name, field = 'VARIABLE') => ({
    id, opcode: field === 'LIST' ? 'data_listcontents' : 'data_variable', inputs: {},
    fields: {[field]: {name: field, id: varId, value: name, variableType: field === 'LIST' ? 'list' : ''}}
});

const setter = (id, varId, name) => ({
    id, opcode: 'data_setvariableto', inputs: {VALUE: {block: null, shadow: null}},
    fields: {VARIABLE: {name: 'VARIABLE', id: varId, value: name, variableType: ''}}
});

const sensingOf = (id, property, object, dynamic = false) => [
    {id, opcode: 'sensing_of', fields: {PROPERTY: {name: 'PROPERTY', value: property}},
        inputs: {OBJECT: {block: dynamic ? `${id}-r` : `${id}-m`, shadow: `${id}-m`}}},
    {id: `${id}-m`, opcode: 'sensing_of_object_menu', inputs: {}, fields: {OBJECT: {name: 'OBJECT', value: object}}}
];

const monitorBlocks = () => {
    const store = blocks();
    const shown = [];
    return Object.assign(store, {
        shown,
        createBlock (block) {
            store._blocks[block.id] = block;
        },
        deleteBlock (id) {
            delete store._blocks[id];
        },
        changeBlock ({id, element, value}) {
            if (element === 'checkbox') {
                store._blocks[id].isMonitored = value;
                shown.push([id, value]);
            }
        }
    });
};

const project = ({stageVars = [], stageBlocks = [], sprite1Vars = [], sprite1Blocks = [], sprite2Vars = [], sprite2Blocks = []} = {}) => {
    const stage = target('stage', 'Stage', true, stageVars, stageBlocks);
    const sprite1 = target('s1', 'Sprite1', false, sprite1Vars, sprite1Blocks);
    const sprite2 = target('s2', 'Sprite2', false, sprite2Vars, sprite2Blocks);
    const removed = [];
    let changed = 0;
    const runtime = {
        targets: [stage, sprite1, sprite2],
        getTargetForStage: () => stage,
        monitorBlocks: monitorBlocks(),
        requestRemoveMonitor: id => removed.push(id),
        emitProjectChanged: () => {
            changed++;
        }
    };
    const vm = {
        runtime, editingTarget: sprite1, workspaceUpdates: 0, targetsUpdates: 0, blockListener: () => {},
        emitWorkspaceUpdate () {
            this.workspaceUpdates++;
        },
        emitTargetsUpdate () {
            this.targetsUpdates++;
        }
    };
    return {vm, stage, sprite1, sprite2, removed, changes: () => changed};
};

const snapshot = ({stage, sprite1, sprite2}) => JSON.parse(JSON.stringify(
    [stage, sprite1, sprite2].map(t => ({variables: t.variables, blocks: t.blocks._blocks}))
));

test('merging a sprite variable into a global one rewrites its fields and "of" blocks, and undo restores them', () => {
    const p = project({
        stageVars: [variable('g', 'score', 5)],
        sprite1Vars: [variable('a', 'scor', 3)],
        sprite1Blocks: [reporter('r1', 'a', 'scor'), setter('s1b', 'a', 'scor')],
        sprite2Blocks: [...sensingOf('o1', 'scor', 'Sprite1'), ...sensingOf('o2', 'scor', 'Sprite2')]
    });
    const before = snapshot(p);
    const result = planMerge(p.vm, 'a', 'g');
    assert.equal(result.ok, true);
    const {plan} = result;
    assert.equal(plan.kind, 'merge');
    assert.deepEqual(plan.references, [{target: 'Sprite1', count: 2}]);
    assert.equal(plan.sensingReferences, 1);
    assert.deepEqual(plan.warnings, []);

    const record = applyPlan(p.vm, plan);
    assert.equal(p.sprite1.variables.a, undefined);
    assert.deepEqual(p.sprite1.blocks._blocks.r1.fields.VARIABLE, {name: 'VARIABLE', id: 'g', value: 'score', variableType: ''});
    assert.equal(p.sprite1.blocks._blocks.s1b.fields.VARIABLE.id, 'g');
    assert.equal(p.sprite2.blocks._blocks.o1.fields.PROPERTY.value, 'score');
    assert.equal(p.sprite2.blocks._blocks['o1-m'].fields.OBJECT.value, '_stage_');
    // An "of" block reading another sprite's variable of the same name is left alone.
    assert.equal(p.sprite2.blocks._blocks.o2.fields.PROPERTY.value, 'scor');
    assert.ok(p.sprite1.blocks.resets > 0);
    assert.ok(p.changes() > 0);

    undoPlan(p.vm, record);
    assert.deepEqual(snapshot(p), before);
});

test('a merge is refused when the remaining variable cannot be seen from every place that uses the other', () => {
    const p = project({
        stageVars: [variable('g', 'hp')],
        sprite1Vars: [variable('l', 'HP')],
        sprite1Blocks: [reporter('r1', 'g', 'hp')],
        stageBlocks: [reporter('r2', 'g', 'hp')],
        sprite2Blocks: [reporter('r3', 'g', 'hp')]
    });
    assert.deepEqual(planMerge(p.vm, 'g', 'l'), {
        ok: false, refusal: {code: 'not-visible', owner: 'Sprite1', targets: ['Stage', 'Sprite2']}
    });
    // Used only inside the sprite that owns the remaining one: allowed, and clones now keep their own value.
    const q = project({
        stageVars: [variable('g', 'hp')],
        sprite1Vars: [variable('l', 'HP')],
        sprite1Blocks: [reporter('r1', 'g', 'hp'),
            {id: 'c', opcode: 'control_create_clone_of_menu', inputs: {}, fields: {CLONE_OPTION: {name: 'CLONE_OPTION', value: '_myself_'}}}]
    });
    const result = planMerge(q.vm, 'g', 'l');
    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.warnings, ['clones-split']);
});

test('merging refuses different types, cloud variables and the same variable', () => {
    const p = project({
        stageVars: [variable('g', 'a'), variable('list', 'a', [], 'list'), variable('cloud', '☁ a', 0, '', true)]
    });
    assert.deepEqual(planMerge(p.vm, 'g', 'list'), {ok: false, refusal: {code: 'type'}});
    assert.deepEqual(planMerge(p.vm, 'g', 'cloud'), {ok: false, refusal: {code: 'cloud'}});
    assert.deepEqual(planMerge(p.vm, 'g', 'g'), {ok: false, refusal: {code: 'same'}});
    assert.deepEqual(planMerge(p.vm, 'g', 'nope'), {ok: false, refusal: {code: 'missing'}});
});

test('merging lists rewrites LIST fields', () => {
    const p = project({
        stageVars: [variable('keep', 'items', ['x'], 'list')],
        sprite1Vars: [variable('drop', 'itemz', [], 'list')],
        sprite1Blocks: [reporter('r1', 'drop', 'itemz', 'LIST')]
    });
    const result = planMerge(p.vm, 'drop', 'keep');
    applyPlan(p.vm, result.plan);
    assert.deepEqual(p.sprite1.blocks._blocks.r1.fields.LIST, {name: 'LIST', id: 'keep', value: 'items', variableType: 'list'});
});

test('the monitor of the removed variable goes away and the remaining one is shown in its place', () => {
    const p = project({stageVars: [variable('g', 'score')], sprite1Vars: [variable('a', 'scor')]});
    const monitors = p.vm.runtime.monitorBlocks;
    monitors.createBlock({...reporter('a', 'a', 'scor'), isMonitored: true});
    const record = applyPlan(p.vm, planMerge(p.vm, 'a', 'g').plan);
    assert.deepEqual(p.removed, ['a']);
    assert.equal(monitors.getBlock('a'), undefined);
    assert.equal(monitors.getBlock('g').isMonitored, true);
    assert.deepEqual(monitors.getBlock('g').fields.VARIABLE, {name: 'VARIABLE', id: 'g', value: 'score', variableType: ''});
    undoPlan(p.vm, record);
    assert.equal(monitors.getBlock('g'), undefined);
    assert.equal(monitors.getBlock('a').isMonitored, true);
});

test('a sprite variable moves to all sprites, and "of (sprite)" blocks read it from the stage', () => {
    const p = project({
        sprite1Vars: [variable('a', 'speed', 4)],
        sprite1Blocks: [reporter('r1', 'a', 'speed'),
            {id: 'c', opcode: 'control_create_clone_of_menu', inputs: {}, fields: {CLONE_OPTION: {name: 'CLONE_OPTION', value: '_myself_'}}}],
        sprite2Blocks: sensingOf('o1', 'speed', 'Sprite1')
    });
    const before = snapshot(p);
    const result = planScopeChange(p.vm, 'a', 'global');
    assert.equal(result.ok, true);
    assert.equal(result.plan.kind, 'global');
    assert.deepEqual(result.plan.warnings, ['clones-share']);
    const record = applyPlan(p.vm, result.plan);
    assert.equal(p.stage.variables.a.name, 'speed');
    assert.equal(p.sprite1.variables.a, undefined);
    assert.equal(p.sprite1.blocks._blocks.r1.fields.VARIABLE.id, 'a');
    assert.equal(p.sprite2.blocks._blocks['o1-m'].fields.OBJECT.value, '_stage_');
    undoPlan(p.vm, record);
    assert.deepEqual(snapshot(p), before);
});

test('moving to all sprites merges into a global of the same name, and is refused when another sprite has one', () => {
    const p = project({stageVars: [variable('g', 'speed')], sprite1Vars: [variable('a', 'speed')]});
    const merge = planScopeChange(p.vm, 'a', 'global');
    assert.equal(merge.plan.kind, 'merge');
    assert.equal(merge.plan.destination.id, 'g');

    const q = project({sprite1Vars: [variable('a', 'speed')], sprite2Vars: [variable('b', 'speed')]});
    assert.deepEqual(planScopeChange(q.vm, 'a', 'global'), {ok: false, refusal: {code: 'name-taken', targets: ['Sprite2']}});
});

test('a global variable moves to this sprite only when nothing else uses it', () => {
    const used = project({
        stageVars: [variable('g', 'lives')],
        sprite1Blocks: [reporter('r1', 'g', 'lives')],
        stageBlocks: [reporter('r2', 'g', 'lives')],
        sprite2Blocks: sensingOf('o1', 'lives', '_stage_')
    });
    assert.deepEqual(planScopeChange(used.vm, 'g', 'local'), {
        ok: false, refusal: {code: 'used-elsewhere', sprite: 'Sprite1', targets: ['Stage', 'Sprite2']}
    });

    const p = project({stageVars: [variable('g', 'lives', 3)], sprite1Blocks: [reporter('r1', 'g', 'lives')]});
    const monitors = p.vm.runtime.monitorBlocks;
    monitors.createBlock({...reporter('g', 'g', 'lives'), isMonitored: true});
    const result = planScopeChange(p.vm, 'g', 'local');
    assert.equal(result.plan.kind, 'local');
    const before = snapshot(p);
    const record = applyPlan(p.vm, result.plan);
    assert.equal(p.sprite1.variables.g.value, 3);
    assert.equal(p.stage.variables.g, undefined);
    // The monitor is made again so the VM records it as the sprite's.
    assert.deepEqual(monitors.shown, [['g', true]]);
    assert.equal(monitors.getBlock('g').isMonitored, true);
    undoPlan(p.vm, record);
    assert.deepEqual(snapshot(p), before);
    assert.equal(monitors.getBlock('g').isMonitored, true);

    assert.deepEqual(planScopeChange(p.vm, 'g', 'local', p.stage), {ok: false, refusal: {code: 'stage'}});
    const cloud = project({stageVars: [variable('c', '☁ x', 0, '', true)]});
    assert.deepEqual(planScopeChange(cloud.vm, 'c', 'local'), {ok: false, refusal: {code: 'cloud'}});
});

test('"of" blocks whose sprite is a reporter are reported, not rewritten', () => {
    const p = project({
        stageVars: [variable('g', 'score')],
        sprite1Vars: [variable('a', 'scor')],
        sprite2Blocks: sensingOf('o1', 'scor', 'Sprite1', true)
    });
    const {plan} = planMerge(p.vm, 'a', 'g');
    assert.deepEqual(plan.warnings, ['dynamic-sensing']);
    assert.equal(plan.sensingReferences, 0);
});

test('messages follow the locale and describe plans and refusals', () => {
    assert.equal(variableMergeMessages('ja').makeGlobal('variable'), 'グローバル変数にする');
    assert.equal(variableMergeMessages('ja').makeLocal('list'), 'スプライトリストにする');
    assert.equal(variableMergeMessages('ja').madeLocal('score', 'variable'), '「score」をスプライト変数にしました。');
    assert.equal(variableMergeMessages('ja-Hira').makeLocal('variable'), 'スプライトへんすうに する');
    assert.equal(variableMergeMessages('fr').makeGlobal('variable'), 'Make it a global variable');
    assert.equal(variableMergeMessages('en').madeGlobal('items', 'list'), '“items” is now a global list.');
    const p = project({
        stageVars: [variable('g', 'score', 5)],
        sprite1Vars: [variable('a', 'scor', 3)],
        sprite1Blocks: [reporter('r1', 'a', 'scor')]
    });
    const text = describePlan(planMerge(p.vm, 'a', 'g').plan, variableMergeMessages('ja'));
    assert.equal(text.title, '変数を統合');
    assert.equal(text.lead, '「score」は既にあります。「scor」を「score」に統合しますか？');
    assert.deepEqual(text.details, [
        '「scor」を使っているブロック 1 個を「score」に付け替え、「scor」を削除します。',
        'Sprite1: 1 個',
        '「score」の値 “5” を残し、「scor」の値 “3” は捨てます。'
    ]);
    assert.equal(describeRefusal({code: 'name-taken', targets: ['Sprite2', 'Sprite3']}, variableMergeMessages('en')),
        'These already have one with the same name: Sprite2, Sprite3.');
});

// Shapes from scratch-blocks core/variables.js and blocks_vertical/data.js, reduced to what the patch reads.
function scratchBlocks (vm, document) {
    const alerts = [];
    const renamed = [];
    const workspace = {
        listeners_: [vm.blockListener],
        variables: [],
        getVariable (name, type) {
            return this.variables.find(v => v.name === name && v.type === type) ?? null;
        },
        getInjectionDiv: () => ({ownerDocument: document})
    };
    const flyout = {targetWorkspace: workspace, getVariable: (...args) => workspace.getVariable(...args)};
    const model = (id, name, type = '') => ({name, type, getId: () => id});
    const Variables = {
        CLOUD_PREFIX: '☁ ',
        trimName_: name => name.trim(),
        validateScalarVarOrListName_ (name, ws, additional, isCloud, type, message) {
            name = name.trim();
            if (ws.getVariable(name, type) || additional.includes(name)) {
                alerts.push(message.replace('%1', name));
                return null;
            }
            return name;
        },
        renameVariable (ws, variable, callback) {
            // The GUI's prompt answers synchronously here.
            const validated = Variables.validateScalarVarOrListName_(ws.nextName, ws, [], false, variable.type, 'exists: %1');
            if (validated) renamed.push([variable.getId(), validated]);
            callback?.(validated ?? null);
        },
        createVariable () {}
    };
    const menu = {customContextMenu (options) {
        options.push({text: 'Rename variable'});
    }};
    const listMenu = {customContextMenu (options) {
        options.push({text: 'Rename list'});
    }};
    return {
        ScratchBlocks: {
            Variables,
            Constants: {Data: {CUSTOM_CONTEXT_MENU_GET_VARIABLE_MIXIN: menu, CUSTOM_CONTEXT_MENU_GET_LIST_MIXIN: listMenu}},
            ScratchMsgs: {currentLocale_: 'ja'}
        },
        workspace, flyout, model, alerts, renamed, menu
    };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('renaming to a visible variable\'s name offers a merge, applies it, and undo restores it', async () => {
    const {window} = new JSDOM('<body></body>');
    const {document} = window;
    window.HTMLDialogElement.prototype.showModal ??= function () {
        this.setAttribute('open', '');
    };
    window.HTMLDialogElement.prototype.close ??= function () {
        this.removeAttribute('open');
    };
    const p = project({
        stageVars: [variable('g', 'score', 5)],
        sprite1Vars: [variable('a', 'scor', 3)],
        sprite1Blocks: [reporter('r1', 'a', 'scor')]
    });
    const fake = scratchBlocks(p.vm, document);
    fake.workspace.variables = [fake.model('g', 'score'), fake.model('a', 'scor')];
    const remove = installVariableMerge(p.vm, fake.ScratchBlocks, {document});

    // A name nobody has goes through as before.
    fake.workspace.nextName = 'points';
    fake.ScratchBlocks.Variables.renameVariable(fake.workspace, fake.model('a', 'scor'));
    assert.deepEqual(fake.renamed, [['a', 'points']]);

    fake.workspace.nextName = ' score ';
    fake.ScratchBlocks.Variables.renameVariable(fake.workspace, fake.model('a', 'scor'));
    assert.deepEqual(fake.alerts, []);
    await flush();
    const dialog = document.querySelector('.twPlusVariableMergeDialog');
    assert.ok(dialog);
    assert.equal(dialog.querySelector('h2').textContent, '変数を統合');
    dialog.querySelector('[data-dialog-action="confirm"]').click();
    assert.equal(document.querySelector('.twPlusVariableMergeDialog'), null);
    assert.equal(p.sprite1.variables.a, undefined);
    assert.equal(p.sprite1.blocks._blocks.r1.fields.VARIABLE.id, 'g');
    assert.equal(p.vm.workspaceUpdates, 1);

    const notice = document.querySelector('.twPlusVariableMergeNotice');
    assert.equal(notice.getAttribute('role'), 'status');
    assert.equal(notice.querySelector('span').textContent, '「scor」を「score」に統合しました。');
    const close = notice.querySelector('.twPlusVariableMergeClose');
    assert.equal(close.getAttribute('aria-label'), '閉じる');
    assert.equal(close.title, '閉じる');
    assert.ok(close.querySelector('svg'));
    notice.querySelector('.twPlusVariableMergeUndo').click();
    assert.equal(p.sprite1.variables.a.name, 'scor');
    assert.equal(p.sprite1.blocks._blocks.r1.fields.VARIABLE.id, 'a');
    assert.equal(p.vm.workspaceUpdates, 2);
    assert.equal(document.querySelector('.twPlusVariableMergeNotice span').textContent, '元に戻しました。');

    // A refused merge explains why instead of merging.
    p.sprite2.blocks._blocks.r9 = reporter('r9', 'g', 'score');
    p.sprite1.variables.l = variable('l', 'mine');
    fake.workspace.variables.push(fake.model('l', 'mine'));
    fake.workspace.nextName = 'mine';
    fake.ScratchBlocks.Variables.renameVariable(fake.workspace, fake.model('g', 'score'));
    await flush();
    const refusal = document.querySelector('.twPlusVariableMergeDialog');
    assert.equal(refusal.querySelector('h2').textContent, 'この変更はできません');
    assert.match(refusal.querySelector('.twPlusVariableMergeLead').textContent, /Sprite2/);
    refusal.querySelector('[data-dialog-action="confirm"]').click();
    assert.ok(p.stage.variables.g);

    remove();
    fake.workspace.nextName = 'score';
    fake.ScratchBlocks.Variables.renameVariable(fake.workspace, fake.model('a', 'scor'));
    assert.deepEqual(fake.alerts, ['exists: score']);
    document.querySelectorAll('.twPlusVariableMergeNotice').forEach(node => node.remove());
    window.close();
});

test('the palette\'s variable menu offers the scope change for a sprite, not for the stage', () => {
    const {window} = new JSDOM('<body></body>');
    const {document} = window;
    const p = project({stageVars: [variable('g', 'lives')], sprite1Vars: [variable('a', 'speed')]});
    const fake = scratchBlocks(p.vm, document);
    const remove = installVariableMerge(p.vm, fake.ScratchBlocks, {document, locale: 'en'});
    const block = (id, isInFlyout = true) => ({
        isInFlyout, workspace: fake.flyout,
        isCollapsed: () => false,
        getField: () => ({getVariable: () => fake.model(id, id)})
    });
    const menu = (b) => {
        const options = [];
        fake.menu.customContextMenu.call(b, options);
        return options.map(option => option.text);
    };
    assert.deepEqual(menu(block('a')), ['Rename variable', 'Make it a global variable']);
    assert.deepEqual(menu(block('g')), ['Rename variable', 'Make it a sprite variable']);
    assert.deepEqual(menu(block('a', false)), ['Rename variable']);
    p.vm.editingTarget = p.stage;
    assert.deepEqual(menu(block('g')), ['Rename variable']);
    remove();
    p.vm.editingTarget = p.sprite1;
    assert.deepEqual(menu(block('a')), ['Rename variable']);
    window.close();
});

test('attachVariableMerge reports an install that throws instead of rejecting', async () => {
    const errors: unknown[] = [];
    const attached = attachVariableMerge({
        vm: {runtime: {targets: []}} as never,
        getBlockly: async () => new Proxy({}, {get () { throw new Error("broken ScratchBlocks"); }}) as never,
        onError: error => errors.push(error)
    });
    await attached.ready;
    assert.equal(errors.length, 1);
    attached.dispose();
});

// With the code area's own attachment, the GUI adds the attachment's listener (which wraps
// vm.blockListener) instead of vm.blockListener itself, so the workspace is known from the record.
test('renaming offers a merge in a code workspace recorded by the code area attachment', async () => {
    const {window} = new JSDOM('<body></body>');
    const {document} = window;
    window.HTMLDialogElement.prototype.showModal ??= function () {
        this.setAttribute('open', '');
    };
    const p = project({
        stageVars: [variable('g', 'score', 5)],
        sprite1Vars: [variable('a', 'scor', 3)],
        sprite1Blocks: [reporter('r1', 'a', 'scor')]
    });
    const fake = scratchBlocks(p.vm, document);
    fake.workspace.variables = [fake.model('g', 'score'), fake.model('a', 'scor')];
    fake.workspace.listeners_ = [function blockListener () {}];
    const remove = installVariableMerge(p.vm, fake.ScratchBlocks, {document});

    fake.workspace.nextName = 'score';
    fake.ScratchBlocks.Variables.renameVariable(fake.workspace, fake.model('a', 'scor'));
    await flush();
    assert.equal(document.querySelector('.twPlusVariableMergeDialog'), null, 'an unrecorded workspace keeps the alert');
    assert.equal(fake.alerts.length, 1);

    const unregister = registerCodeWorkspace(fake.workspace);
    fake.ScratchBlocks.Variables.renameVariable(fake.workspace, fake.model('a', 'scor'));
    await flush();
    assert.ok(document.querySelector('.twPlusVariableMergeDialog'));
    assert.equal(fake.alerts.length, 1);
    unregister();
    remove();
    window.close();
});
