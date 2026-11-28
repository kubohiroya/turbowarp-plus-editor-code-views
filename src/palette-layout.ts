/**
 * Block palette layouts: arrangements of the palette's block groups that the person makes in the block palette
 * editor, several per project, one shown at a time.
 *
 * A layout is a row of items: references to block groups, folders that hold references, and separators. Each group
 * reference and folder is either always open (its members shown in the palette that shows it, as a pinned group) or
 * opened on demand (its members in a child palette that opens from its icon). A group may be referenced more than
 * once across layouts, and the palette draws the first reference of the shown layout.
 *
 * The layouts are kept with the rest of the palette settings, in the editor's screen state.
 */
import type {PaletteOrder} from './palette-category-visibility.ts';

/** How an item shows its members: always open in place, or in a child palette that opens and closes by itself. */
export type PaletteLayoutMode = 'open' | 'auto';

export interface PaletteLayoutGroup {
    kind: 'group';
    /** Unique within the layout. */
    key: string;
    /** The block group's category ID. */
    ref: string;
    /** A name to show in place of the group's own. */
    label?: string;
    mode: PaletteLayoutMode;
}

export interface PaletteLayoutFolder {
    kind: 'folder';
    key: string;
    label: string;
    mode: PaletteLayoutMode;
    items: PaletteLayoutGroup[];
}

export interface PaletteLayoutSeparator {
    kind: 'separator';
    key: string;
}

export type PaletteLayoutItem = PaletteLayoutGroup | PaletteLayoutFolder | PaletteLayoutSeparator;

export interface PaletteLayout {
    id: string;
    name: string;
    items: PaletteLayoutItem[];
    /**
     * Whether this is the default layout, which cannot be removed and always holds every block group in the order of
     * the editor's source panel; its own `items` are not used (see {@link materializePaletteLayout}).
     */
    builtin?: boolean;
}

/** The ID of the default layout. */
export const defaultLayoutId = 'default';

/** The block groups in the order the editor's source panel was arranged into; groups not arranged keep their order. */
export function orderSourceGroups<T extends string | {id: string}>(groups: readonly T[], sourceOrder: readonly string[] = []): T[] {
    const idOf = (group: T) => typeof group === 'string' ? group : group.id;
    const rank = (group: T, index: number) => {
        const at = sourceOrder.indexOf(idOf(group));
        return at < 0 ? sourceOrder.length + index : at;
    };
    return groups.map((group, index) => ({group, rank: rank(group, index)})).sort((a, b) => a.rank - b.rank)
        .map(entry => entry.group);
}

/** The layouts with the default one first, added when they have none. */
export function withDefaultLayout(saved: SavedPaletteLayouts | undefined, name: string): SavedPaletteLayouts {
    const layouts = saved?.layouts ?? [];
    const next: SavedPaletteLayouts = {...(saved ?? {layouts: []}), layouts: [...layouts]};
    if (!layouts.some(layout => layout.builtin)) next.layouts.unshift({id: defaultLayoutId, name, items: [], builtin: true});
    if (!next.active || !next.layouts.some(layout => layout.id === next.active)) next.active = next.layouts[0].id;
    return next;
}

/** The layout with its items: the default one holds every group in the source panel's order. */
export function materializePaletteLayout(layout: PaletteLayout, groups: readonly string[], sourceOrder?: readonly string[]):
    PaletteLayout {
    if (!layout.builtin) return layout;
    return {...layout, items: orderSourceGroups(groups, sourceOrder)
        .map(ref => ({kind: 'group', key: `${defaultLayoutId}:${ref}`, ref, mode: 'auto'}))};
}

/** A copy of a layout under a new ID and name, every item with a new key, that can be edited and removed. */
export function duplicatePaletteLayout(layout: PaletteLayout, name: string): PaletteLayout {
    const rekey = <T extends PaletteLayoutItem>(item: T): T => item.kind === 'folder' ?
        {...item, key: newLayoutKey(), items: item.items.map(rekey)} : {...item, key: newLayoutKey()};
    return {id: newLayoutKey('l'), name, items: structuredClone(layout.items).map(rekey)};
}

