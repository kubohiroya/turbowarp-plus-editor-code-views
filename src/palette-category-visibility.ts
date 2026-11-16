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

/** The menu item that opens the group settings. */
export const paletteVisibilityMenuLabel = (locale: string) => japanese(locale) ? 'ブロックグループの表示・非表示の設定' :
    'Show or hide block groups';

export interface PaletteMenuItem {
    label: string;
    onSelect(): void;
    /** Draws a separator above the item. */
    separated?: boolean;
}

const menuButtonLabel = (locale: string) => japanese(locale) ? 'パレットのメニュー' : 'Palette menu';

/**
 * Adds a ▼ button at the end of the palette's category menu: after the categories, so it sits at the
 * right end of a horizontal palette and at the bottom of a vertical one. Pressing it lists the items
 * the host gives — the group settings and the host's extension items — and runs the one chosen.
 */
export function attachPaletteMenuButton(menu: HTMLElement, getLocale: () => string,
    getItems: (locale: string) => readonly PaletteMenuItem[]) {
    const doc = menu.ownerDocument;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'tw-palette-menu-button';
    button.textContent = '▼';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    const label = () => {
        const text = menuButtonLabel(getLocale());
        button.setAttribute('aria-label', text);
        button.title = text;
    };
    label();
    let popup: HTMLElement | null = null;
    const closeMenu = (focusButton = false) => {
        if (!popup) return;
        popup.remove();
        popup = null;
        button.setAttribute('aria-expanded', 'false');
        doc.removeEventListener('pointerdown', outside, true);
        doc.removeEventListener('keydown', keys, true);
        if (focusButton) button.focus();
    };
    const outside = (event: Event) => {
        if (popup && !popup.contains(event.target as Node) && event.target !== button) closeMenu();
    };
    const keys = (event: KeyboardEvent) => {
        if (!popup) return;
        const items = Array.from(popup.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        const index = items.indexOf(doc.activeElement as HTMLButtonElement);
        if (event.key === 'Escape') {
            event.preventDefault();
            closeMenu(true);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            items[(index + step + items.length) % items.length]?.focus();
        }
    };
    const openMenu = () => {
        const locale = getLocale();
        const items = getItems(locale);
        if (!items.length) return;
        popup = doc.createElement('div');
        popup.className = 'tw-palette-menu';
        popup.setAttribute('role', 'menu');
        popup.setAttribute('aria-label', menuButtonLabel(locale));
        for (const item of items) {
            if (item.separated && popup.childElementCount) {
                const separator = doc.createElement('div');
                separator.setAttribute('role', 'separator');
                popup.append(separator);
            }
            const entry = doc.createElement('button');
            entry.type = 'button';
            entry.setAttribute('role', 'menuitem');
            entry.textContent = item.label;
            entry.addEventListener('click', event => {
                event.stopPropagation();
                closeMenu();
                item.onSelect();
            });
            popup.append(entry);
        }
        const rect = button.getBoundingClientRect();
        const view = doc.defaultView;
        popup.style.position = 'fixed';
        popup.style.top = `${rect.bottom + 4}px`;
        popup.style.right = `${Math.max(4, (view?.innerWidth ?? rect.right) - rect.right)}px`;
        doc.body.append(popup);
        button.setAttribute('aria-expanded', 'true');
        doc.addEventListener('pointerdown', outside, true);
        doc.addEventListener('keydown', keys, true);
        popup.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    };
    // The category menu reacts to presses on its items; this one only opens its own menu.
    const press = (event: Event) => event.stopPropagation();
    button.addEventListener('mousedown', press);
    button.addEventListener('pointerdown', press);
    button.addEventListener('click', event => {
        event.stopPropagation();
        if (popup) closeMenu();
        else openMenu();
    });
    menu.append(button);
    return {
        button,
        /** Puts the button back at the end after the host rebuilds the menu, and follows the locale. */
        update() {
            label();
            if (button.parentElement !== menu || menu.lastElementChild !== button) menu.append(button);
        },
        close: () => closeMenu(),
        dispose() {
            closeMenu();
            button.remove();
        }
    };
}
