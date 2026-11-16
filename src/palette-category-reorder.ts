
const holdDelay = 500;
const movementThreshold = 8;

type Press = {pointerId: number; source: HTMLElement; x: number; y: number; timer: number};

export interface PaletteCategoryReorderOptions {
    /** Whether the items run in a row. By default, whether the menu is a horizontal block palette. */
    horizontal?(): boolean;
    /** The element an item takes up, which a drop over it lands on. By default, the row that holds the item. */
    area?(item: HTMLElement): Element;
    /**
     * Whether a drop before the first item or after the last one lands at that end. On by default; off, a drop
     * anywhere but over an item moves nothing, as when the items share the menu with others.
     */
    ends?: boolean;
}

/**
 * Lets a long press on an item of the menu drag it to another place among the items. Used for the palette's
 * categories and for the members of a group's child palette.
 */
export function attachPaletteCategoryReorder(
    menu: HTMLElement, getItems: () => HTMLElement[], onDrop: (from: number, to: number) => void,
    options: PaletteCategoryReorderOptions = {}
) {
    const horizontal = options.horizontal ?? (() => menu.hasAttribute('data-horizontal-block-palette'));
    const area = options.area ?? ((item: HTMLElement) => item.parentElement);
    const doc = menu.ownerDocument;
    const win = doc.defaultView;
    const events = new AbortController();
    const capture = {capture: true, signal: events.signal};
    let press: Press | undefined;
    let preview: HTMLElement | undefined;
    let suppressRelease = false;
    let target: HTMLElement | undefined;

    const markTarget = (item?: HTMLElement) => {
        target?.removeAttribute('data-palette-reorder-target');
        target = item === press?.source ? undefined : item;
        target?.setAttribute('data-palette-reorder-target', '');
    };

    const cancel = () => {
        if (!press) return;
        const {pointerId, source, timer} = press;
        win.clearTimeout(timer);
        markTarget();
        press = undefined;
        preview?.remove();
        preview = undefined;
        source.removeAttribute('data-palette-reorder-source');
        menu.classList.remove('tw-palette-category-reordering');
        menu.removeAttribute('data-palette-reordering');
        if (menu.hasPointerCapture(pointerId)) menu.releasePointerCapture(pointerId);
    };

    const itemAt = (event: PointerEvent, items: HTMLElement[]) => {
        const hit = doc.elementFromPoint(event.clientX, event.clientY);
        if (!items.length || !menu.contains(hit)) return;
        const item = items.find(candidate => area(candidate).contains(hit));
        if (item || options.ends === false) return item;

        const first = items[0];
        const last = items[items.length - 1];
        const start = first.getBoundingClientRect();
        const end = last.getBoundingClientRect();
        if (!horizontal()) {
            if (event.clientY < start.top) return first;
            if (event.clientY > end.bottom) return last;
        } else if (menu.dir === 'rtl') {
            if (event.clientX > start.right) return first;
            if (event.clientX < end.left) return last;
        } else {
            if (event.clientX < start.left) return first;
            if (event.clientX > end.right) return last;
        }
    };

    doc.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return;
        cancel();
        suppressRelease = false;
        if (event.ctrlKey || !menu.contains(event.target as Node)) return;
        const source = getItems().find(item => item.contains(event.target as Node));
        if (!source) return;
        const {pointerId, clientX: x, clientY: y} = event;
        const timer = win.setTimeout(() => {
            if (!getItems().includes(source)) return cancel();
            try {
                menu.setPointerCapture(pointerId);
            } catch {
                // The pointer may have been released outside the browser during the hold.
                return cancel();
            }
            const {left, top, width, height} = source.getBoundingClientRect();
            const {backgroundColor, color, direction, font, padding, whiteSpace} = win.getComputedStyle(source);
            preview = source.cloneNode(true) as HTMLElement;
            preview.classList.add('tw-palette-category-drag-preview');
            preview.setAttribute('data-palette-reorder-preview', '');
            preview.inert = true;
            Object.assign(preview.style, {
                left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
                backgroundColor: backgroundColor === 'rgba(0, 0, 0, 0)' ?
                    win.getComputedStyle(menu).backgroundColor : backgroundColor,
                color, direction, font, padding, whiteSpace
            });
            // Mount outside the toolbox so its scrolling and clipping don't constrain the preview.
            doc.body.append(preview);
            suppressRelease = true;
            menu.classList.add('tw-palette-category-reordering');
            menu.setAttribute('data-palette-reordering', '');
            source.setAttribute('data-palette-reorder-source', '');
        }, holdDelay);
        press = {pointerId, source, x, y, timer};
    }, capture);

    doc.addEventListener('pointermove', event => {
        if (press?.pointerId !== event.pointerId) return;
        if (preview) {
            preview.style.transform = `translate(${event.clientX - press.x}px, ${event.clientY - press.y}px)`;
            markTarget(itemAt(event, getItems()));
        }
        else if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > movementThreshold) cancel();
    }, capture);

    doc.addEventListener('pointerup', event => {
        if (press?.pointerId !== event.pointerId) return;
        if (!preview) return cancel();
        const items = getItems();
        const from = items.indexOf(press.source);
        const to = items.indexOf(itemAt(event, items));
        cancel();
        if (from >= 0 && to >= 0 && from !== to) onDrop(from, to);
    }, capture);

    doc.addEventListener('pointercancel', event => {
        if (press?.pointerId === event.pointerId) cancel();
    }, capture);
    menu.addEventListener('lostpointercapture', event => {
        if (event.target === menu && press?.pointerId === event.pointerId) cancel();
    }, capture);
    // Only the window losing focus: an element's blur also reaches the window while capturing, as when the press
    // moves the focus from one category to another.
    win.addEventListener('blur', event => {
        if (event.target === win) cancel();
    }, capture);
    doc.addEventListener('keydown', event => {
        if (!preview || event.key !== 'Escape') return;
        event.stopImmediatePropagation();
        cancel();
    }, capture);

    // ScratchBlocks selects categories on mouseup or touchend, and a group or a child palette's item opens on click.
    // Ignore the release of a reorder.
    const swallowRelease = (event: Event) => {
        if (!suppressRelease) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    menu.addEventListener('mouseup', swallowRelease, capture);
    menu.addEventListener('touchend', swallowRelease, {...capture, passive: false});
    menu.addEventListener('click', swallowRelease, capture);
    menu.addEventListener('touchmove', event => {
        if (preview) event.preventDefault();
    }, {...capture, passive: false});
    doc.addEventListener('contextmenu', event => {
        if (!press || !menu.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, capture);

    return {
        cancel,
        dispose() {
            cancel();
            events.abort();
        }
    };
}
