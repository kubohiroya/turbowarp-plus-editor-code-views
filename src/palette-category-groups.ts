import {filterToolboxTree, splitExtensionCategories} from './palette-category-visibility.ts';
import {createPaletteOrder} from './palette-category-visibility.ts';
import type {PaletteGroupCatalog, PaletteOrder} from './palette-category-visibility.ts';
import {attachPaletteCategoryReorder} from './palette-category-reorder.ts';

/**
 * Block palette groups: a category of the toolbox XML that holds other categories is a group. Scratch Blocks
 * reads only the top-level categories and drops nested ones, so the tree is flattened before it is drawn:
 * each nested category becomes a top-level one right after its group, and the menu hides it. Clicking the
 * group's icon then shows its members in a child palette laid out like the palette it opens from — a row to the
 * right of the icon for a horizontal palette, a column below it for a vertical one — and a member that is itself
 * a group opens the next level the same way. A click outside the child palettes closes them.
 */

/** The attribute a flattened category keeps with the id of the group it was nested in. */
export const groupParentAttribute = 'palette-group-parent';

export interface PaletteGroups {
    /** Each group's members, in order, by category id. A member may itself be a group. */
    members: Map<string, string[]>;
    /** The groups that also hold blocks of their own, which their child palette offers first. */
    withOwnContents: Set<string>;
}

const isCategory = (node: Node): node is Element =>
    node.nodeType === 1 && (node as Element).tagName.toLowerCase() === 'category';
const ownsContents = (category: Element) => Array.from(category.children).some(child => !isCategory(child));

/**
 * Moves every nested category of the toolbox tree to the top level, right after the group that held it, depth
 * first, so Scratch Blocks makes a category of each. Returns the groups found. A nested category without an id
 * gets one from its group's id and its position.
 */
export const flattenCategoryGroups = (tree: Element | null | undefined): PaletteGroups => {
    const groups: PaletteGroups = {members: new Map(), withOwnContents: new Set()};
    if (!tree) return groups;
    const used = new Set(Array.from(tree.querySelectorAll('category[id]'), category => category.getAttribute('id')));
    const flatten = (category: Element, after: Element): Element => {
        const nested = Array.from(category.children).filter(isCategory);
        if (!nested.length) return after;
        const id = category.getAttribute('id')!;
        groups.members.set(id, []);
        if (ownsContents(category)) groups.withOwnContents.add(id);
        let last = after;
        nested.forEach((child, index) => {
            if (!child.getAttribute('id')) {
                let generated = `${id}/${index}`;
                while (used.has(generated)) generated += '_';
                used.add(generated);
                child.setAttribute('id', generated);
            }
            child.setAttribute(groupParentAttribute, id);
            groups.members.get(id)!.push(child.getAttribute('id')!);
            last.after(child);
            last = flatten(child, child);
        });
        return last;
    };
    for (const category of Array.from(tree.children).filter(isCategory)) {
        if (!category.getAttribute('id')) continue;
        flatten(category, category);
    }
    return groups;
};

/**
 * Runs a filter that removes top-level categories by id, such as the palette's group settings, on a flattened tree.
 * A group the filter removes still stays, without blocks of its own, while one of its members stays; a group left
 * with neither members nor blocks of its own is removed with its members. Returns the groups that remain.
 */
export const filterGroupedToolboxTree = (tree: Element, groups: PaletteGroups, filter: (tree: Element) => void):
    PaletteGroups => {
    const elements = new Map<string, Element>();
    const markers = new Map<string, Comment>();
    for (const category of Array.from(tree.children).filter(isCategory)) {
        const id = category.getAttribute('id')!;
        if (!groups.members.has(id)) continue;
        const marker = tree.ownerDocument.createComment('palette-group');
        category.before(marker);
        elements.set(id, category);
        markers.set(id, marker);
    }
    filter(tree);
    const present = (element: Element | undefined) => !!element && element.parentNode === tree;
    const remaining: PaletteGroups = {members: new Map(), withOwnContents: new Set()};
    const keep = (id: string): boolean => {
        const members = groups.members.get(id);
        if (!members) return present(Array.from(tree.children).find(child => isCategory(child) && child.getAttribute('id') === id));
        const kept = members.filter(keep);
        const ownShown = groups.withOwnContents.has(id) && present(elements.get(id));
        if (!kept.length && !ownShown) return false;
        remaining.members.set(id, kept);
        if (ownShown) remaining.withOwnContents.add(id);
        return true;
    };
    for (const [id, element] of elements) {
        if (!element.hasAttribute(groupParentAttribute)) keep(id);
    }
    for (const [id, element] of elements) {
        if (!remaining.members.has(id)) element.remove();
        else if (!present(element)) {
            // Shown only as the way to its members.
            element.replaceChildren();
            markers.get(id)!.after(element);
        }
    }
    for (const marker of markers.values()) marker.remove();
    // A member whose group is gone goes with it.
    for (const category of Array.from(tree.children).filter(isCategory)) {
        const parent = category.getAttribute(groupParentAttribute);
        if (parent && !remaining.members.has(parent)) category.remove();
    }
    return remaining;
};

