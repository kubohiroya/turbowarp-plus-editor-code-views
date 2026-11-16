/**
 * Which block groups the palette shows for each sprite and the stage.
 *
 * The settings belong to the editor, not to the project's code: they are kept in memory per target and saved with
 * the editor's own screen state (a slice of `tw-plus/workspace.json` in an SB3, `.tw-plus/workspace.json` in a
 * project folder), the same way the tab layout is. Hiding a group changes only what the palette offers; blocks
 * already in the code stay visible and editable.
 */

/** The standard groups, by the palette's category IDs. `lists` is Plus's own split of `variables`. */
export const standardGroups = ['motion', 'looks', 'sound', 'events', 'control', 'sensing', 'operators', 'variables', 'lists',
    'myBlocks'] as const;

/** A named set of groups the project keeps. */
export interface SavedGroupSet {
    name: string;
    groups: string[];
}

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

/** The sets every project has, then the project's own sets. */
export function paletteGroupSets(locale?: string, projectSets: Record<string, SavedGroupSet> = {}): PaletteGroupSet[] {
    const builtin = Object.keys(builtinSetGroups).map(id => ({
        id, name: builtinSetNames[id][japanese(locale) ? 'ja' : 'en'], groups: builtinSetGroups[id]
    }));
    return builtin.concat(Object.entries(projectSets).map(([id, set]) => ({id, name: set.name, groups: set.groups})));
}

const standardPrefixes: Record<string, string> = {
    motion: 'motion', looks: 'looks', sound: 'sound', event: 'events', control: 'control', sensing: 'sensing',
    operator: 'operators', procedures: 'myBlocks', argument: 'myBlocks'
};

/**
 * One block group an extension offers. An extension that declares no groups offers one, named and identified like
 * the extension. One that declares `groups: [{id, name, color1?, color2?, color3?, menuIconURI?}]` in `getInfo()` and
 * marks blocks with `paletteGroup` offers each group as `extensionId/groupId`, and its unmarked blocks as one more
 * group with the extension's ID. Standard TurboWarp ignores both fields and shows the extension as one category.
 */
export interface ExtensionPaletteGroup {
    id: string;
    extensionId: string;
    /** The group's own name; for the unmarked blocks, the extension's name. */
    name: string;
    extensionName: string;
    /** Whether this is a group the extension declares, rather than its unmarked blocks. */
    declared: boolean;
    color1?: string;
    color2?: string;
    menuIconURI?: string;
}

/** The extension groups the project's extensions offer, and which group each of their blocks belongs to. */
export interface PaletteGroupCatalog {
    groups: readonly ExtensionPaletteGroup[];
    /** Block opcode to group ID, for the blocks of declared groups. */
    groupOf: ReadonlyMap<string, string>;
}

/** A declared group as kept on the VM's category info. */
interface DeclaredGroup {
    id: string;
    name: GroupName;
    color1?: string;
    color2?: string;
    color3?: string;
    menuIconURI?: string;
}
/** The parts of the VM's category info (`runtime._blockInfo`) this module reads. */
export interface PaletteCategoryInfo {
    id: string;
    name?: string;
    color1?: string;
    color2?: string;
    menuIconURI?: string;
    blockIconURI?: string;
    /** The groups the extension declares, kept by {@link installExtensionPaletteGroups}. */
    paletteGroups?: unknown;
    blocks?: readonly {info?: {paletteGroup?: unknown}; json?: {type?: unknown} | null}[];
}

/**
 * A group's display name: one text, or one per locale such as `{en: 'Speech', ja: 'セリフ'}`. A line break (`\n`)
 * starts a new line in the palette and the settings screen.
 */
export type GroupName = string | Readonly<Record<string, string>>;

/** The name to show in `locale`: that locale, then its language, then English, then the first one given. */
export function resolveGroupName(name: GroupName, locale?: string): string {
    if (typeof name === 'string') return name;
    const entries = Object.entries(name);
    const wanted = (locale ?? '').toLowerCase();
    const language = wanted.split(/[-_]/)[0];
    return entries.find(([key]) => key.toLowerCase() === wanted)?.[1] ??
        entries.find(([key]) => key.toLowerCase() === language)?.[1] ??
        entries.find(([key]) => key.toLowerCase().split(/[-_]/)[0] === language && language)?.[1] ??
        entries.find(([key]) => key.toLowerCase() === 'en')?.[1] ?? entries[0]?.[1] ?? '';
}

