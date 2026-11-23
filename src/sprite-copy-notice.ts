/**
 * Makes a script copied by dropping it on a sprite or the stage in the sprite list visible, and
 * lets the user take that copy back in one action.
 *
 * The GUI copies a dragged script when the pointer is released over a tile of the sprite list: its
 * target pane listens for the VM's BLOCK_DRAG_END and calls
 * `vm.shareBlocksToTarget(blocks, targetId, editingTargetId)`. That is the only caller that passes
 * the source target, so a call with a source different from the receiving target is a drop on the
 * sprite list. Pasting and backpack drops pass no source and are left alone.
 */

interface SharedBlock {
    id: string;
    parent?: string | null;
    topLevel?: boolean;
}
interface NoticeTarget {
    id: string;
    isStage: boolean;
    isOriginal?: boolean;
    getName(): string;
    blocks: {
        _blocks: Record<string, SharedBlock>;
        deleteBlock(id: string): void;
        getAllVariableAndListReferences(optBlocks?: unknown): Record<string, unknown>;
    };
    variables: Record<string, unknown>;
    deleteVariable(id: string): void;
}
interface NoticeVM {
    editingTarget: NoticeTarget | null;
    runtime: {
        targets: NoticeTarget[];
        getTargetById(id: string): NoticeTarget | undefined;
        getTargetForStage(): NoticeTarget | undefined;
    };
    shareBlocksToTarget(blocks: unknown, targetId: string, fromTargetId?: string): Promise<unknown>;
    emitWorkspaceUpdate?(): void;
    emitTargetsUpdate?(triggerProjectChange?: boolean): void;
}

export interface SpriteCopyNoticeOptions {
    vm: NoticeVM;
    document: Document;
    /** The GUI's locale, or a function that reads it when a notice is shown. */
    locale?: string | (() => string | undefined);
    /** How long a notice stays, in milliseconds, while the pointer is not on it. */
    timeout?: number;
    /** The tile of a target in the sprite list. The default finds the GUI's sprite and stage tiles. */
    findTargetElement?(target: NoticeTarget, document: Document): Element | null | undefined;
}

/** What one drop added to a target, and how to take it back. */
export interface SharedCopy {
    target: NoticeTarget;
    /** The top blocks of the copied scripts. */
    roots: string[];
    /** Variables the copy created, with the target that holds each. */
    variables: Array<{owner: NoticeTarget; id: string}>;
}

const messages = {
    en: {
        copiedToSprite: (name: string, count = 1) => count > 1 ?
            `Copied ${count} scripts to “${name}”.` : `Copied the script to “${name}”.`,
        copiedToStage: (count = 1) => count > 1 ? `Copied ${count} scripts to the Stage.` : 'Copied the script to the Stage.',
        undo: 'Undo', close: 'Close',
        removedFromSprite: (name: string) => `Removed the copy from “${name}”.`,
        removedFromStage: 'Removed the copy from the Stage.'
    },
    ja: {
        copiedToSprite: (name: string, count = 1) => count > 1 ?
            `スプライト「${name}」に${count}個のスクリプトをコピーしました。` : `スプライト「${name}」にスクリプトをコピーしました。`,
        copiedToStage: (count = 1) => count > 1 ? `ステージに${count}個のスクリプトをコピーしました。` : 'ステージにスクリプトをコピーしました。',
        undo: '元に戻す', close: '閉じる',
        removedFromSprite: (name: string) => `スプライト「${name}」からコピーを取り消しました。`,
        removedFromStage: 'ステージからコピーを取り消しました。'
    },
    'ja-hira': {
        copiedToSprite: (name: string, count = 1) => count > 1 ?
            `スプライト「${name}」に${count}このスクリプトをコピーしました。` : `スプライト「${name}」にスクリプトをコピーしました。`,
        copiedToStage: (count = 1) => count > 1 ? `ステージに${count}このスクリプトをコピーしました。` : 'ステージにスクリプトをコピーしました。',
        undo: 'もとにもどす', close: 'とじる',
        removedFromSprite: (name: string) => `スプライト「${name}」からコピーをとりけしました。`,
        removedFromStage: 'ステージからコピーをとりけしました。'
    }
};
export type SpriteCopyNoticeMessages = typeof messages.en;