export interface PrepareToolboxOptions {
    catalog?: PaletteGroupCatalog;
    visible?: ReadonlySet<string> | null;
    /**
     * Rearranges the tree once each extension that declares groups is nested, before the nested categories are
     * flattened, such as into a palette layout (see `./palette-layout`).
     */
    arrange?(tree: Element): void;
}

/** Whether the toolbox tree nests categories, which Scratch Blocks drops unless the tree is prepared first. */
export const hasCategoryGroups = (tree: Element | null | undefined): boolean => !!tree?.querySelector?.('category category');

/**
 * Prepares a toolbox tree for the palette before Scratch Blocks draws it: with a catalog, each extension that declares
 * groups becomes a group of them; nested categories are flattened; with the groups to show, the others are removed.
 * Pass the groups returned to the controller's `update` once the palette is drawn.
 */
export const prepareGroupedToolboxTree = (tree: Element,
    {catalog, visible, arrange}: PrepareToolboxOptions = {}): PaletteGroups => {
    if (catalog) splitExtensionCategories(tree, catalog, {nested: true});
    arrange?.(tree);
    const groups = flattenCategoryGroups(tree);
    return visible ? filterGroupedToolboxTree(tree, groups, filtered => filterToolboxTree(filtered, visible)) : groups;
};

/** The part of a Scratch Blocks toolbox category the child palettes use. */
export interface PaletteCategory {
    id_: string;
    name_: string;
    item_: HTMLElement;
    setSelected(selected: boolean): void;
}

export interface PaletteCategoryGroupsOptions {
    /** The toolbox's categories, top level and flattened members alike. */
    categories(): PaletteCategory[];
    /** Whether the palette is laid out in a row. */
    horizontal(): boolean;
    rtl?: boolean;
    /** Opens a category that is not a group, as clicking its icon in the palette would. */
    choose(category: PaletteCategory): void;
    /** Called when a child palette opens or the last one closes. */
    onChange?(): void;
    /**
     * Lets a long press on a member of a group drag it to another place among the members of the same group, as the
     * palette's own categories can be reordered: in the group's child palette, or where a pinned group shows its
     * members. Members do not move to another group or level.
     */
    reorder?: boolean;
    /** Called after the members of a group were reordered, so the host can lay out its categories with `arrange`. */
    onReorder?(): void;
    /**
     * Where the members' order and the pinned groups are kept, such as the palette settings saved with the project.
     * Palettes given the same one, such as the editor's and the detached one, follow each other. By default they last
     * while the palette does.
     */
    order?(): PaletteGroupsOrder | undefined;
    /** The locale the pin buttons are labelled in. By default, the document's language. */
    locale?(): string;
}

/** The part of a {@link PaletteOrder} the child palettes use. */
export type PaletteGroupsOrder = Pick<PaletteOrder, 'members' | 'setMembers' | 'isPinned' | 'setPinned' | 'subscribe'>;

