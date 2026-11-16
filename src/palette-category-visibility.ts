import {blockPaletteCommentMarker, formatBlockPaletteComment} from '@kubohiroya/sb3-toolchain/browser';
import type {BlockPaletteDocument, BlockPaletteSet} from '@kubohiroya/sb3-toolchain/browser';

/**
 * Which block groups the palette shows for each sprite and the stage.
 *
 * The setting lives where sb3-toolchain source format 2 keeps it: one palette comment per sprite or
 * stage (`block-palette.json` in a project folder). It changes only what the palette offers; blocks
 * already in the code stay visible and editable.
 */

/** The standard groups, by the palette's category IDs. `lists` is Plus's own split of `variables`. */
export const standardGroups = ['motion', 'looks', 'sound', 'events', 'control', 'sensing', 'operators', 'variables', 'lists',
    'myBlocks'] as const;

export interface PaletteGroupSet {
    id: string;
    name: string;
    groups: readonly string[];
}

const builtinSetNames: Record<string, {en: string; ja: string}> = {
    standard: {en: 'Standard', ja: '標準'},
    expression: {en: 'Expression', ja: '表現'},
    data: {en: 'Variables and lists', ja: '変数・リスト'},
    basics: {en: 'Basic control', ja: '基本の制御'}
};
const builtinSetGroups: Record<string, readonly string[]> = {
    standard: standardGroups,
    expression: ['motion', 'looks', 'sound', 'sensing'],
    data: ['variables', 'lists'],
    basics: ['events', 'control', 'operators']
};
const japanese = (locale?: string) => /^ja(?:-|$)/i.test(locale ?? '');

/** The sets every project has, then the project's own sets from its stage palette comment. */
export function paletteGroupSets(locale?: string, projectSets: Record<string, BlockPaletteSet> = {}): PaletteGroupSet[] {
    const builtin = Object.keys(builtinSetGroups).map(id => ({
        id, name: builtinSetNames[id][japanese(locale) ? 'ja' : 'en'], groups: builtinSetGroups[id]
    }));
    return builtin.concat(Object.entries(projectSets).map(([id, set]) => ({id, name: set.name, groups: set.groups})));
}

const standardPrefixes: Record<string, string> = {
    motion: 'motion', looks: 'looks', sound: 'sound', event: 'events', control: 'control', sensing: 'sensing',
    operator: 'operators', procedures: 'myBlocks', argument: 'myBlocks'
};

/** The group a block belongs to, or null for a block no palette group offers. */
export function groupOfOpcode(opcode: string): string | null {
    const separator = opcode.indexOf('_');
    if (separator <= 0) return null;
    const prefix = opcode.slice(0, separator);
    if (prefix === 'data') return /list/i.test(opcode.slice(separator + 1)) ? 'lists' : 'variables';
    return standardPrefixes[prefix] ?? prefix;
}

type BlockLike = {opcode?: string; shadow?: boolean};
type CommentLike = {text?: string; id?: string};
/** The parts of a VM target this module reads and writes. */
export interface PaletteTarget {
    isStage: boolean;
    getName(): string;
    blocks?: {_blocks?: Record<string, BlockLike>};
    comments: Record<string, CommentLike>;
    createComment?(id: string, blockId: string | null, text: string, x: number, y: number, width: number, height: number,
        minimized: boolean): void;
    deleteComment?(id: string): void;
}

/** How many blocks of each group the target's code uses. Menus and other shadow blocks are not counted. */
export function usedGroups(target: Pick<PaletteTarget, 'blocks'>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const block of Object.values(target.blocks?._blocks ?? {})) {
        if (!block || block.shadow || typeof block.opcode !== 'string') continue;
        const group = groupOfOpcode(block.opcode);
        if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return counts;
}

export interface TargetPalette {
    /** The comment that holds the setting. */
    commentId: string;
    groups?: string[];
    /** Present on the stage's comment only. */
    order?: string[];
    sets?: Record<string, BlockPaletteSet>;
}

const markedLine = (text: string) => text.split('\n').find(line => line.endsWith(blockPaletteCommentMarker));

