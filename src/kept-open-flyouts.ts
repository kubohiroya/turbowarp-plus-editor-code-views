// SPDX-License-Identifier: MPL-2.0
/**
 * Block lists of their own for the groups a palette layout keeps open, in a horizontal palette. Each group set to be
 * always open gets a Scratch Blocks flyout of its own, right under its icon, whose blocks drag into the workspace as
 * the palette's do. Space is added after its icon up to the width of its list, so the icons after it move along and no
 * two lists overlap. Groups that open and close by themselves keep using the palette's own flyout, drawn over
 * these lists.
 */

/** The part of a Scratch Blocks toolbox category the lists use. */
export interface KeptOpenCategory {
    id_: string;
    item_: HTMLElement;
    getContents(): unknown;
}

export interface KeptOpenFlyoutsOptions {
    blocks: any;
    workspace: any;
    /** The palette's own flyout, which stays drawn over the lists. */
    panel: Element;
    menu: HTMLElement;
    /** The categories to keep open now, in the menu's order, or none while the palette is not horizontal. */
    categories(): KeptOpenCategory[];
    /** What a list shows for a category: its heading and its blocks. */
    contents(category: KeptOpenCategory): unknown[];
    isDragTowardWorkspace(delta: {x: number; y: number}): boolean;
    /** The narrowest and widest a list may be. */
    minWidth?: number;
    maxWidth?: number;
}

interface Entry {
    category: KeptOpenCategory;
    flyout: any;
    svg: SVGSVGElement;
    width: number;
}

const gap = 8;

export function attachKeptOpenFlyouts({blocks, workspace, panel, menu, categories, contents, isDragTowardWorkspace,
    minWidth = 140, maxWidth = 360}: KeptOpenFlyoutsOptions) {
    const entries = new Map<string, Entry>();
    let laying = false;

    const contentHeight = (flyout: any) => {
        try {
            const box = flyout.workspace_.getBlocksBoundingBox();
            return box.y + box.height + flyout.MARGIN * 2;
        } catch {
            return 200;
        }
    };
    const place = (entry: Entry) => {
        const {flyout, svg, category} = entry;
        const container = svg.parentElement;
        if (!container || !category.item_.isConnected) return;
        const bounds = container.getBoundingClientRect();
        const item = category.item_.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const left = item.left - bounds.left;
        const top = menuRect.bottom - bounds.top;
        const height = Math.max(40, Math.min(contentHeight(flyout), bounds.bottom - menuRect.bottom - gap));
        flyout.width_ = entry.width;
        flyout.height_ = height;
        flyout.setBackgroundPath_(entry.width, height);
        svg.setAttribute('width', String(entry.width));
        svg.setAttribute('height', String(height));
        svg.style.transform = `translate(${left}px, ${top}px)`;
        svg.style.display = '';
        flyout.scrollbar_?.setOrigin(left, top);
        flyout.scrollbar_?.resize();
    };
    /** Widens each kept-open icon's place to its list, then puts every list under its icon. */
    const layout = () => {
        if (laying) return;
        laying = true;
        try {
            for (const entry of entries.values()) {
                // The flyout measured its blocks when it was shown.
                const measured = Math.ceil((entry.flyout.width_ || minWidth) + (entry.flyout.MARGIN ?? 8));
                entry.width = Math.min(maxWidth, Math.max(minWidth, measured));
                // The icon keeps its own width and leads its list; the space after it makes room for the list.
                const item = entry.category.item_;
                item.style.removeProperty('margin-inline-end');
                item.style.marginInlineEnd = `${Math.max(0, entry.width + gap - item.offsetWidth)}px`;
            }
            for (const entry of entries.values()) place(entry);
        } finally {
            laying = false;
        }
    };
    const show = (entry: Entry) => {
        entry.flyout.show(contents(entry.category));
        entry.flyout.scrollToStart?.();
    };
    const remove = (id: string) => {
        const entry = entries.get(id);
        if (!entry) return;
        entries.delete(id);
        entry.category.item_.style.removeProperty('margin-inline-end');
        entry.flyout.dispose();
        entry.svg.remove();
    };
    const create = (category: KeptOpenCategory) => {
        const flyout = new blocks.VerticalFlyout({
            parentWorkspace: workspace, RTL: workspace.RTL, horizontalLayout: false,
            toolboxPosition: workspace.options.toolboxPosition, pathToMedia: workspace.options.pathToMedia
        });
        const svg: SVGSVGElement = flyout.createDom('svg');
        svg.classList.add('tw-kept-open-flyout');
        svg.setAttribute('data-kept-open-flyout', category.id_);
        panel.parentNode!.insertBefore(svg, panel);
        flyout.init(workspace);
        flyout.isDragTowardWorkspace = isDragTowardWorkspace;
        const entry: Entry = {category, flyout, svg, width: minWidth};
        // The flyout lays itself out when it is shown or its blocks change; place it under its icon instead.
        flyout.position = () => {
            if (!laying) layout();
        };
        entries.set(category.id_, entry);
        show(entry);
        return entry;
    };
    // Variables and lists are made while the lists are open; show them as the palette's own flyout does.
    const onChange = (event: {type?: string}) => {
        if (!event.type?.startsWith('var_')) return;
        for (const entry of entries.values()) show(entry);
        layout();
    };
    workspace.addChangeListener(onChange);

    return {
        /** Makes the lists follow the categories to keep open, after the palette is drawn or changes mode. */
        sync() {
            const wanted = workspace.isVisible?.() === false ? [] : categories();
            const ids = new Set(wanted.map(category => category.id_));
            for (const [id, entry] of [...entries]) {
                if (!ids.has(id) || !wanted.includes(entry.category)) remove(id);
            }
            for (const category of wanted) if (!entries.has(category.id_)) create(category);
            layout();
        },
        /** Puts the lists under their icons again, after the menu scrolls or resizes. */
        layout,
        has: (id: string) => entries.has(id),
        /** The lists, by category ID. */
        flyouts: () => new Map([...entries].map(([id, entry]) => [id, entry.flyout])),
        dispose() {
            workspace.removeChangeListener(onChange);
            for (const id of [...entries.keys()]) remove(id);
        }
    };
}