/** The notice's wording for a locale: ja-hira, ja, and English for anything else. */
export function spriteCopyNoticeMessages(locale?: string): SpriteCopyNoticeMessages {
    if (/^ja-hira$/i.test(locale ?? '')) return messages['ja-hira'];
    return /^ja(?:-|$)/i.test(locale ?? '') ? messages.ja : messages.en;
}

/** Marks the tile of the target that received a copy, for as long as the notice is shown. */
export const RECEIVED_COPY_ATTRIBUTE = 'data-tw-received-copy';

function defaultTargetElement(target: NoticeTarget, document: Document) {
    if (target.isStage) return document.querySelector('[class*="stage-selector_stage-selector_"]');
    const name = target.getName();
    for (const label of document.querySelectorAll('[class*="sprite-selector-item_sprite-name_"]')) {
        if (label.textContent === name) return label.closest('[class*="sprite-selector-item_sprite-selector-item_"]');
    }
    return null;
}

/**
 * Remove what a drop copied into a target: its scripts, and the variables it created that no
 * script refers to any more. Scripts the user already deleted are skipped.
 * @returns Whether anything was removed.
 */
export function removeSharedCopy(vm: NoticeVM, copy: SharedCopy) {
    const {target} = copy;
    if (vm.runtime.getTargetById(target.id) !== target) return false;
    let removed = false;
    for (const id of copy.roots) {
        if (!target.blocks._blocks[id]) continue;
        target.blocks.deleteBlock(id);
        removed = true;
    }
    const referenced = new Set<string>();
    for (const each of vm.runtime.targets) {
        if (each.isOriginal === false) continue;
        for (const id of Object.keys(each.blocks.getAllVariableAndListReferences())) referenced.add(id);
    }
    let stageChanged = false;
    for (const {owner, id} of copy.variables) {
        if (referenced.has(id) || !Object.prototype.hasOwnProperty.call(owner.variables, id)) continue;
        owner.deleteVariable(id);
        removed = true;
        if (owner.isStage) stageChanged = true;
    }
    if (removed) {
        // Only the code area that shows the target (or the stage's variables) has to be redrawn.
        if (vm.editingTarget === target || stageChanged) vm.emitWorkspaceUpdate?.();
        vm.emitTargetsUpdate?.();
    }
    return removed;
}

const svgNS = 'http://www.w3.org/2000/svg';
function closeIcon(document: Document) {
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M3 3 L13 13 M13 3 L3 13');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    svg.append(path);
    return svg;
}

/**
 * Show a notice naming the sprite (or the stage) that a drop on the sprite list copied a script
 * into, mark its tile, and offer to undo the copy.
 * @returns `dispose`, which removes the notice and stops watching the VM.
 */