/** The palette setting a target carries in its palette comment, or null when it has none or it cannot be read. */
export function readTargetPalette(target: Pick<PaletteTarget, 'comments'>): TargetPalette | null {
    for (const [commentId, comment] of Object.entries(target.comments ?? {})) {
        const line = typeof comment?.text === 'string' ? markedLine(comment.text) : undefined;
        if (!line) continue;
        try {
            const value = JSON.parse(line.slice(0, -blockPaletteCommentMarker.length));
            if (!value || typeof value !== 'object') return null;
            const strings = (list: unknown) => Array.isArray(list) && list.every(item => typeof item === 'string') ?
                list as string[] : undefined;
            return {
                commentId,
                groups: strings(value.groups),
                order: strings(value.order),
                sets: value.sets && typeof value.sets === 'object' ? value.sets : undefined
            };
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * The groups shown when a target has no setting of its own: every standard group, and the groups of
 * the extensions its code already uses, so an existing project opens with nothing missing.
 */
export function defaultVisibleGroups(target: Pick<PaletteTarget, 'blocks'>, extensionIds: readonly string[]): string[] {
    const used = usedGroups(target);
    return [...standardGroups, ...extensionIds.filter(id => used.has(id))];
}

/** The groups the palette shows for the target. */
export function visibleGroups(target: Pick<PaletteTarget, 'blocks' | 'comments'>, extensionIds: readonly string[]): Set<string> {
    const groups = readTargetPalette(target)?.groups;
    return new Set(groups ?? defaultVisibleGroups(target, extensionIds));
}

/** Removes the categories the target does not show from a parsed toolbox, before the palette is drawn from it. */
export function filterToolboxTree(tree: Element | null | undefined, visible: ReadonlySet<string>): void {
    if (!tree) return;
    for (const category of Array.from(tree.querySelectorAll(':scope > category'))) {
        const id = category.getAttribute('id');
        if (id && !visible.has(id)) category.remove();
    }
}

const newCommentId = () => `twplus-palette-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Stores the target's palette setting in its palette comment, as sb3-toolchain source format 2 reads it.
 * A sprite whose groups equal its default gets no comment; the stage keeps one while it carries the
 * project's group order or sets.
 */
export function writeTargetPalette(target: PaletteTarget, groups: readonly string[], {extensionIds = [], order, sets}: {
    extensionIds?: readonly string[];
    order?: readonly string[];
    sets?: Record<string, BlockPaletteSet>;
} = {}): void {
    const current = readTargetPalette(target);
    const name = target.getName();
    const isDefault = sameGroups(groups, defaultVisibleGroups(target, extensionIds));
    const projectOrder = target.isStage ? order ?? current?.order : undefined;
    const projectSets = target.isStage ? sets ?? current?.sets : undefined;
    const keepsProjectSettings = (projectOrder && projectOrder.length > 0) ||
        (projectSets && Object.keys(projectSets).length > 0);
    if (isDefault && !keepsProjectSettings) {
        if (current) target.deleteComment?.(current.commentId);
        return;
    }
    const document: BlockPaletteDocument = {formatVersion: 1};
    if (projectOrder?.length) document.order = [...projectOrder];
    if (projectSets && Object.keys(projectSets).length) document.sets = projectSets;
    if (target.isStage) {
        if (!isDefault) document.stage = {groups: [...groups]};
    } else {
        document.sprites = {[name]: {groups: [...groups]}};
    }
    const text = formatBlockPaletteComment(document, {isStage: target.isStage, name});
    if (current) {
        target.comments[current.commentId].text = text;
        return;
    }
    target.createComment?.(newCommentId(), null, text, 0, 0, 200, 200, true);
}

const sameGroups = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length && new Set(left).size === left.length && left.every(group => right.includes(group));

// The `event_list` glyph of Material Symbols (outlined, 24px) by Google, Apache License 2.0.
// See THIRD_PARTY_NOTICES.md.
const eventListPath = 'M640-120q-33 0-56.5-23.5T560-200v-160q0-33 23.5-56.5T640-440h160q33 0 56.5 23.5T880-360v160q0 ' +
    '33-23.5 56.5T800-120H640Zm0-80h160v-160H640v160ZM80-240v-80h360v80H80Zm560-280q-33 0-56.5-23.5T560-600v-160q0-33 ' +
    '23.5-56.5T640-840h160q33 0 56.5 23.5T880-760v160q0 33-23.5 56.5T800-520H640Zm0-80h160v-160H640v160ZM80-640v-80h360v80H80Zm640 ' +
    '360Zm0-400Z';

const buttonLabel = (locale: string) => japanese(locale) ? 'パレット内のブロックグループの表示・非表示の設定' :
    'Block groups shown in the palette';

/**
 * Adds the button that opens the group settings at the end of the palette's category menu: after the
 * categories, so it sits at the right end of a horizontal palette and at the bottom of a vertical one.
 */
export function attachPaletteVisibilityButton(menu: HTMLElement, getLocale: () => string, onOpen: () => void) {
    const doc = menu.ownerDocument;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'tw-palette-visibility-button';
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 -960 960 960');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', eventListPath);
    svg.append(path);
    button.append(svg);
    const label = () => {
        const text = buttonLabel(getLocale());
        button.setAttribute('aria-label', text);
        button.title = text;
    };
    label();
    // The category menu reacts to presses on its items; this one only opens the settings.
    const press = (event: Event) => event.stopPropagation();
    button.addEventListener('mousedown', press);
    button.addEventListener('pointerdown', press);
    button.addEventListener('click', event => {
        event.stopPropagation();
        onOpen();
    });
    menu.append(button);
    return {
        button,
        /** Puts the button back at the end after the host rebuilds the menu, and follows the locale. */
        update() {
            label();
            if (button.parentElement !== menu || menu.lastElementChild !== button) menu.append(button);
        },
        dispose() {button.remove();}
    };
}
