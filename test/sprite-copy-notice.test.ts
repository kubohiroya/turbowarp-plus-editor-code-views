import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {JSDOM} from 'jsdom';
import {RECEIVED_COPY_ATTRIBUTE, attachSpriteCopyNotice, spriteCopyNoticeMessages}
    from '../dist/sprite-copy-notice.js';

const windows: Array<{close(): void}> = [];
// jsdom's window keeps timers alive until it is closed.
after(() => windows.forEach(window => window.close()));

// A target as scratch-vm builds it, reduced to what the notice reads and what undo changes.
function makeTarget(id: string, name: string, isStage = false) {
    const target = {
        id, isStage, isOriginal: true, getName: () => name,
        variables: {} as Record<string, {name: string}>,
        deleteVariable(variableId: string) {delete target.variables[variableId];},
        blocks: {
            _blocks: {} as Record<string, {id: string; parent: string | null; topLevel: boolean; variable?: string}>,
            deleteBlock(blockId: string) {
                for (const block of Object.values(target.blocks._blocks)) {
                    if (block.parent === blockId) target.blocks.deleteBlock(block.id);
                }
                delete target.blocks._blocks[blockId];
            },
            getAllVariableAndListReferences() {
                const references = {};
                for (const block of Object.values(target.blocks._blocks)) {
                    if (block.variable) references[block.variable] = [];
                }
                return references;
            }
        }
    };
    return target;
}

let nextId = 0;
// shareBlocksToTarget as scratch-vm does it: variable conflicts are resolved synchronously, the
// blocks are created with new ids once the extensions have loaded.
function fixture({locale = 'ja', timeout = 10000} = {}) {
    const dom = new JSDOM('<!doctype html><body><div class="sprite-selector-item_sprite-selector-item_ab12C">' +
        '<div class="sprite-selector-item_sprite-name_xY9zq">Sprite2</div></div>' +
        '<div class="stage-selector_stage-selector_Q1w2e"></div></body>', {pretendToBeVisual: true});
    windows.push(dom.window);
    const document = dom.window.document;
    const stage = makeTarget('stage', 'Stage', true);
    const sprite1 = makeTarget('s1', 'Sprite1');
    const sprite2 = makeTarget('s2', 'Sprite2');
    sprite2.blocks._blocks.own = {id: 'own', parent: null, topLevel: true};
    const calls: unknown[][] = [];
    const updates = {workspace: 0, targets: 0};
    class VM {
        editingTarget = sprite1;
        runtime = {
            targets: [stage, sprite1, sprite2],
            getTargetById: (id: string) => this.runtime.targets.find(target => target.id === id),
            getTargetForStage: () => stage
        };
        shareBlocksToTarget(blocks: {withVariable?: boolean}, targetId: string, fromTargetId?: string) {
            calls.push([blocks, targetId, fromTargetId]);
            const target = this.runtime.getTargetById(targetId);
            let variable: string | undefined;
            if (blocks.withVariable) {
                variable = `v${nextId++}`;
                (target.isStage ? stage : target).variables[variable] = {name: 'score'};
            }
            return Promise.resolve().then(() => {
                const root = `b${nextId++}`;
                const child = `b${nextId++}`;
                target.blocks._blocks[root] = {id: root, parent: null, topLevel: true};
                target.blocks._blocks[child] = {id: child, parent: root, topLevel: false, variable};
            });
        }
        emitWorkspaceUpdate() {updates.workspace++;}
        emitTargetsUpdate() {updates.targets++;}
    }
    const vm = new VM();
    const attached = attachSpriteCopyNotice({vm, document, locale, timeout});
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const click = (element: Element) => element.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}));
    return {
        dom, document, vm, stage, sprite1, sprite2, calls, updates, attached, settle, click,
        notice: () => document.querySelector('.tw-sprite-copy-notice'),
        tile: () => document.querySelector('[class*="sprite-selector-item_sprite-selector-item_"]'),
        stageTile: () => document.querySelector('[class*="stage-selector_stage-selector_"]')
    };
}

test('a drop on another sprite names it, marks its tile and still copies', async () => {
    const view = fixture();
    await view.vm.shareBlocksToTarget({}, 's2', 's1');
    await view.settle();
    assert.equal(view.calls.length, 1, 'the copy itself is unchanged');
    assert.equal(Object.keys(view.sprite2.blocks._blocks).length, 3);
    const notice = view.notice();
    assert.ok(notice);
    assert.equal(notice.getAttribute('role'), 'status');
    assert.match(notice.textContent, /スプライト「Sprite2」にスクリプトをコピーしました。/);
    assert.ok(view.tile().hasAttribute(RECEIVED_COPY_ATTRIBUTE));
    view.attached.dispose();
});