/** The layouts of a project, the one the palette shows, and the order of the editor's source panel. */
export interface SavedPaletteLayouts {
    layouts: PaletteLayout[];
    active?: string;
    sourceOrder?: string[];
}

/** Where an item is: at `index` of the layout, or, with `child`, at `child` of the folder there. */
export interface PaletteLayoutPath {
    index: number;
    child?: number;
}

/** The prefix of the category ID a folder is drawn with in the palette. */
export const layoutFolderPrefix = 'tw-layout-folder-';
export const folderCategoryId = (folder: Pick<PaletteLayoutFolder, 'key'>) => `${layoutFolderPrefix}${folder.key}`;

let counter = 0;
/** A key no other item of this session has. */
export const newLayoutKey = (prefix = 'i') =>
    `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value : undefined;
const mode = (value: unknown): PaletteLayoutMode => value === 'open' ? 'open' : 'auto';

function parseGroup(value: unknown, keys: Set<string>): PaletteLayoutGroup | undefined {
    if (!isRecord(value) || value.kind !== 'group' || !text(value.ref)) return undefined;
    const key = uniqueKey(text(value.key), keys);
    const group: PaletteLayoutGroup = {kind: 'group', key, ref: value.ref as string, mode: mode(value.mode)};
    if (text(value.label)) group.label = value.label as string;
    return group;
}
function uniqueKey(key: string | undefined, keys: Set<string>) {
    let result = key && !keys.has(key) ? key : newLayoutKey();
    while (keys.has(result)) result = newLayoutKey();
    keys.add(result);
    return result;
}
function parseItem(value: unknown, keys: Set<string>): PaletteLayoutItem | undefined {
    if (!isRecord(value)) return undefined;
    if (value.kind === 'separator') return {kind: 'separator', key: uniqueKey(text(value.key), keys)};
    if (value.kind === 'folder') {
        const items = Array.isArray(value.items) ? value.items.map(item => parseGroup(item, keys))
            .filter((item): item is PaletteLayoutGroup => !!item) : [];
        return {kind: 'folder', key: uniqueKey(text(value.key), keys), label: text(value.label) ?? '', mode: mode(value.mode), items};
    }
    return parseGroup(value, keys);
}

/** Takes saved layouts, leaving out what is not well formed. A value that is not saved layouts gives none. */
export function parsePaletteLayouts(value: unknown): SavedPaletteLayouts | undefined {
    if (!isRecord(value) || !Array.isArray(value.layouts)) return undefined;
    const ids = new Set<string>();
    const layouts: PaletteLayout[] = [];
    for (const entry of value.layouts) {
        if (!isRecord(entry)) continue;
        const id = uniqueKey(text(entry.id), ids);
        const keys = new Set<string>();
        const items = Array.isArray(entry.items) ? entry.items.map(item => parseItem(item, keys))
            .filter((item): item is PaletteLayoutItem => !!item) : [];
        const layout: PaletteLayout = {id, name: text(entry.name) ?? '', items};
        if (entry.builtin === true && !layouts.some(item => item.builtin)) layout.builtin = true;
        layouts.push(layout);
    }
    const saved: SavedPaletteLayouts = {layouts};
    const active = text(value.active);
    if (active && ids.has(active)) saved.active = active;
    if (Array.isArray(value.sourceOrder) && value.sourceOrder.every(item => typeof item === 'string')) {
        saved.sourceOrder = [...value.sourceOrder as string[]];
    }
    return saved;
}

/**
 * The layout the palette shows, or nothing when none is chosen or the chosen one is empty. The default layout is
 * given with its items when the block groups on offer are given, and is left out otherwise.
 */
export function activePaletteLayout(saved: SavedPaletteLayouts | undefined, groups?: readonly string[]): PaletteLayout | undefined {
    const chosen = saved?.layouts.find(item => item.id === saved.active);
    if (chosen?.builtin && !groups) return undefined;
    const layout = chosen && materializePaletteLayout(chosen, groups ?? [], saved?.sourceOrder);
    return layout && layout.items.some(item => item.kind !== 'separator') ? layout : undefined;
}

/** How many times each block group is referenced in the layout, folders included. */
export function layoutUsage(layout: PaletteLayout | undefined): Map<string, number> {
    const counts = new Map<string, number>();
    const count = (group: PaletteLayoutGroup) => counts.set(group.ref, (counts.get(group.ref) ?? 0) + 1);
    for (const item of layout?.items ?? []) {
        if (item.kind === 'group') count(item);
        else if (item.kind === 'folder') item.items.forEach(count);
    }
    return counts;
}

/** Whether the layout references the block group, directly or in a folder. */
export const layoutReferences = (layout: PaletteLayout, ref: string) => layoutUsage(layout).has(ref);

/* Edits. Each returns a new layout and leaves the one given as it was. */

const clone = (layout: PaletteLayout): PaletteLayout => structuredClone(layout);

export function itemAt(layout: PaletteLayout, path: PaletteLayoutPath): PaletteLayoutItem | undefined {
    const item = layout.items[path.index];
    if (path.child === undefined) return item;
    return item?.kind === 'folder' ? item.items[path.child] : undefined;
}

/** Adds an item at the end of the layout. */
export function appendLayoutItem(layout: PaletteLayout, item: PaletteLayoutItem): PaletteLayout {
    const next = clone(layout);
    next.items.push(item);
    return next;
}

/** Removes an item; a folder goes with the references in it. */
export function removeLayoutItem(layout: PaletteLayout, path: PaletteLayoutPath): PaletteLayout {
    const next = clone(layout);
    const folder = next.items[path.index];
    if (path.child === undefined) next.items.splice(path.index, 1);
    else if (folder?.kind === 'folder') folder.items.splice(path.child, 1);
    return next;
}

/** Changes the label or mode of an item. An empty label returns a group to its own name. */
export function updateLayoutItem(layout: PaletteLayout, path: PaletteLayoutPath,
    change: {label?: string; mode?: PaletteLayoutMode}): PaletteLayout {
    const next = clone(layout);
    const item = itemAt(next, path);
    if (!item || item.kind === 'separator') return layout;
    if (change.mode) item.mode = change.mode;
    if (change.label !== undefined) {
        if (item.kind === 'folder') item.label = change.label;
        else if (change.label.trim()) item.label = change.label;
        else delete item.label;
    }
    return next;
}

/**
 * Where a dragged item lands, by the keys of the items around it: before an item (at the top level or in a folder),
 * into a folder, or at the end of the layout or of a folder.
 */
export type PaletteLayoutDrop =
    | {before: string}
    | {into: string}
    | {end: true; folder?: string};

/** The path of the item with the key, or nothing when the layout has none. */
export function pathOfKey(layout: PaletteLayout, key: string): PaletteLayoutPath | undefined {
    for (let index = 0; index < layout.items.length; index++) {
        const item = layout.items[index];
        if (item.key === key) return {index};
        if (item.kind === 'folder') {
            const child = item.items.findIndex(group => group.key === key);
            if (child >= 0) return {index, child};
        }
    }
    return undefined;
}

/**
 * Inserts an item where it was dropped. Only group references go into folders: a folder or separator dropped in a
 * folder lands before or after that folder instead. A drop on an item the layout does not have adds it at the end.
 */
export function insertLayoutItem(layout: PaletteLayout, item: PaletteLayoutItem, drop: PaletteLayoutDrop): PaletteLayout {
    const next = clone(layout);
    const folderIndex = (key: string | undefined) => key === undefined ? -1 :
        next.items.findIndex(entry => entry.kind === 'folder' && entry.key === key);
    if ('into' in drop || ('end' in drop && drop.folder !== undefined)) {
        const index = folderIndex('into' in drop ? drop.into : drop.folder);
        const folder = next.items[index];
        if (folder?.kind === 'folder' && item.kind === 'group') folder.items.push(item);
        else if (index >= 0) next.items.splice('into' in drop ? index : index + 1, 0, item);
        else next.items.push(item);
        return next;
    }
    if ('end' in drop) {
        next.items.push(item);
        return next;
    }
    const at = pathOfKey(next, drop.before);
    if (!at) next.items.push(item);
    else if (at.child === undefined) next.items.splice(at.index, 0, item);
    else if (item.kind === 'group') (next.items[at.index] as PaletteLayoutFolder).items.splice(at.child, 0, item);
    else next.items.splice(at.index, 0, item);
    return next;
}

/** Moves the item with the key to where it was dropped, as {@link insertLayoutItem} places it. */
export function moveLayoutItem(layout: PaletteLayout, key: string, drop: PaletteLayoutDrop): PaletteLayout {
    const from = pathOfKey(layout, key);
    if (!from) return layout;
    if (('before' in drop && drop.before === key) || ('into' in drop && drop.into === key) ||
        ('end' in drop && drop.folder === key)) return layout;
    const item = itemAt(layout, from)!;
    return insertLayoutItem(removeLayoutItem(layout, from), item, drop);
}

/** The category an item is drawn as when each group is referenced once. */
const defaultCategoryOf = (item: PaletteLayoutItem) =>
    item.kind === 'group' ? item.ref : item.kind === 'folder' ? folderCategoryId(item) : undefined;

/** The ID of the category drawn for the `count`th reference (from 1) of a block group, or of a group nested in it. */
export const copyCategoryId = (id: string, count: number) => count > 1 ? `${id}~${count}` : id;

/** Reorders the top-level items by the order of the categories they are drawn as, keeping separators in place. */
export function reorderLayoutByCategories(layout: PaletteLayout, categoryIds: readonly string[],
    categoryOf: (item: PaletteLayoutItem) => string | undefined = defaultCategoryOf): PaletteLayout {
    const idOf = categoryOf;
    const slots = layout.items.map((item, index) => ({item, index, id: idOf(item)}));
    const movable = slots.filter(slot => slot.id !== undefined && categoryIds.includes(slot.id));
    const ordered = [...movable].sort((a, b) => categoryIds.indexOf(a.id!) - categoryIds.indexOf(b.id!));
    const next = clone(layout);
    movable.forEach((slot, position) => {
        next.items[slot.index] = structuredClone(ordered[position].item);
    });
    return next;
}

/** Reorders a folder's references by the order of their categories. */
export function reorderFolderByCategories(layout: PaletteLayout, folderId: string, categoryIds: readonly string[],
    categoryOf: (item: PaletteLayoutItem) => string | undefined = defaultCategoryOf): PaletteLayout {
    const next = clone(layout);
    const folder = next.items.find((item): item is PaletteLayoutFolder => item.kind === 'folder' && folderCategoryId(item) === folderId);
    if (!folder) return layout;
    const rank = (group: PaletteLayoutGroup) => {
        const index = categoryIds.indexOf(categoryOf(group) ?? '');
        return index < 0 ? categoryIds.length : index;
    };
    folder.items.sort((a, b) => rank(a) - rank(b));
    return next;
}

/* Drawing a layout in the palette. */

/** What the palette needs to draw a layout after its toolbox tree was rearranged. */
export interface AppliedPaletteLayout {
    /** The categories shown open in place: always-open groups and folders. */
    pinned: Set<string>;
    /** The categories drawn for the layout's group references and folders, by the item each stands for. */
    placed: Map<string, string>;
    /** The top-level categories that follow a separator; `null` stands for a separator at the end. */
    separatorsBefore: (string | null)[];
    /** The folders' categories. */
    folders: Set<string>;
}

const isCategory = (node: Node): node is Element => node.nodeType === 1 && (node as Element).tagName.toLowerCase() === 'category';

/**
 * Rearranges a toolbox tree, whose extension groups are already nested in their extensions, into the layout: its group
 * references at the top level in order, each folder as a category holding its references, and every block group the
 * layout does not reference removed. A group that holds other groups brings them along unless the layout places one
 * itself. A group referenced again is drawn again, as a copy whose categories' IDs end in `~2`, `~3` and so on.
 */
export function applyPaletteLayoutToTree(tree: Element, layout: PaletteLayout,
    {folderColor = '#8a94a6'}: {folderColor?: string} = {}): AppliedPaletteLayout {
    const doc = tree.ownerDocument;
    const byId = new Map<string, Element>();
    for (const category of Array.from(tree.getElementsByTagName('category'))) {
        const id = category.getAttribute('id');
        if (id && !byId.has(id)) byId.set(id, category);
    }
    // Groups referenced again are drawn from a copy of the tree as it was, without the nested groups the layout
    // places itself, under IDs of their own.
    const pristine = tree.cloneNode(true) as Element;
    const pristineById = new Map<string, Element>();
    for (const category of Array.from(pristine.getElementsByTagName('category'))) {
        const id = category.getAttribute('id');
        if (id && !pristineById.has(id)) pristineById.set(id, category);
    }
    const referenced = new Set(layout.items.flatMap(item => item.kind === 'group' ? [item.ref] :
        item.kind === 'folder' ? item.items.map(group => group.ref) : []));
    const uses = new Map<string, number>();
    const applied: AppliedPaletteLayout = {pinned: new Set(), placed: new Map(), separatorsBefore: [], folders: new Set()};
    const top: Element[] = [];
    let separatorPending = false;
    const take = (group: PaletteLayoutGroup): Element | undefined => {
        const original = byId.get(group.ref);
        if (!original) return undefined;
        const count = (uses.get(group.ref) ?? 0) + 1;
        uses.set(group.ref, count);
        let category = original;
        if (count === 1) original.remove();
        else {
            category = pristineById.get(group.ref)!.cloneNode(true) as Element;
            for (const nested of Array.from(category.getElementsByTagName('category'))) {
                if (referenced.has(nested.getAttribute('id') ?? '')) nested.remove();
            }
            for (const part of [category, ...Array.from(category.getElementsByTagName('category'))]) {
                const id = part.getAttribute('id');
                if (id) part.setAttribute('id', copyCategoryId(id, count));
            }
        }
        const id = category.getAttribute('id')!;
        if (group.label) category.setAttribute('name', group.label);
        applied.placed.set(id, group.key);
        if (group.mode === 'open') applied.pinned.add(id);
        return category;
    };
    const push = (category: Element) => {
        if (separatorPending) applied.separatorsBefore.push(category.getAttribute('id'));
        separatorPending = false;
        top.push(category);
    };
    for (const item of layout.items) {
        if (item.kind === 'separator') {
            if (top.length) separatorPending = true;
            continue;
        }
        if (item.kind === 'group') {
            const category = take(item);
            if (category) push(category);
            continue;
        }
        const members = item.items.map(take).filter((category): category is Element => !!category);
        if (!members.length) continue;
        const folder = doc.createElement('category');
        const id = folderCategoryId(item);
        folder.setAttribute('id', id);
        folder.setAttribute('name', item.label || '📁');
        folder.setAttribute('colour', folderColor);
        folder.setAttribute('secondaryColour', folderColor);
        folder.append(...members);
        applied.folders.add(id);
        applied.placed.set(id, item.key);
        if (item.mode === 'open') applied.pinned.add(id);
        push(folder);
    }
    if (separatorPending) applied.separatorsBefore.push(null);
    for (const child of Array.from(tree.childNodes)) {
        if (isCategory(child) || (child.nodeType === 1 && (child as Element).tagName.toLowerCase() === 'sep')) child.remove();
    }
    tree.append(...top);
    return applied;
}

/**
 * The palette order while a layout is shown: the layout decides the top-level order, the folders' members and which
 * groups and folders are open, and reordering or pinning in the palette edits the layout. Groups the layout does not
 * place itself, such as the groups an extension nests, keep the project's own order.
 */
export function layoutPaletteOrder(base: PaletteOrder, {layout, applied, change}: {
    layout(): PaletteLayout | undefined;
    applied(): AppliedPaletteLayout | undefined;
    change(layout: PaletteLayout): void;
}): PaletteOrder {
    const placedItem = (id: string) => {
        const current = layout();
        const key = applied()?.placed.get(id);
        if (!current || key === undefined) return undefined;
        for (let index = 0; index < current.items.length; index++) {
            const item = current.items[index];
            if (item.key === key) return {current, path: {index}};
            if (item.kind === 'folder') {
                const child = item.items.findIndex(group => group.key === key);
                if (child >= 0) return {current, path: {index, child}};
            }
        }
        return undefined;
    };
    // The category each item was drawn as, copies included.
    const categoryOf = (item: PaletteLayoutItem) => {
        for (const [id, key] of applied()?.placed ?? []) if (key === item.key) return id;
        return undefined;
    };
    return {
        ...base,
        categories: () => layout() ? [] : base.categories(),
        setCategories(ids) {
            const current = layout();
            if (current) change(reorderLayoutByCategories(current, ids, categoryOf));
            else base.setCategories(ids);
        },
        members: groupId => applied()?.folders.has(groupId) ? undefined : base.members(groupId),
        setMembers(groupId, ids) {
            const current = layout();
            if (current && applied()?.folders.has(groupId)) change(reorderFolderByCategories(current, groupId, ids, categoryOf));
            else base.setMembers(groupId, ids);
        },
        isPinned: groupId => applied()?.placed.has(groupId) ? applied()!.pinned.has(groupId) : base.isPinned(groupId),
        setPinned(groupId, pinned) {
            const found = placedItem(groupId);
            if (found) change(updateLayoutItem(found.current, found.path, {mode: pinned ? 'open' : 'auto'}));
            else base.setPinned(groupId, pinned);
        }
    };
}

/** Why an item of a layout is not drawn in the palette. */
export type PaletteLayoutOmission = 'missing' | 'empty' | 'separator';

/**
 * What the palette will draw for a layout, as {@link applyPaletteLayoutToTree} draws it, for previews: the items left
 * out and why, and for each group the nested groups it brings along. `groups` are the block groups the palette offers,
 * each with the group it is nested in.
 */
export function resolvePaletteLayout(layout: PaletteLayout, groups: readonly {id: string; parent?: string}[]): {
    omitted: Map<string, PaletteLayoutOmission>;
    nested(ref: string): string[];
} {
    const offered = new Set(groups.map(group => group.id));
    const referenced = new Set<string>();
    for (const item of layout.items) {
        if (item.kind === 'group') referenced.add(item.ref);
        else if (item.kind === 'folder') item.items.forEach(group => referenced.add(group.ref));
    }
    const omitted = new Map<string, PaletteLayoutOmission>();
    const take = (group: PaletteLayoutGroup) => {
        if (offered.has(group.ref)) return true;
        omitted.set(group.key, 'missing');
        return false;
    };
    let drawn = 0;
    let separatorPending: string | undefined;
    for (const item of layout.items) {
        if (item.kind === 'separator') {
            if (!drawn || separatorPending) omitted.set(item.key, 'separator');
            else separatorPending = item.key;
            continue;
        }
        const shown = item.kind === 'group' ? take(item) : item.items.map(take).some(Boolean);
        if (item.kind === 'folder' && !shown) omitted.set(item.key, 'empty');
        if (shown) {
            drawn++;
            separatorPending = undefined;
        }
    }
    return {
        omitted,
        // A nested group the layout references itself is drawn where the layout puts it, not in its group.
        nested: ref => groups.filter(group => group.parent === ref && !referenced.has(group.id)).map(group => group.id)
    };
}