/** A name as `getInfo()` gives it, or nothing when it is neither a text nor texts by locale. */
function groupName(value: unknown): GroupName | undefined {
    if (typeof value === 'string') return value || undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const names = Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''));
    return Object.keys(names).length ? names : undefined;
}

const groupIdPattern = /^[A-Za-z0-9_-]+$/;
const optionalString = (value: unknown) => typeof value === 'string' && value ? value : undefined;
/** The groups `getInfo()` declares, leaving out any that are not well formed or repeat an ID. */
function declaredGroups(value: unknown): DeclaredGroup[] {
    if (!Array.isArray(value)) return [];
    const groups: DeclaredGroup[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const {id, name} = item as Record<string, unknown>;
        if (typeof id !== 'string' || !groupIdPattern.test(id) || groups.some(group => group.id === id)) continue;
        const entry = item as Record<string, unknown>;
        groups.push({id, name: groupName(name) ?? id, color1: optionalString(entry.color1),
            color2: optionalString(entry.color2), color3: optionalString(entry.color3),
            menuIconURI: optionalString(entry.menuIconURI)});
    }
    return groups;
}

/**
 * Keeps the groups each extension declares on its category info, where {@link extensionPaletteCatalog} reads them,
 * and draws the blocks of a group with a colour of its own in the group's colours. Install it before extensions load.
 * Returns the function that removes it.
 */
export function installExtensionPaletteGroups(runtime: {_fillExtensionCategory?: (...args: any[]) => unknown}): () => void {
    const original = runtime._fillExtensionCategory;
    if (typeof original !== 'function') return () => {};
    const wrapped = function (this: unknown, categoryInfo: any, extensionInfo: any, ...rest: unknown[]) {
        const result = original.call(this, categoryInfo, extensionInfo, ...rest);
        const groups = declaredGroups(extensionInfo?.groups);
        if (categoryInfo && typeof categoryInfo === 'object') {
            categoryInfo.paletteGroups = groups;
            for (const block of Array.isArray(categoryInfo.blocks) ? categoryInfo.blocks : []) {
                const group = groups.find(item => item.id === block?.info?.paletteGroup);
                if (!group?.color1 || !block.json || block.info.color1 !== undefined) continue;
                block.json.colour = group.color1;
                if (group.color2) block.json.colourSecondary = group.color2;
                if (group.color3) block.json.colourTertiary = group.color3;
            }
        }
        return result;
    };
    runtime._fillExtensionCategory = wrapped;
    return () => {
        if (runtime._fillExtensionCategory === wrapped) runtime._fillExtensionCategory = original;
    };
}

/** The groups of the loaded extensions, in palette order, from the VM's category info, named in `locale`. */
export function extensionPaletteCatalog(categories: readonly PaletteCategoryInfo[] = [], locale?: string): PaletteGroupCatalog {
    const groups: ExtensionPaletteGroup[] = [];
    const groupOf = new Map<string, string>();
    for (const category of categories) {
        const extensionName = category.name || category.id;
        const declared = declaredGroups(category.paletteGroups);
        const used = new Set<string>();
        let unmarked = declared.length === 0;
        for (const block of category.blocks ?? []) {
            const opcode = block?.json?.type;
            if (typeof opcode !== 'string') continue;
            const group = declared.find(item => item.id === block.info?.paletteGroup);
            if (!group) {
                unmarked = true;
                continue;
            }
            groupOf.set(opcode, `${category.id}/${group.id}`);
            used.add(group.id);
        }
        const menuIconURI = category.menuIconURI || category.blockIconURI || undefined;
        if (unmarked) {
            groups.push({id: category.id, extensionId: category.id, name: extensionName, extensionName, declared: false,
                color1: category.color1, color2: category.color2, menuIconURI});
        }
        for (const group of declared) {
            if (!used.has(group.id)) continue;
            groups.push({id: `${category.id}/${group.id}`, extensionId: category.id, name: resolveGroupName(group.name, locale), extensionName,
                declared: true, color1: group.color1 ?? category.color1, color2: group.color2 ?? category.color2,
                menuIconURI: group.menuIconURI ?? menuIconURI});
        }
    }
    return {groups, groupOf};
}