test('Undo removes only the copied script and says so', async () => {
    const view = fixture();
    await view.vm.shareBlocksToTarget({}, 's2', 's1');
    await view.settle();
    view.click(view.notice().querySelector('.tw-sprite-copy-notice-undo'));
    assert.deepEqual(Object.keys(view.sprite2.blocks._blocks), ['own']);
    assert.equal(view.updates.targets, 1);
    assert.equal(view.updates.workspace, 0, 'the code area shows another sprite and is not redrawn');
    assert.match(view.notice().textContent, /スプライト「Sprite2」からコピーを取り消しました。/);
    assert.equal(view.notice().querySelector('.tw-sprite-copy-notice-undo'), null);
    assert.ok(!view.tile().hasAttribute(RECEIVED_COPY_ATTRIBUTE));
    view.attached.dispose();
});

test('Undo also removes a variable the copy created and nothing else uses', async () => {
    const view = fixture();
    view.sprite2.variables.kept = {name: 'kept'};
    await view.vm.shareBlocksToTarget({withVariable: true}, 's2', 's1');
    await view.settle();
    assert.equal(Object.keys(view.sprite2.variables).length, 2);
    view.vm.editingTarget = view.sprite2;
    view.click(view.notice().querySelector('.tw-sprite-copy-notice-undo'));
    assert.deepEqual(Object.keys(view.sprite2.variables), ['kept']);
    assert.equal(view.updates.workspace, 1, 'the code area showing that sprite is redrawn');
    view.attached.dispose();
});

test('a variable shared to the stage stays when another script now uses it', async () => {
    const view = fixture();
    await view.vm.shareBlocksToTarget({withVariable: true}, 'stage', 's1');
    await view.settle();
    assert.match(view.notice().textContent, /背景にスクリプトをコピーしました。/);
    assert.ok(view.stageTile().hasAttribute(RECEIVED_COPY_ATTRIBUTE));
    const [variable] = Object.keys(view.stage.variables);
    view.sprite1.blocks._blocks.user = {id: 'user', parent: null, topLevel: true, variable} as never;
    view.click(view.notice().querySelector('.tw-sprite-copy-notice-undo'));
    assert.deepEqual(Object.keys(view.stage.variables), [variable]);
    assert.equal(Object.keys(view.stage.blocks._blocks).length, 0);
    view.attached.dispose();
});

test('pasting and backpack drops, which pass no source, show nothing', async () => {
    const view = fixture();
    await view.vm.shareBlocksToTarget({}, 's2');
    await view.vm.shareBlocksToTarget({}, 's1', 's1');
    await view.settle();
    assert.equal(view.notice(), null);
    assert.equal(view.calls.length, 2);
    view.attached.dispose();
});

test('the close button is an X icon with a translated name', async () => {
    const view = fixture({locale: 'en'});
    await view.vm.shareBlocksToTarget({}, 's2', 's1');
    await view.settle();
    const close = view.notice().querySelector('.tw-sprite-copy-notice-close');
    assert.equal(close.textContent, '', 'no visible text');
    assert.ok(close.querySelector('svg'));
    assert.equal(close.getAttribute('aria-label'), 'Close');
    assert.equal(close.getAttribute('title'), 'Close');
    assert.match(view.notice().textContent, /Copied the script to “Sprite2”\./);
    view.click(close);
    assert.equal(view.notice(), null);
    assert.ok(!view.tile().hasAttribute(RECEIVED_COPY_ATTRIBUTE));
    assert.equal(Object.keys(view.sprite2.blocks._blocks).length, 3, 'closing keeps the copy');
    view.attached.dispose();
});

test('the notice goes away by itself and a later copy replaces it', async () => {
    const view = fixture({timeout: 20});
    await view.vm.shareBlocksToTarget({}, 's2', 's1');
    await view.settle();
    await view.vm.shareBlocksToTarget({}, 'stage', 's1');
    await view.settle();
    assert.equal(view.document.querySelectorAll('.tw-sprite-copy-notice').length, 1);
    assert.ok(!view.tile().hasAttribute(RECEIVED_COPY_ATTRIBUTE));
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(view.notice(), null);
    view.attached.dispose();
});

test('dispose restores the VM method', () => {
    const view = fixture();
    assert.ok(Object.prototype.hasOwnProperty.call(view.vm, 'shareBlocksToTarget'));
    view.attached.dispose();
    assert.ok(!Object.prototype.hasOwnProperty.call(view.vm, 'shareBlocksToTarget'));
});

test('wording for each locale', () => {
    assert.equal(spriteCopyNoticeMessages('ja-Hira').undo, 'もとにもどす');
    assert.equal(spriteCopyNoticeMessages('ja').undo, '元に戻す');
    assert.equal(spriteCopyNoticeMessages('fr').undo, 'Undo');
    assert.equal(spriteCopyNoticeMessages().close, 'Close');
});