export interface PaletteCategoryGroupsController {
    /**
     * Prepares a toolbox tree as {@link prepareGroupedToolboxTree} does, and puts each group's members in the order
     * they were dragged into, so the palette is drawn in that order. Pass the groups returned to `update`.
     */
    prepare(tree: Element, options?: PrepareToolboxOptions): PaletteGroups;
    /** Takes the groups of the toolbox just drawn: hides their members' icons and marks the groups' icons. */
    update(groups: PaletteGroups): void;
    /** The groups the palette was last drawn with, members in their order, to show another palette the same way. */
    current(): PaletteGroups;
    /** Whether the category is a group the palette shows, whose icon opens a child palette. */
    isGroup(id: string): boolean;
    /**
     * The category whose icon stands for the id in the palette: its own, when the palette shows it, or that of the
     * nearest group the palette shows. A pinned group's members are shown in the palette that shows the group.
     */
    shownAs(id: string): string;
    /** The id of the outermost group the category is in, or its own id when it is in none. */
    topLevelId(id: string): string;
    /**
     * Opens the group's child palette from its icon, or closes it if it is open. A pinned group shows its members in
     * place, so its icon only opens its own blocks, if it has any.
     */
    toggle(category: PaletteCategory, focus?: boolean): void;
    isOpen(): boolean;
    /** The icon the palette shows for the category: its own, or that of the group it is in. */
    anchorOf(category: PaletteCategory): HTMLElement;
    /**
     * The category to select for an id: a group without blocks of its own stands for its first member, so selecting
     * an extension that declares groups selects its first shown group.
     */
    selectionTarget(id: string): string;
    /**
     * Orders the toolbox's categories: by the rank of the outermost group each is in (or its own, outside any group),
     * each group followed by its members in their order, depth first. Keeps the given order otherwise.
     */
    arrange<T extends {id_: string}>(categories: readonly T[], rank: (topLevelId: string) => number): T[];
    /**
     * Marks the groups' icons as buttons, focusable in a horizontal palette, and marks the group whose member's blocks
     * are open (`data-palette-group-shown`). Call it whenever the open category changes.
     */
    syncButtons(openId: string | null): void;
    /** Whether the node is in a child palette. */
    contains(node: Node | null): boolean;
    close(): void;
    dispose(): void;
}

const selectedClass = 'categorySelected';