/** The group a block belongs to, or null for a block no palette group offers. */
export function groupOfOpcode(opcode: string, catalog?: PaletteGroupCatalog): string | null {
    const declared = catalog?.groupOf.get(opcode);
    if (declared) return declared;
    const separator = opcode.indexOf('_');
    if (separator <= 0) return null;
    const prefix = opcode.slice(0, separator);
    if (prefix === 'data') return /list/i.test(opcode.slice(separator + 1)) ? 'lists' : 'variables';
    return standardPrefixes[prefix] ?? prefix;
}

type BlockLike = {opcode?: string; shadow?: boolean};
/** The parts of a VM target this module reads. */
export interface PaletteTarget {
    id: string;
    isStage: boolean;
    getName(): string;
    blocks?: {_blocks?: Record<string, BlockLike>};
}

/** How many blocks of each group the target's code uses. Menus and other shadow blocks are not counted. */
export function usedGroups(target: Pick<PaletteTarget, 'blocks'>, catalog?: PaletteGroupCatalog): Map<string, number> {
    const counts = new Map<string, number>();
    for (const block of Object.values(target.blocks?._blocks ?? {})) {
        if (!block || block.shadow || typeof block.opcode !== 'string') continue;
        const group = groupOfOpcode(block.opcode, catalog);
        if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return counts;
}

/**
 * The groups shown when a target has no setting of its own: every standard group, and the groups of
 * the extension groups its code already uses, so a project opens with nothing missing. `extensionGroups` are the
 * IDs of the extension groups on offer: the extension IDs, or with a catalog, its group IDs.
 */
export function defaultVisibleGroups(target: Pick<PaletteTarget, 'blocks'>, extensionGroups: readonly string[],
    catalog?: PaletteGroupCatalog): string[] {
    const used = usedGroups(target, catalog);
    return [...standardGroups, ...extensionGroups.filter(id => used.has(id))];
}

/**
 * Splits each extension category whose extension declares groups into one category per group, in the catalog's
 * order. A label, separator or button goes with the block after it, or with the last block when none follows.
 */
export function splitExtensionCategories(tree: Element, catalog: PaletteGroupCatalog): void {
    for (const category of Array.from(tree.querySelectorAll(':scope > category'))) {
        const extensionId = category.getAttribute('id');
        const groups = catalog.groups.filter(group => group.extensionId === extensionId);
        if (!extensionId || !groups.some(group => group.declared)) continue;
        const items = new Map<string, Element[]>();
        let pending: Element[] = [];
        let last = extensionId;
        for (const child of Array.from(category.children)) {
            if (child.tagName.toLowerCase() !== 'block') {
                pending.push(child);
                continue;
            }
            last = catalog.groupOf.get(child.getAttribute('type') ?? '') ?? extensionId;
            items.set(last, [...items.get(last) ?? [], ...pending, child]);
            pending = [];
        }
        if (pending.length) items.set(last, [...items.get(last) ?? [], ...pending]);
        let first = true;
        for (const group of groups) {
            const children = items.get(group.id);
            if (!children) continue;
            const part = category.cloneNode(false) as Element;
            part.setAttribute('id', group.id);
            part.setAttribute('name', group.name);
            if (group.color1) part.setAttribute('colour', group.color1);
            if (group.color2) part.setAttribute('secondaryColour', group.color2);
            if (group.menuIconURI) part.setAttribute('iconURI', group.menuIconURI);
            if (!first) part.removeAttribute('showStatusButton');
            first = false;
            part.append(...children);
            category.before(part);
        }
        category.remove();
    }
}

/**
 * Removes the categories the target does not show from a parsed toolbox, before the palette is drawn from it.
 * With a catalog, an extension that declares groups is first split into a category per group.
 */
export function filterToolboxTree(tree: Element | null | undefined, visible: ReadonlySet<string>,
    catalog?: PaletteGroupCatalog): void {
    if (!tree) return;
    if (catalog) splitExtensionCategories(tree, catalog);
    for (const category of Array.from(tree.querySelectorAll(':scope > category'))) {
        const id = category.getAttribute('id');
        if (id && !visible.has(id)) category.remove();
    }
}

/** The screen-state slice the settings are saved as. Sprites are named as the tab layout names them. */
export const paletteScreenStateKey = 'blockPalette';
export interface SavedPaletteVisibility {
    version: 1;
    stage?: {groups: string[]};
    sprites?: Record<string, {groups: string[]}>;
    sets?: Record<string, SavedGroupSet>;
}

const strings = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every(item => typeof item === 'string') ? [...value] : undefined;
const sameGroups = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length && new Set(left).size === left.length && left.every(group => right.includes(group));

export interface PaletteVisibilityStore {
    /**
     * The groups the palette shows for the target. `extensionIds` are the extension groups on offer: the extension
     * IDs, or the group IDs of a catalog when the store was given one.
     */
    visible(target: PaletteTarget, extensionIds: readonly string[]): Set<string>;
    /** Keeps the target's groups. Groups equal to its default leave it without a setting of its own. */
    set(target: PaletteTarget, groups: readonly string[], extensionIds: readonly string[]): void;
    /** A new sprite made from another, such as a duplicate, starts with its setting. */
    copy(from: Pick<PaletteTarget, 'id'>, to: Pick<PaletteTarget, 'id'>): void;
    /** The project's own sets. */
    sets(): Record<string, SavedGroupSet>;
    addSets(sets: readonly PaletteGroupSet[]): void;
    /** The slice to save, or nothing when no target has a setting and the project has no sets. */
    capture(targets: readonly PaletteTarget[]): SavedPaletteVisibility | undefined;
    /** Takes the settings of a loaded project. A value that is not a saved slice leaves every target at its default. */
    apply(value: unknown, targets: readonly PaletteTarget[]): void;
    /** Forgets every setting, for a project without any. */
    reset(): void;
}

/** The settings of one project, by runtime target ID, so a renamed sprite keeps its setting. */
export function createPaletteVisibilityStore({catalog}: {
    /** The extension groups on offer now, so the default counts the blocks of declared groups. */
    catalog?: () => PaletteGroupCatalog | undefined;
} = {}): PaletteVisibilityStore {
    const defaults = (target: PaletteTarget, extensionIds: readonly string[]) =>
        defaultVisibleGroups(target, extensionIds, catalog?.());
    let groups = new Map<string, string[]>();
    let projectSets: Record<string, SavedGroupSet> = {};
    return {
        visible(target, extensionIds) {
            return new Set(groups.get(target.id) ?? defaults(target, extensionIds));
        },
        set(target, chosen, extensionIds) {
            if (sameGroups(chosen, defaults(target, extensionIds))) groups.delete(target.id);
            else groups.set(target.id, [...chosen]);
        },
        copy(from, to) {
            const chosen = groups.get(from.id);
            if (chosen) groups.set(to.id, [...chosen]);
        },
        sets: () => ({...projectSets}),
        addSets(sets) {
            for (const set of sets) projectSets[set.id] = {name: set.name, groups: [...set.groups]};
        },
        capture(targets) {
            const saved: SavedPaletteVisibility = {version: 1};
            const sprites: Record<string, {groups: string[]}> = {};
            for (const target of targets) {
                const chosen = groups.get(target.id);
                if (!chosen) continue;
                if (target.isStage) saved.stage = {groups: [...chosen]};
                else sprites[target.getName()] = {groups: [...chosen]};
            }
            if (Object.keys(sprites).length) saved.sprites = sprites;
            if (Object.keys(projectSets).length) saved.sets = structuredClone(projectSets);
            return saved.stage || saved.sprites || saved.sets ? saved : undefined;
        },
        apply(value, targets) {
            groups = new Map();
            projectSets = {};
            if (!value || typeof value !== 'object' || (value as {version?: unknown}).version !== 1) return;
            const saved = value as Record<string, unknown>;
            const setting = (entry: unknown) => entry && typeof entry === 'object' ?
                strings((entry as {groups?: unknown}).groups) : undefined;
            const sprites = saved.sprites && typeof saved.sprites === 'object' ? saved.sprites as Record<string, unknown> : {};
            for (const target of targets) {
                const chosen = target.isStage ? setting(saved.stage) :
                    Object.hasOwn(sprites, target.getName()) ? setting(sprites[target.getName()]) : undefined;
                if (chosen) groups.set(target.id, chosen);
            }
            if (saved.sets && typeof saved.sets === 'object') {
                for (const [id, set] of Object.entries(saved.sets as Record<string, unknown>)) {
                    const name = set && typeof set === 'object' ? (set as {name?: unknown}).name : undefined;
                    const members = setting(set);
                    if (typeof name === 'string' && members) projectSets[id] = {name, groups: members};
                }
            }
        },
        reset() {
            groups = new Map();
            projectSets = {};
        }
    };
}

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