export function attachSpriteCopyNotice({vm, document, locale, timeout = 10000,
    findTargetElement = defaultTargetElement}: SpriteCopyNoticeOptions) {
    const hadOwn = Object.prototype.hasOwnProperty.call(vm, 'shareBlocksToTarget');
    const original = vm.shareBlocksToTarget;
    let disposed = false;
    let hide: (() => void) | undefined;
    const text = () => spriteCopyNoticeMessages(typeof locale === 'function' ? locale() : locale);

    function show(copy: SharedCopy) {
        hide?.();
        const words = text();
        const {target} = copy;
        const name = target.isStage ? '' : target.getName();
        const notice = document.createElement('div');
        notice.className = 'tw-sprite-copy-notice';
        notice.setAttribute('role', 'status');
        notice.setAttribute('aria-live', 'polite');
        const message = document.createElement('span');
        message.className = 'tw-sprite-copy-notice-text';
        const count = copy.roots.length;
        message.textContent = target.isStage ? words.copiedToStage(count) : words.copiedToSprite(name, count);
        const undo = document.createElement('button');
        undo.type = 'button';
        undo.className = 'tw-sprite-copy-notice-undo';
        undo.textContent = words.undo;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'tw-sprite-copy-notice-close';
        close.title = words.close;
        close.setAttribute('aria-label', words.close);
        close.append(closeIcon(document));
        notice.append(message, undo, close);
        document.body.append(notice);

        let tile: Element | null | undefined;
        try {
            tile = findTargetElement(target, document);
        } catch {
            tile = null;
        }
        tile?.setAttribute(RECEIVED_COPY_ATTRIBUTE, '');

        let timer: ReturnType<typeof setTimeout> | undefined;
        let wait = timeout;
        const view = document.defaultView;
        const schedule = () => {
            if (timer !== undefined) view.clearTimeout(timer);
            timer = view.setTimeout(() => hide?.(), wait);
        };
        // Keep the notice while the pointer or the keyboard focus is on it. The listeners go with
        // the notice, which is removed when it is dismissed.
        notice.addEventListener('mouseenter', () => {
            if (timer !== undefined) view.clearTimeout(timer);
            timer = undefined;
        });
        notice.addEventListener('mouseleave', schedule);
        notice.addEventListener('focusin', () => {
            if (timer !== undefined) view.clearTimeout(timer);
            timer = undefined;
        });
        notice.addEventListener('focusout', event => {
            if (!notice.contains(event.relatedTarget as Node | null)) schedule();
        });
        close.addEventListener('click', () => hide?.());
        undo.addEventListener('click', () => {
            if (!removeSharedCopy(vm, copy)) {
                hide?.();
                return;
            }
            tile?.removeAttribute(RECEIVED_COPY_ATTRIBUTE);
            undo.remove();
            message.textContent = target.isStage ? words.removedFromStage : words.removedFromSprite(name);
            close.focus();
            wait = Math.min(timeout, 3000);
            schedule();
        });

        const dismiss = () => {
            if (timer !== undefined) view.clearTimeout(timer);
            tile?.removeAttribute(RECEIVED_COPY_ATTRIBUTE);
            notice.remove();
            if (hide === dismiss) hide = undefined;
        };
        hide = dismiss;
        schedule();
    }

    const patched = function (this: NoticeVM, blocks: unknown, targetId: string, fromTargetId?: string) {
        const target = !disposed && fromTargetId && fromTargetId !== targetId ?
            vm.runtime.getTargetById(targetId) : undefined;
        if (!target) return original.call(this, blocks, targetId, fromTargetId);
        const stage = vm.runtime.getTargetForStage();
        const blocksBefore = new Set(Object.keys(target.blocks._blocks));
        // Resolving variable conflicts runs synchronously, before the returned promise.
        const owners = [...new Set([target, stage].filter(Boolean))];
        const variablesBefore = new Map(owners.map(owner => [owner, new Set(Object.keys(owner.variables))]));
        const result = original.call(this, blocks, targetId, fromTargetId);
        Promise.resolve(result).then(() => {
            if (disposed || vm.runtime.getTargetById(target.id) !== target) return;
            const created = Object.keys(target.blocks._blocks).filter(id => !blocksBefore.has(id));
            const createdSet = new Set(created);
            const roots = created.filter(id => {
                const block = target.blocks._blocks[id];
                return block.topLevel || !block.parent || !createdSet.has(block.parent);
            });
            if (!roots.length) return;
            const variables = owners.flatMap(owner => Object.keys(owner.variables)
                .filter(id => !variablesBefore.get(owner).has(id)).map(id => ({owner, id})));
            show({target, roots, variables});
        }, () => {});
        return result;
    };
    vm.shareBlocksToTarget = patched;

    return {
        dispose() {
            disposed = true;
            hide?.();
            if (vm.shareBlocksToTarget !== patched) return;
            if (hadOwn) vm.shareBlocksToTarget = original;
            else delete vm.shareBlocksToTarget;
        }
    };
}