/** Makes clicking a group's icon in the palette menu open its child palette. */
export const attachPaletteCategoryGroups = (menu: HTMLElement, options: PaletteCategoryGroupsOptions):
    PaletteCategoryGroupsController => {
    const doc = menu.ownerDocument;
    const events = new doc.defaultView!.AbortController();
    const capture = {capture: true, signal: events.signal};
    let groups: PaletteGroups = {members: new Map(), withOwnContents: new Set()};
    const parentOf = new Map<string, string>();
    // The open child palettes, outermost first, with the icon each opened from.
    const stack: {id: string; anchor: HTMLElement; popup: HTMLElement; reorders: {dispose(): void}[]}[] = [];
    // The order members were dragged into, by group, kept while the toolbox is drawn again.
    const ownOrder = createPaletteOrder();
    const memberOrder = () => options.order?.() ?? ownOrder;
    const applyMemberOrder = (target: PaletteGroups) => {
        for (const [id, members] of target.members) {
            const saved = memberOrder().members(id);
            if (!saved) continue;
            const rank = (member: string) => {
                const index = saved.indexOf(member);
                return index < 0 ? saved.length : index;
            };
            target.members.set(id, members.slice().sort((a, b) => rank(a) - rank(b)));
        }
    };
    const useGroups = (next: PaletteGroups) => {
        groups = next;
        applyMemberOrder(groups);
        parentOf.clear();
        for (const [id, members] of groups.members) for (const member of members) parentOf.set(member, id);
    };
    let selected: string | null = null;

    const categoryById = (id: string) => options.categories().find(category => category.id_ === id);
    const topLevelOf = (id: string) => {
        let current = id;
        while (parentOf.has(current)) current = parentOf.get(current)!;
        return current;
    };
    const isPinned = (id: string) => groups.members.has(id) && memberOrder().isPinned(id);
    // A category is in the palette when every group it is in is pinned open.
    const inPalette = (id: string) => {
        for (let parent = parentOf.get(id); parent !== undefined; parent = parentOf.get(parent)) {
            if (!isPinned(parent)) return false;
        }
        return true;
    };
    const shownAs = (id: string) => {
        let current = id;
        while (!inPalette(current)) current = parentOf.get(current)!;
        return current;
    };
    // Changes this palette makes itself, which it does not need to hear back about.
    let writing = false;
    const quietly = (write: () => void) => {
        writing = true;
        try {
            write();
        } finally {
            writing = false;
        }
    };
    const japanese = () => /^ja(?:-|$)/i.test(options.locale?.() ?? doc.documentElement.lang);
    /** A pin button: pinned, it folds the group back; unpinned, it pins the group open. */
    const pinButton = (pinned: boolean, press: () => void) => {
        const button = doc.createElement('span');
        button.className = 'tw-palette-group-pin';
        button.setAttribute('data-palette-group-pin', pinned ? 'pinned' : 'unpinned');
        button.setAttribute('role', 'button');
        button.tabIndex = 0;
        const label = pinned ? (japanese() ? 'グループの固定を外して、たたむ' : 'Unpin and fold the group') :
            (japanese() ? 'グループをパレットに広げて固定する' : 'Pin the group open in the palette');
        button.setAttribute('aria-label', label);
        button.title = label;
        const pressed = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            press();
        };
        button.addEventListener('click', pressed, {signal: events.signal});
        button.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') pressed(event);
        }, {signal: events.signal});
        // Scratch Blocks would open the category the button sits on.
        for (const type of ['mouseup', 'touchend']) {
            button.addEventListener(type, event => event.stopPropagation(), {signal: events.signal});
        }
        return button;
    };

    const markSelection = () => {
        for (const [id] of groups.members) {
            if (!inPalette(id)) continue;
            const item = categoryById(id)?.item_;
            if (!item) continue;
            const current = selected !== null && selected !== id && shownAs(selected) === id;
            item.toggleAttribute('data-palette-group-current', current);
            if (current) item.classList.add(selectedClass);
            else if (selected !== id) item.classList.remove(selectedClass);
        }
    };

    const closeFrom = (depth: number) => {
        let changed = false;
        while (stack.length > depth) {
            const {anchor, popup, reorders} = stack.pop()!;
            for (const reorder of reorders) reorder.dispose();
            anchor.setAttribute('aria-expanded', 'false');
            popup.remove();
            changed = true;
        }
        if (changed) options.onChange?.();
    };
    const close = () => closeFrom(0);

    const place = (popup: HTMLElement, anchor: HTMLElement) => {
        const container = popup.offsetParent as HTMLElement | null ?? popup.parentElement!;
        const bounds = container.getBoundingClientRect();
        const rect = anchor.getBoundingClientRect();
        const width = popup.offsetWidth;
        const height = popup.offsetHeight;
        const maxLeft = Math.max(0, container.clientWidth - width);
        const maxTop = Math.max(0, container.clientHeight - height);
        let left: number;
        let top: number;
        if (options.horizontal()) {
            left = (options.rtl ? rect.left - width : rect.right) - bounds.left;
            top = rect.top - bounds.top;
        } else {
            left = (options.rtl ? rect.right - width : rect.left) - bounds.left;
            top = rect.bottom - bounds.top;
        }
        popup.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
        popup.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
    };

    const activate = (category: PaletteCategory, entry: HTMLElement, depth: number, focus: boolean, self: boolean) => {
        if (!self && groups.members.has(category.id_) && !isPinned(category.id_)) {
            if (stack[depth]?.id === category.id_) closeFrom(depth);
            else open(category, entry, depth, focus);
            return;
        }
        // A pinned group without blocks of its own shows its members where it is, so there is nothing to open.
        if (!self && groups.members.has(category.id_) && !groups.withOwnContents.has(category.id_)) return;
        close();
        options.choose(category);
    };

    const createEntry = (category: PaletteCategory, depth: number, self = false) => {
        const entry = doc.createElement('div');
        entry.className = `scratchCategoryMenuItem scratchCategoryId-${category.id_}`;
        entry.classList.add('tw-palette-group-item');
        entry.setAttribute('data-palette-group-item', category.id_);
        entry.setAttribute('role', 'menuitem');
        entry.tabIndex = -1;
        entry.title = category.item_.textContent?.trim() || category.item_.getAttribute('aria-label') || '';
        for (const child of Array.from(category.item_.children)) {
            if (!child.hasAttribute('data-palette-group-pin')) entry.append(child.cloneNode(true));
        }
        const isGroup = !self && groups.members.has(category.id_);
        if (isGroup && isPinned(category.id_)) {
            entry.setAttribute('data-palette-group-pinned', '');
            // Folding the group back draws this child palette again.
            entry.append(pinButton(true, () => {
                quietly(() => memberOrder().setPinned(category.id_, false));
                reopen(depth - 1);
            }));
        } else if (isGroup) {
            entry.setAttribute('aria-haspopup', 'true');
            entry.setAttribute('aria-expanded', 'false');
        }
        if (selected === category.id_ || (isGroup && selected !== null && isInside(selected, category.id_))) {
            entry.classList.add(selectedClass);
        }
        entry.addEventListener('click', event => {
            event.stopPropagation();
            activate(category, entry, depth, false, self);
        }, {signal: events.signal});
        entry.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                activate(category, entry, depth, true, self);
                return;
            }
            const forward = options.horizontal() ? (options.rtl ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown';
            const backward = options.horizontal() ? (options.rtl ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp';
            if (event.key !== forward && event.key !== backward) return;
            event.preventDefault();
            const entries = Array.from(entry.parentElement!.querySelectorAll(':scope > [data-palette-group-item]')) as HTMLElement[];
            const index = entries.indexOf(entry) + (event.key === forward ? 1 : -1);
            entries[(index + entries.length) % entries.length].focus();
        }, {signal: events.signal});
        return entry;
    };

    const isInside = (id: string, groupId: string) => {
        for (let current: string | undefined = id; current !== undefined; current = parentOf.get(current)) {
            if (current === groupId) return true;
        }
        return false;
    };

    const open = (group: PaletteCategory, anchor: HTMLElement, depth: number, focus: boolean) => {
        closeFrom(depth);
        const members = (groups.members.get(group.id_) ?? []).map(categoryById).filter(Boolean) as PaletteCategory[];
        const popup = doc.createElement('div');
        popup.className = 'tw-palette-group-popup';
        popup.setAttribute('data-palette-group-popup', group.id_);
        popup.setAttribute('role', 'menu');
        popup.setAttribute('aria-label', anchor.textContent?.trim() || group.id_);
        popup.toggleAttribute('data-horizontal', options.horizontal());
        // The child palette is drawn in the palette's own colours and type.
        const look = doc.defaultView!.getComputedStyle(menu.querySelector('.scratchCategoryMenu, .scratchCategoryMenuHorizontal') ?? menu);
        popup.style.setProperty('--palette-group-background', look.backgroundColor);
        popup.style.color = look.color;
        popup.style.fontSize = look.fontSize;
        popup.style.fontFamily = look.fontFamily;
        if (options.rtl) popup.dir = 'rtl';
        // Pinning the group shows its members in the palette that shows the group.
        popup.append(pinButton(false, () => pinFrom(depth)));
        if (groups.withOwnContents.has(group.id_)) popup.append(createEntry(group, depth, true));
        // The entries of each group's members shown here: the group's own, and those of pinned member groups.
        const shown = new Map<string, HTMLElement[]>([[group.id_, []]]);
        // A pinned member group is followed by its own members, here rather than in a child palette of its own.
        const add = (member: PaletteCategory, groupId: string) => {
            const entry = createEntry(member, depth + 1);
            shown.get(groupId)!.push(entry);
            popup.append(entry);
            if (!isPinned(member.id_)) return;
            shown.set(member.id_, []);
            for (const id of groups.members.get(member.id_) ?? []) {
                const inner = categoryById(id);
                if (inner) add(inner, member.id_);
            }
        };
        for (const member of members) add(member, group.id_);
        (menu.parentElement ?? doc.body).append(popup);
        place(popup, anchor);
        anchor.setAttribute('aria-expanded', 'true');
        // The group's own blocks stay first; the members of each group shown here can be dragged among themselves.
        const reorders = options.reorder ? [...shown].filter(([, entries]) => entries.length > 1).map(([groupId, entries]) =>
            attachPaletteCategoryReorder(popup, () => entries, (from, to) => {
                moveMember(groupId, from, to);
                open(group, anchor, depth, false);
                options.onReorder?.();
            }, {horizontal: options.horizontal, area: entry => entry})) : [];
        stack.push({id: group.id_, anchor, popup, reorders});
        options.onChange?.();
        if (focus) (popup.firstElementChild as HTMLElement | null)?.focus();
    };

    const toggle = (category: PaletteCategory, focus = false) => {
        if (isPinned(category.id_)) {
            close();
            if (groups.withOwnContents.has(category.id_)) options.choose(category);
        } else if (stack[0]?.id === category.id_) close();
        else open(category, category.item_, 0, focus);
    };
    // Draws the child palette at the depth again, or the palette itself.
    function reopen(depth: number) {
        if (depth < 0 || !stack[depth]) {
            close();
            applyVisibility();
            return;
        }
        const {id, anchor} = stack[depth];
        const group = categoryById(id);
        if (group) open(group, anchor, depth, false);
        else closeFrom(depth);
    }
    // Pins open the group of the child palette at the depth: its members join the palette it opened from.
    function pinFrom(depth: number) {
        const {id} = stack[depth];
        quietly(() => memberOrder().setPinned(id, true));
        closeFrom(depth);
        if (depth > 0) reopen(depth - 1);
        else applyVisibility();
    }
    /** Moves a member of the group, as dragged, and keeps the order. */
    function moveMember(groupId: string, from: number, to: number) {
        const order = [...(groups.members.get(groupId) ?? [])];
        order.splice(to, 0, order.splice(from, 1)[0]);
        quietly(() => memberOrder().setMembers(groupId, order));
        groups.members.set(groupId, order);
    }
    // Where the palette shows a pinned group's members, they can be dragged among themselves.
    let inlineReorders: {dispose(): void}[] = [];
    function attachInlineReorders() {
        for (const reorder of inlineReorders) reorder.dispose();
        inlineReorders = [];
        if (!options.reorder) return;
        for (const [id, members] of groups.members) {
            if (members.length < 2 || !isPinned(id) || !inPalette(id)) continue;
            const items = () => (groups.members.get(id) ?? []).map(member => categoryById(member)?.item_)
                .filter((item): item is HTMLElement => Boolean(item));
            inlineReorders.push(attachPaletteCategoryReorder(menu, items, (from, to) => {
                moveMember(id, from, to);
                close();
                applyVisibility();
                options.onReorder?.();
            }, {horizontal: options.horizontal, ends: false}));
        }
    }
    // Shows the categories every group of which is pinned open, hides the others, and marks the groups shown.
    function applyVisibility() {
        for (const category of options.categories()) {
            const id = category.id_;
            const item = category.item_;
            const row = item.parentElement;
            if (row && row !== menu) row.hidden = !inPalette(id);
            const group = groups.members.has(id) && inPalette(id);
            if (group) {
                item.setAttribute('aria-haspopup', 'true');
                if (!item.hasAttribute('aria-expanded')) item.setAttribute('aria-expanded', 'false');
                item.setAttribute('data-palette-group', '');
                item.classList.add('tw-palette-group');
            }
            const pinned = group && isPinned(id);
            item.toggleAttribute('data-palette-group-pinned', pinned);
            const button = item.querySelector(':scope > [data-palette-group-pin]');
            if (pinned && !button) {
                item.append(pinButton(true, () => {
                    quietly(() => memberOrder().setPinned(id, false));
                    close();
                    applyVisibility();
                }));
            } else if (!pinned) button?.remove();
        }
        attachInlineReorders();
        markSelection();
        options.onChange?.();
    }
    // Another palette given the same order, or a project loaded, may pin or fold groups.
    let watched: PaletteGroupsOrder | undefined;
    let unwatch: (() => void) | undefined;
    const watchOrder = () => {
        const order = memberOrder();
        if (order === watched) return;
        unwatch?.();
        watched = order;
        unwatch = order.subscribe(() => {
            if (writing) return;
            close();
            applyVisibility();
        });
    };

    const groupItem = (target: EventTarget | null) => {
        if (!(target instanceof doc.defaultView!.Node)) return null;
        // A pin button handles its own press.
        if ((target as Element).closest?.('[data-palette-group-pin]')) return null;
        return options.categories().find(category => groups.members.has(category.id_) &&
            inPalette(category.id_) && category.item_.contains(target as Node)) ?? null;
    };
    // Scratch Blocks opens a category on mouseup (touchend on touch screens); a group opens its child palette on click.
    for (const type of ['mouseup', 'touchend']) {
        menu.addEventListener(type, event => {
            if (groupItem(event.target)) event.stopPropagation();
        }, capture);
    }
    menu.addEventListener('click', event => {
        const category = groupItem(event.target);
        if (!category) return;
        event.stopPropagation();
        toggle(category);
    }, capture);

    const contains = (node: Node | null) => !!node && stack.some(({popup}) => popup.contains(node));
    const onPointerDown = (event: PointerEvent) => {
        if (!stack.length) return;
        const target = event.target as Node | null;
        if (contains(target) || stack[0].anchor.contains(target)) return;
        close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.isComposing || !stack.length) return;
        event.preventDefault();
        // The palette's own Escape would close the block list as well.
        event.stopImmediatePropagation();
        const {anchor} = stack[stack.length - 1];
        closeFrom(stack.length - 1);
        anchor.focus();
    };
    doc.addEventListener('pointerdown', onPointerDown, capture);
    doc.addEventListener('keydown', onKeyDown, capture);
    menu.addEventListener('scroll', close, {signal: events.signal});
    doc.defaultView!.addEventListener('resize', close, {signal: events.signal});

    return {
        prepare(tree, prepareOptions) {
            const prepared = prepareGroupedToolboxTree(tree, prepareOptions);
            close();
            useGroups(prepared);
            // Each group is followed by its members, each with its own members, in their order.
            const elements = Array.from(tree.children).filter(isCategory);
            const byId = new Map(elements.map(element => [element.getAttribute('id')!, element]));
            const ordered: Element[] = [];
            const visit = (element: Element) => {
                ordered.push(element);
                for (const member of groups.members.get(element.getAttribute('id')!) ?? []) {
                    const child = byId.get(member);
                    if (child) visit(child);
                }
            };
            for (const element of elements) if (!element.hasAttribute(groupParentAttribute)) visit(element);
            const slots = elements.map(element => {
                const slot = tree.ownerDocument.createComment('palette-category');
                element.replaceWith(slot);
                return slot;
            });
            slots.forEach((slot, index) => {
                if (ordered[index]) slot.replaceWith(ordered[index]);
                else slot.remove();
            });
            return prepared;
        },
        update(next) {
            close();
            useGroups(next);
            watchOrder();
            for (const category of options.categories()) {
                const {setSelected} = category;
                category.setSelected = function (value: boolean) {
                    setSelected.call(this, value);
                    if (value) selected = category.id_;
                    else if (selected === category.id_) selected = null;
                    markSelection();
                };
                if (category.item_.classList.contains(selectedClass)) selected = category.id_;
            }
            applyVisibility();
        },
        current: () => groups,
        isGroup: id => groups.members.has(id) && inPalette(id),
        shownAs,
        topLevelId: topLevelOf,
        toggle,
        isOpen: () => stack.length > 0,
        anchorOf: category => categoryById(shownAs(category.id_))?.item_ ?? category.item_,
        arrange(categories, rank) {
            const position = new Map<string, number>();
            const visit = (id: string) => {
                position.set(id, position.size);
                for (const member of groups.members.get(id) ?? []) visit(member);
            };
            for (const [id] of groups.members) if (!parentOf.has(id)) visit(id);
            // Categories of the same rank keep the place of their outermost group, or their own.
            const place = new Map<string, number>();
            categories.forEach((category, index) => {
                const top = topLevelOf(category.id_);
                if (!place.has(top)) place.set(top, index);
            });
            const key = (category: {id_: string}) => {
                const top = topLevelOf(category.id_);
                return [rank(top), place.get(top)!, position.get(category.id_) ?? 0];
            };
            return categories.slice().sort((a, b) => {
                const ka = key(a);
                const kb = key(b);
                return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
            });
        },
        selectionTarget(id) {
            let target = id;
            while (groups.members.get(target)?.length && !groups.withOwnContents.has(target)) {
                target = groups.members.get(target)![0];
            }
            return target;
        },
        syncButtons(openId) {
            const horizontal = options.horizontal();
            for (const category of options.categories()) {
                if (!groups.members.has(category.id_) || !inPalette(category.id_)) continue;
                const item = category.item_;
                if (horizontal) item.tabIndex = 0;
                else item.removeAttribute('tabindex');
                item.setAttribute('role', 'button');
                item.toggleAttribute('data-palette-group-shown', horizontal && openId !== null && openId !== category.id_ &&
                    shownAs(openId) === category.id_);
            }
        },
        contains,
        close,
        dispose() {
            close();
            for (const reorder of inlineReorders) reorder.dispose();
            unwatch?.();
            events.abort();
        }
    };
};
