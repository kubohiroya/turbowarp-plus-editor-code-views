import React from 'react';
import ReactDOM from 'react-dom';
import {createDockview, DefaultTab, themeLight} from 'dockview';
import type {DockviewApi, TabPartInitParameters} from 'dockview';
import {appendLayoutItem, duplicatePaletteLayout, insertLayoutItem, layoutUsage, materializePaletteLayout, moveLayoutItem,
    newLayoutKey, orderSourceGroups, pathOfKey, removeLayoutItem, resolvePaletteLayout, updateLayoutItem, withDefaultLayout}
    from './palette-layout.ts';
import type {PaletteLayout, PaletteLayoutDrop, PaletteLayoutFolder, PaletteLayoutGroup, PaletteLayoutItem, PaletteLayoutMode,
    PaletteLayoutOmission,
    SavedPaletteLayouts} from './palette-layout.ts';

/**
 * The block palette editor: every block group the palette can show on the source panel, the person's palette layouts as
 * tabs, and a preview of the palette the chosen tab makes. Groups are dragged from the source onto a tab's grid, where
 * they are arranged, put into folders and separated, much as apps are arranged on a phone's home screen.
 */

/** A block group the palette can show, as the source panel offers it. */
export interface PaletteSourceGroup {
    /** The palette's category ID. */
    id: string;
    name: string;
    color?: string;
    iconURI?: string;
    /** The name of the extension the group comes from, if any. */
    extensionName?: string;
    /** The group this one is nested in, which brings it along into a layout. */
    parent?: string;
    /** The blocks of the group, as text. */
    blocks: readonly string[];
}

export interface BlockPaletteEditorProps {
    locale?: string;
    /** Whether the palette is laid out in a row, which lays the editor's panels out in rows too. */
    horizontal: boolean;
    groups: readonly PaletteSourceGroup[];
    initial?: SavedPaletteLayouts;
    onApply(saved: SavedPaletteLayouts): void;
    onCancel(): void;
    /** Closes the editor, keeping the changes, and opens the extension library. */
    onAddExtension?(saved: SavedPaletteLayouts): void;
}

const messages = {
    en: {
        title: 'Block palette editor', source: 'Block groups', layouts: 'Palettes', preview: 'Preview',
        newLayout: (n: number) => `Palette ${n}`, addTab: 'Add a palette', editLabel: 'Edit label…', editTabLabel: 'Edit label',
        display: 'Display', alwaysOpen: 'Always open', autoOpen: 'Opens and closes automatically', remove: 'Remove',
        separator: 'Separator', openFolder: 'Always-open folder', autoFolder: 'Auto-opening folder', folder: 'Folder',
        add: 'Add', ok: 'OK', cancel: 'Cancel', apply: 'Save and close', close: 'Close', maximize: 'Maximize', restore: 'Restore',
        used: (n: number) => `Used ${n} times in this palette`, blocks: 'Blocks', nested: 'Groups inside',
        extension: 'Extension', missing: 'Not available', emptyLayout: 'Drag block groups here from the panel above.',
        emptyLayoutVertical: 'Drag block groups here from the panel on the left.',
        emptyPreview: 'An empty palette shows every block group.', noLayouts: 'Add a palette with ＋ to start arranging.',
        emptyFolder: 'Drop block groups here', addExtension: 'Add Extension', label: 'Label', resize: 'Drag to resize',
        omitted: {missing: 'Not in the palette: not available',
            empty: 'Not in the palette: the folder is empty', separator: 'Not in the palette: nothing to separate'} as Record<PaletteLayoutOmission, string>,
        savedAs: 'Saving makes this preview the block palette.', keptOpen: 'Blocks kept open',
        defaultName: 'Standard', duplicate: 'Duplicate', copyName: (name: string) => `${name} copy`,
        defaultNote: 'Every block group of the first panel, in its order. Duplicate this tab to change it.'
    },
    ja: {
        title: 'ブロックパレットエディタ', source: 'ブロックグループ', layouts: 'パレット', preview: 'プレビュー',
        newLayout: (n: number) => `パレット ${n}`, addTab: 'パレットを追加', editLabel: 'ラベル編集…', editTabLabel: 'ラベルを編集する',
        display: '表示', alwaysOpen: '常に開かれる', autoOpen: '自動で開閉する', remove: '削除',
        separator: '区切り線', openFolder: '常に開かれたフォルダ', autoFolder: '自動で開閉するフォルダ', folder: 'フォルダ',
        add: '追加', ok: 'OK', cancel: 'キャンセル', apply: '保存して閉じる', close: '閉じる', maximize: '最大化', restore: '元のサイズに戻す',
        used: (n: number) => `このパレットで ${n} 回使用`, blocks: 'ブロック', nested: '中のグループ',
        extension: '機能拡張', missing: '見つかりません', emptyLayout: '上のパネルからブロックグループをここへドラッグします。',
        emptyLayoutVertical: '左のパネルからブロックグループをここへドラッグします。',
        emptyPreview: '空のパレットでは、すべてのブロックグループを表示します。', noLayouts: '＋でパレットを追加して並べ始めます。',
        emptyFolder: 'ここへブロックグループをドロップ', addExtension: '機能拡張を追加', label: 'ラベル', resize: 'ドラッグで大きさを変える',
        omitted: {missing: 'パレットには出ません：見つかりません',
            empty: 'パレットには出ません：フォルダが空です', separator: 'パレットには出ません：区切る相手がありません'} as Record<PaletteLayoutOmission, string>,
        savedAs: '保存すると、このプレビューがブロックパレットになります。', keptOpen: '開いたままのブロック',
        defaultName: '標準', duplicate: '複製', copyName: (name: string) => `${name} のコピー`,
        defaultNote: '1番目のパネルのすべてのブロックグループを、その順番で並べます。変えるにはこのタブを複製します。'
    }
};
type Text = typeof messages.en;
const isJapanese = (locale?: string) => /^ja(?:-|$)/i.test(locale ?? '');

/** How long a press lasts before the pressed tile can be dragged. */
const longPress = 300;
/** How far the pointer may move during a press before it counts as scrolling instead. */
const slop = 6;

type DragPayload =
    | {kind: 'source'; id: string}
    | {kind: 'layout'; layoutId: string; key: string};

type DropHint =
    | {kind: 'tile'; key: string; position: 'before' | 'after' | 'into'}
    | {kind: 'area'; layoutId: string; folder?: string}
    | {kind: 'source'; id: string; position: 'before' | 'after'}
    | {kind: 'trash'};

interface DragState {
    payload: DragPayload;
    x: number;
    y: number;
    label: string;
    color?: string;
    hint: DropHint | null;
}

type Menu =
    | {kind: 'item'; x: number; y: number; layoutId: string; key: string; submenu?: boolean}
    | {kind: 'tab'; x: number; y: number; layoutId: string};

interface Prompt {
    title: string;
    value: string;
    submit(value: string): void;
}

interface EditorState {
    saved: SavedPaletteLayouts;
    maximized: boolean;
    sizes: [number, number, number];
    popover: {id: string; x: number; y: number} | null;
    menu: Menu | null;
    prompt: Prompt | null;
    openFolders: Set<string>;
    dial: boolean;
    drag: DragState | null;
    mounts: Map<string, HTMLElement>;
}

const groupColor = (group?: PaletteSourceGroup) => group?.color || '#9aa3b5';

function GroupIcon({group, size = 28}: {group?: PaletteSourceGroup; size?: number}) {
    const style = {width: size, height: size, background: groupColor(group), borderColor: groupColor(group)};
    if (group?.iconURI) {
        return <span className="tw-bpe-icon" style={{...style, background: '#fff'}} aria-hidden="true">
            <img src={group.iconURI} alt="" draggable={false} />
        </span>;
    }
    return <span className="tw-bpe-icon" style={style} aria-hidden="true" />;
}

/** A tab of the layouts panel, which opens the tab menu on a right click. */
class LayoutTab extends DefaultTab {
    constructor(private readonly onMenu: (id: string, x: number, y: number) => void) {
        super();
    }
    init(params: TabPartInitParameters) {
        super.init(params);
        // The default palette cannot be removed.
        const builtin = Boolean((params.params as {builtin?: boolean} | undefined)?.builtin);
        this.element.toggleAttribute('data-builtin-layout', builtin);
        const close = this.element.querySelector<HTMLElement>('.dv-default-tab-action');
        if (close && builtin) close.style.display = 'none';
        this.element.addEventListener('contextmenu', event => {
            event.preventDefault();
            event.stopPropagation();
            this.onMenu(params.api.id, event.clientX, event.clientY);
        });
    }
}

export class BlockPaletteEditor extends React.Component<BlockPaletteEditorProps, EditorState> {
    private root = React.createRef<HTMLDivElement>();
    private tabsHost = React.createRef<HTMLDivElement>();
    private dockview: DockviewApi | null = null;
    private disposers: (() => void)[] = [];
    /** Whether dockview is being changed from the state, so its events are not taken as the person's. */
    private syncing = false;
    private suppressClick = false;

    constructor(props: BlockPaletteEditorProps) {
        super(props);
        const saved = withDefaultLayout(props.initial && structuredClone(props.initial),
            (isJapanese(props.locale) ? messages.ja : messages.en).defaultName);
        this.state = {
            saved, maximized: false, sizes: [0.34, 0.4, 0.26], popover: null, menu: null, prompt: null,
            openFolders: new Set(), dial: false, drag: null, mounts: new Map()
        };
    }

    get text(): Text {
        return isJapanese(this.props.locale) ? messages.ja : messages.en;
    }
    get layouts() {
        return this.state.saved.layouts;
    }
    get active(): PaletteLayout | undefined {
        return this.layouts.find(layout => layout.id === this.state.saved.active);
    }
    group(id: string) {
        return this.props.groups.find(group => group.id === id);
    }
    /** The groups in the order the source panel was arranged into. */
    sourceGroups(): PaletteSourceGroup[] {
        return orderSourceGroups(this.props.groups, this.state.saved.sourceOrder);
    }
    /** The layout with its items, the default one holding every source group in order. */
    view(layout: PaletteLayout | undefined): PaletteLayout | undefined {
        return layout && materializePaletteLayout(layout, this.props.groups.map(group => group.id), this.state.saved.sourceOrder);
    }
    /** The palette that items are added to: the chosen one, or a new one when that is the default. */
    editable(): PaletteLayout {
        const active = this.active;
        return active && !active.builtin ? active : this.addLayout();
    }
    /** The result the editor gives back. */
    result(): SavedPaletteLayouts {
        return structuredClone(this.state.saved);
    }

    /* Changing the layouts. */

    setLayouts(change: (saved: SavedPaletteLayouts) => SavedPaletteLayouts) {
        this.setState(state => ({saved: change(state.saved)}));
    }
    updateLayout(layoutId: string, change: (layout: PaletteLayout) => PaletteLayout) {
        this.setLayouts(saved => ({...saved, layouts: saved.layouts.map(layout => layout.id === layoutId ? change(layout) : layout)}));
    }
    addLayout() {
        const used = new Set(this.layouts.map(layout => layout.name));
        let n = this.layouts.length + 1;
        while (used.has(this.text.newLayout(n))) n++;
        const layout: PaletteLayout = {id: newLayoutKey('l'), name: this.text.newLayout(n), items: []};
        this.setLayouts(saved => ({...saved, layouts: [...saved.layouts, layout], active: layout.id}));
        return layout;
    }
    removeLayout(layoutId: string) {
        if (this.layouts.find(layout => layout.id === layoutId)?.builtin) return;
        this.setLayouts(saved => {
            const layouts = saved.layouts.filter(layout => layout.id !== layoutId);
            const active = saved.active === layoutId ? layouts[0]?.id : saved.active;
            return {...saved, layouts, active};
        });
    }
    /** Adds a copy of a palette after it and chooses it. */
    duplicateLayout(layoutId: string) {
        const source = this.view(this.layouts.find(layout => layout.id === layoutId));
        if (!source) return;
        const used = new Set(this.layouts.map(layout => layout.name));
        let name = this.text.copyName(source.name);
        for (let n = 2; used.has(name); n++) name = `${this.text.copyName(source.name)} ${n}`;
        const copy = duplicatePaletteLayout(source, name);
        this.setLayouts(saved => {
            const layouts = [...saved.layouts];
            layouts.splice(layouts.findIndex(layout => layout.id === layoutId) + 1, 0, copy);
            return {...saved, layouts, active: copy.id};
        });
    }
    renameLayout(layoutId: string, name: string) {
        this.updateLayout(layoutId, layout => ({...layout, name}));
        this.syncing = true;
        try {
            this.dockview?.getPanel(layoutId)?.api.setTitle(name);
        } finally {
            this.syncing = false;
        }
    }
    /** Adds an item at the end of the chosen palette, adding a palette first when there is none. */
    addItem(item: PaletteLayoutItem) {
        const target = this.editable();
        this.updateLayout(target.id, layout => appendLayoutItem(layout, item));
        if (item.kind === 'folder') this.setState(({openFolders}) => ({openFolders: new Set(openFolders).add(item.key)}));
    }

    /* Dockview: one tab per layout. */

    componentDidMount() {
        const host = this.tabsHost.current;
        if (!host) return;
        const dockview = createDockview(host, {
            theme: themeLight,
            disableFloatingGroups: true,
            defaultTabComponent: 'layout',
            createTabComponent: () => new LayoutTab((id, x, y) => this.setState({menu: {kind: 'tab', x, y, layoutId: id}})),
            createRightHeaderActionComponent: () => {
                const element = host.ownerDocument.createElement('div');
                element.className = 'tw-bpe-tab-actions';
                const button = host.ownerDocument.createElement('button');
                button.type = 'button';
                button.className = 'tw-bpe-add-tab';
                button.textContent = '＋';
                button.title = this.text.addTab;
                button.setAttribute('aria-label', this.text.addTab);
                button.addEventListener('click', () => this.addLayout());
                element.append(button);
                return {element, init() {}, dispose() {}};
            },
            createComponent: ({id}) => {
                const element = host.ownerDocument.createElement('div');
                element.className = 'tw-bpe-tab-content';
                return {
                    element,
                    init: () => this.setState(({mounts}) => ({mounts: new Map(mounts).set(id, element)})),
                    dispose: () => this.setState(({mounts}) => {
                        const next = new Map(mounts);
                        next.delete(id);
                        return {mounts: next};
                    })
                };
            }
        });
        this.dockview = dockview;
        // Tabs are reordered, never split into other groups.
        const preventSplit = (event: {kind: string; position: string; preventDefault(): void}) => {
            if (event.kind === 'edge' || (event.kind === 'content' && event.position !== 'center')) event.preventDefault();
        };
        const subscriptions = [
            dockview.onWillShowOverlay(preventSplit),
            dockview.onWillDrop(preventSplit),
            dockview.onDidActivePanelChange(event => {
                const id = (event as {panel?: {id: string}})?.panel?.id ?? (event as {id?: string})?.id;
                if (this.syncing || !id || id === this.state.saved.active) return;
                this.setLayouts(saved => ({...saved, active: id}));
            }),
            dockview.onDidRemovePanel(panel => {
                if (this.syncing) return;
                // The default palette comes back if it was closed some other way.
                if (this.layouts.find(layout => layout.id === panel.id)?.builtin) setTimeout(() => this.syncDockview(), 0);
                else this.removeLayout(panel.id);
            }),
            dockview.onDidLayoutChange(() => {
                if (this.syncing) return;
                const order = dockview.groups.flatMap(group => group.panels.map(panel => panel.id));
                const current = this.layouts.map(layout => layout.id);
                if (order.length !== current.length || order.every((id, index) => id === current[index])) return;
                this.setLayouts(saved => ({...saved, layouts: order.map(id => saved.layouts.find(layout => layout.id === id))
                    .filter((layout): layout is PaletteLayout => !!layout)}));
            })
        ];
        this.disposers.push(() => subscriptions.forEach(subscription => subscription.dispose()));
        this.syncDockview();
        const resize = new (host.ownerDocument.defaultView!.ResizeObserver)(() => {
            dockview.layout(host.clientWidth, host.clientHeight);
        });
        resize.observe(host);
        this.disposers.push(() => resize.disconnect());
        const keys = (event: KeyboardEvent) => this.onKeyDown(event);
        host.ownerDocument.addEventListener('keydown', keys, true);
        this.disposers.push(() => host.ownerDocument.removeEventListener('keydown', keys, true));
    }
    componentDidUpdate() {
        this.syncDockview();
    }
    componentWillUnmount() {
        for (const dispose of this.disposers.splice(0)) dispose();
        this.syncing = true;
        this.dockview?.dispose();
        this.dockview = null;
    }
    /** Makes dockview's tabs follow the layouts: added, removed, renamed and chosen. */
    syncDockview() {
        const dockview = this.dockview;
        if (!dockview) return;
        this.syncing = true;
        try {
            const ids = new Set(this.layouts.map(layout => layout.id));
            for (const panel of [...dockview.panels]) if (!ids.has(panel.id)) panel.api.close();
            for (const layout of this.layouts) {
                const panel = dockview.getPanel(layout.id);
                // Every tab goes into the one group, never a new one beside it.
                const group = dockview.groups[0];
                if (!panel) dockview.addPanel({id: layout.id, component: 'layout', title: layout.name, inactive: true,
                    params: {builtin: Boolean(layout.builtin)}, ...(group && {position: {referenceGroup: group}})});
                else if (panel.title !== layout.name) panel.api.setTitle(layout.name);
            }
            const active = this.state.saved.active && dockview.getPanel(this.state.saved.active);
            if (active && dockview.activePanel !== active) active.api.setActive();
        } finally {
            this.syncing = false;
        }
    }

    onKeyDown(event: KeyboardEvent) {
        if (event.key !== 'Escape') return;
        const {menu, popover, prompt, dial, drag} = this.state;
        if (!menu && !popover && !prompt && !dial && !drag) return;
        event.preventDefault();
        event.stopPropagation();
        if (prompt) this.setState({prompt: null});
        else this.setState({menu: null, popover: null, dial: false, drag: null});
    }

    /* Dragging with a long press. */

    press(event: React.PointerEvent, payload: DragPayload, label: string, color?: string) {
        if (event.button !== 0) return;
        const doc = event.currentTarget.ownerDocument;
        const startX = event.clientX;
        const startY = event.clientY;
        const tile = event.currentTarget as HTMLElement;
        let dragging = false;
        const stop = () => {
            clearTimeout(timer);
            tile.removeAttribute('data-pressed');
            doc.removeEventListener('pointermove', move, true);
            doc.removeEventListener('pointerup', up, true);
            doc.removeEventListener('pointercancel', cancel, true);
        };
        const cancel = () => {
            stop();
            if (dragging) this.setState({drag: null});
        };
        const move = (moveEvent: PointerEvent) => {
            if (!dragging) {
                if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > slop) stop();
                return;
            }
            moveEvent.preventDefault();
            const hint = this.hintAt(doc, moveEvent.clientX, moveEvent.clientY, payload);
            this.setState(({drag}) => drag && {drag: {...drag, x: moveEvent.clientX, y: moveEvent.clientY, hint}});
        };
        const up = (upEvent: PointerEvent) => {
            stop();
            if (!dragging) return;
            upEvent.preventDefault();
            this.suppressClick = true;
            setTimeout(() => { this.suppressClick = false; }, 0);
            const hint = this.hintAt(doc, upEvent.clientX, upEvent.clientY, payload);
            this.setState({drag: null});
            if (hint) this.drop(payload, hint);
        };
        const timer = setTimeout(() => {
            dragging = true;
            tile.removeAttribute('data-pressed');
            this.setState({drag: {payload, x: startX, y: startY, label, color, hint: null}, popover: null, menu: null, dial: false});
        }, longPress);
        tile.setAttribute('data-pressed', '');
        doc.addEventListener('pointermove', move, true);
        doc.addEventListener('pointerup', up, true);
        doc.addEventListener('pointercancel', cancel, true);
    }

    /** Where a drop at the point would land. */
    hintAt(doc: Document, x: number, y: number, payload: DragPayload): DropHint | null {
        const element = doc.elementFromPoint(x, y) as HTMLElement | null;
        const target = element?.closest<HTMLElement>('[data-bpe-drop]');
        if (!target) return null;
        const zone = target.dataset.bpeDrop;
        const rect = target.getBoundingClientRect();
        const horizontalFlow = (x - rect.left) / Math.max(1, rect.width);
        if (zone === 'source-tile') {
            if (payload.kind === 'layout') return {kind: 'trash'};
            if (payload.id === target.dataset.groupId) return null;
            return {kind: 'source', id: target.dataset.groupId!, position: horizontalFlow < 0.5 ? 'before' : 'after'};
        }
        if (zone === 'source') return payload.kind === 'layout' ? {kind: 'trash'} : null;
        if (zone === 'tile') {
            const key = target.dataset.key!;
            if (payload.kind === 'layout' && payload.key === key) return null;
            const isFolder = target.dataset.folder === 'true';
            const vertical = (y - rect.top) / Math.max(1, rect.height);
            if (isFolder && horizontalFlow > 0.25 && horizontalFlow < 0.75 && vertical > 0.15 && vertical < 0.85) {
                return {kind: 'tile', key, position: 'into'};
            }
            return {kind: 'tile', key, position: horizontalFlow < 0.5 ? 'before' : 'after'};
        }
        if (zone === 'area') return {kind: 'area', layoutId: target.dataset.layoutId!, folder: target.dataset.folderKey};
        return null;
    }

    /** The layout whose grid shows the item with the key. */
    layoutOfKey(key: string) {
        return this.layouts.find(layout => pathOfKey(layout, key));
    }
    /** The drop for a hint on a layout's grid. */
    layoutDrop(layout: PaletteLayout, hint: DropHint): PaletteLayoutDrop | null {
        if (hint.kind === 'area') return hint.folder ? {end: true, folder: hint.folder} : {end: true};
        if (hint.kind !== 'tile') return null;
        if (hint.position === 'into') return {into: hint.key};
        if (hint.position === 'before') return {before: hint.key};
        // After an item is before the next one at the same level, or at the end of that level.
        const path = pathOfKey(layout, hint.key);
        if (!path) return {end: true};
        if (path.child === undefined) {
            const next = layout.items[path.index + 1];
            return next ? {before: next.key} : {end: true};
        }
        const folder = layout.items[path.index] as PaletteLayoutFolder;
        const next = folder.items[path.child + 1];
        return next ? {before: next.key} : {end: true, folder: folder.key};
    }

    drop(payload: DragPayload, hint: DropHint) {
        if (hint.kind === 'source') {
            if (payload.kind !== 'source') return;
            const ids = this.sourceGroups().map(group => group.id).filter(id => id !== payload.id);
            const index = ids.indexOf(hint.id);
            ids.splice(hint.position === 'before' ? index : index + 1, 0, payload.id);
            this.setLayouts(saved => ({...saved, sourceOrder: ids}));
            return;
        }
        if (hint.kind === 'trash') {
            if (payload.kind === 'layout') this.removeItem(payload.layoutId, payload.key);
            return;
        }
        const layout = hint.kind === 'area' ? this.layouts.find(item => item.id === hint.layoutId) : this.layoutOfKey(hint.key);
        if (!layout) return;
        const drop = this.layoutDrop(layout, hint);
        if (!drop) return;
        if (payload.kind === 'source') {
            const item: PaletteLayoutGroup = {kind: 'group', key: newLayoutKey(), ref: payload.id, mode: 'auto'};
            this.updateLayout(layout.id, current => insertLayoutItem(current, item, drop));
            return;
        }
        if (payload.layoutId === layout.id) {
            this.updateLayout(layout.id, current => moveLayoutItem(current, payload.key, drop));
            if ('into' in drop) this.setState(({openFolders}) => ({openFolders: new Set(openFolders).add(drop.into)}));
        }
    }

    removeItem(layoutId: string, key: string) {
        this.updateLayout(layoutId, layout => {
            const path = pathOfKey(layout, key);
            return path ? removeLayoutItem(layout, path) : layout;
        });
    }
    changeItem(layoutId: string, key: string, change: {label?: string; mode?: PaletteLayoutMode}) {
        this.updateLayout(layoutId, layout => {
            const path = pathOfKey(layout, key);
            return path ? updateLayoutItem(layout, path, change) : layout;
        });
    }
    itemLabel(item: PaletteLayoutItem) {
        if (item.kind === 'separator') return this.text.separator;
        if (item.kind === 'folder') return item.label || this.text.folder;
        return item.label || this.group(item.ref)?.name || item.ref;
    }

    /* Splitters. */

    startSplit(event: React.PointerEvent, index: 0 | 1) {
        event.preventDefault();
        const root = this.root.current?.querySelector<HTMLElement>('.tw-bpe-panels');
        if (!root) return;
        const doc = root.ownerDocument;
        const rect = root.getBoundingClientRect();
        const along = this.props.horizontal ? rect.height : rect.width;
        const start = this.props.horizontal ? event.clientY : event.clientX;
        const sizes = [...this.state.sizes] as [number, number, number];
        const move = (moveEvent: PointerEvent) => {
            const delta = ((this.props.horizontal ? moveEvent.clientY : moveEvent.clientX) - start) / Math.max(1, along);
            const pair = sizes[index] + sizes[index + 1];
            const first = Math.min(pair - 0.08, Math.max(0.08, sizes[index] + delta));
            const next = [...sizes] as [number, number, number];
            next[index] = first;
            next[index + 1] = pair - first;
            this.setState({sizes: next});
        };
        const up = () => {
            doc.removeEventListener('pointermove', move);
            doc.removeEventListener('pointerup', up);
        };
        doc.addEventListener('pointermove', move);
        doc.addEventListener('pointerup', up);
    }

    /* Rendering. */

    renderSource() {
        const text = this.text;
        const usage = layoutUsage(this.view(this.active));
        const drag = this.state.drag;
        return (
            <section className="tw-bpe-panel tw-bpe-source" aria-label={text.source} data-bpe-drop="source"
                data-trash={drag?.hint?.kind === 'trash' ? 'true' : undefined}>
                <h3 className="tw-bpe-panel-title">{text.source}</h3>
                <div className="tw-bpe-grid tw-bpe-source-grid" role="list">
                    {this.sourceGroups().map(group => {
                        const count = usage.get(group.id) ?? 0;
                        const hint = drag?.hint?.kind === 'source' && drag.hint.id === group.id ? drag.hint.position : undefined;
                        const parent = group.parent && this.group(group.parent);
                        return (
                            <div key={group.id} role="listitem" className="tw-bpe-tile tw-bpe-source-tile" data-bpe-drop="source-tile"
                                data-group-id={group.id} data-drop-hint={hint} tabIndex={0} title={group.name}
                                data-dragging={drag?.payload.kind === 'source' && drag.payload.id === group.id ? 'true' : undefined}
                                onPointerDown={event => this.press(event, {kind: 'source', id: group.id}, group.name, groupColor(group))}
                                onClick={event => {
                                    if (this.suppressClick) return;
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    this.setState(({popover}) => ({popover: popover?.id === group.id ? null :
                                        {id: group.id, x: rect.left, y: rect.bottom + 4}}));
                                }}
                                onKeyDown={event => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        this.addItem({kind: 'group', key: newLayoutKey(), ref: group.id, mode: 'auto'});
                                    }
                                }}>
                                <GroupIcon group={group} />
                                <span className="tw-bpe-tile-label">{group.name}</span>
                                {parent && <span className="tw-bpe-tile-caption">{parent.name}</span>}
                                {count > 0 && <span className="tw-bpe-badge" title={text.used(count)} aria-label={text.used(count)}>{count}</span>}
                            </div>
                        );
                    })}
                </div>
                {this.props.onAddExtension && (
                    <div className="tw-bpe-source-end">
                        <button type="button" className="tw-bpe-add-extension"
                            onClick={() => this.props.onAddExtension!(this.result())}>
                            <span aria-hidden="true">＋</span>{text.addExtension}
                        </button>
                    </div>
                )}
            </section>
        );
    }

    renderTile(layout: PaletteLayout, item: PaletteLayoutItem, inFolder: boolean) {
        const text = this.text;
        const drag = this.state.drag;
        const hint = drag?.hint?.kind === 'tile' && drag.hint.key === item.key ? drag.hint.position : undefined;
        const label = this.itemLabel(item);
        const dragging = drag?.payload.kind === 'layout' && drag.payload.key === item.key;
        const common = {
            role: 'listitem',
            tabIndex: 0,
            'data-bpe-drop': 'tile',
            'data-key': item.key,
            'data-kind': item.kind,
            'data-drop-hint': hint,
            'data-dragging': dragging ? 'true' : undefined,
            'data-mode': item.kind === 'separator' ? undefined : item.mode,
            title: label,
            onContextMenu: (event: React.MouseEvent) => {
                event.preventDefault();
                this.setState({menu: {kind: 'item', x: event.clientX, y: event.clientY, layoutId: layout.id, key: item.key}, popover: null});
            }
        };
        const modeMark = (mode: PaletteLayoutMode) => (
            <span className="tw-bpe-mode" title={mode === 'open' ? text.alwaysOpen : text.autoOpen}
                aria-label={mode === 'open' ? text.alwaysOpen : text.autoOpen}>{mode === 'open' ? '◧' : '▾'}</span>
        );
        if (item.kind === 'separator') {
            return (
                <div key={item.key} {...common} className="tw-bpe-tile tw-bpe-separator-tile"
                    onPointerDown={event => this.press(event, {kind: 'layout', layoutId: layout.id, key: item.key}, label)}>
                    <span className="tw-bpe-icon tw-bpe-icon-separator" aria-hidden="true"><span /></span>
                    <span className="tw-bpe-tile-label">{label}</span>
                </div>
            );
        }
        if (item.kind === 'folder') {
            const open = this.state.openFolders.has(item.key);
            return (
                <div key={item.key} {...common} data-folder="true" aria-expanded={open}
                    className="tw-bpe-tile tw-bpe-folder-tile"
                    onPointerDown={event => this.press(event, {kind: 'layout', layoutId: layout.id, key: item.key}, label)}
                    onClick={() => {
                        if (this.suppressClick) return;
                        this.setState(({openFolders}) => {
                            const next = new Set(openFolders);
                            if (next.has(item.key)) next.delete(item.key);
                            else next.add(item.key);
                            return {openFolders: next};
                        });
                    }}>
                    <span className="tw-bpe-folder-icon" aria-hidden="true">
                        {item.items.slice(0, 4).map(member => (
                            <span key={member.key} style={{background: groupColor(this.group(member.ref))}} />
                        ))}
                    </span>
                    <span className="tw-bpe-tile-label">{label}</span>
                    {modeMark(item.mode)}
                    {item.items.length > 0 && <span className="tw-bpe-badge tw-bpe-badge-muted">{item.items.length}</span>}
                </div>
            );
        }
        const group = this.group(item.ref);
        return (
            <div key={item.key} {...common} className="tw-bpe-tile tw-bpe-layout-tile" data-missing={group ? undefined : 'true'}
                data-in-folder={inFolder ? 'true' : undefined}
                onPointerDown={event => this.press(event, {kind: 'layout', layoutId: layout.id, key: item.key}, label, groupColor(group))}>
                <GroupIcon group={group} />
                <span className="tw-bpe-tile-label">{label}</span>
                {!group && <span className="tw-bpe-tile-caption">{text.missing}</span>}
                {item.label && group && <span className="tw-bpe-tile-caption">{group.name}</span>}
                {modeMark(item.mode)}
            </div>
        );
    }

    renderLayoutGrid(layout: PaletteLayout) {
        const text = this.text;
        if (layout.builtin) {
            // The default palette follows the first panel and is not edited; its copies are.
            return (
                <div className="tw-bpe-layout" data-layout-id={layout.id} data-builtin-layout="">
                    <p className="tw-bpe-layout-note">{text.defaultNote}</p>
                    <div className="tw-bpe-grid" role="list" aria-label={layout.name}>
                        {this.view(layout)!.items.map(item => {
                            const group = item.kind === 'group' ? this.group(item.ref) : undefined;
                            return (
                                <div key={item.key} role="listitem" className="tw-bpe-tile tw-bpe-layout-tile" data-key={item.key}
                                    data-readonly="" title={group?.name}>
                                    <GroupIcon group={group} />
                                    <span className="tw-bpe-tile-label">{group?.name}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }
        const drag = this.state.drag;
        const areaHint = (folder?: string) => drag?.hint?.kind === 'area' && drag.hint.layoutId === layout.id &&
            drag.hint.folder === folder ? 'true' : undefined;
        const tiles: React.ReactNode[] = [];
        for (const item of layout.items) {
            tiles.push(this.renderTile(layout, item, false));
            if (item.kind === 'folder' && this.state.openFolders.has(item.key)) {
                tiles.push(
                    <div key={`${item.key}-open`} className="tw-bpe-folder-open" data-bpe-drop="area" data-layout-id={layout.id}
                        data-folder-key={item.key} data-drop-target={areaHint(item.key)} data-mode={item.mode}>
                        <div className="tw-bpe-folder-open-title">{this.itemLabel(item)}</div>
                        <div className="tw-bpe-grid" role="list">
                            {item.items.map(member => this.renderTile(layout, member, true))}
                            {!item.items.length && <div className="tw-bpe-empty">{text.emptyFolder}</div>}
                        </div>
                    </div>
                );
            }
        }
        return (
            <div className="tw-bpe-layout" data-bpe-drop="area" data-layout-id={layout.id} data-drop-target={areaHint(undefined)}>
                <div className="tw-bpe-grid" role="list" aria-label={layout.name}>{tiles}</div>
                {!layout.items.length && (
                    <div className="tw-bpe-empty">{this.props.horizontal ? text.emptyLayout : text.emptyLayoutVertical}</div>
                )}
            </div>
        );
    }

    renderLayouts() {
        const text = this.text;
        const {dial} = this.state;
        const sep = this.props.horizontal ? '│' : '―';
        return (
            <section className="tw-bpe-panel tw-bpe-layouts" aria-label={text.layouts}>
                <div className="tw-bpe-tabs" ref={this.tabsHost} />
                {!this.layouts.length && (
                    <div className="tw-bpe-no-layouts">
                        <div className="tw-bpe-tabs-placeholder">
                            <button type="button" className="tw-bpe-add-tab" aria-label={text.addTab} title={text.addTab}
                                onClick={() => this.addLayout()}>＋</button>
                        </div>
                        <div className="tw-bpe-empty">{text.noLayouts}</div>
                    </div>
                )}
                {[...this.state.mounts].map(([id, element]) => {
                    const layout = this.layouts.find(item => item.id === id);
                    return layout ? ReactDOM.createPortal(this.renderLayoutGrid(layout), element, id) : null;
                })}
                <div className="tw-bpe-dial" data-open={dial ? 'true' : undefined}>
                    {dial && (
                        <div className="tw-bpe-dial-actions" role="menu">
                            <button type="button" role="menuitem" data-action="separator" onClick={() => {
                                this.setState({dial: false});
                                this.addItem({kind: 'separator', key: newLayoutKey()});
                            }}><span aria-hidden="true">{sep}</span>{text.separator}</button>
                            <button type="button" role="menuitem" data-action="open-folder" onClick={() => {
                                this.setState({dial: false});
                                this.addItem({kind: 'folder', key: newLayoutKey(), label: text.folder, mode: 'open', items: []});
                            }}><span aria-hidden="true">📂</span>{text.openFolder}</button>
                            <button type="button" role="menuitem" data-action="auto-folder" onClick={() => {
                                this.setState({dial: false});
                                this.addItem({kind: 'folder', key: newLayoutKey(), label: text.folder, mode: 'auto', items: []});
                            }}><span aria-hidden="true">📁</span>{text.autoFolder}</button>
                        </div>
                    )}
                    <button type="button" className="tw-bpe-dial-button" aria-label={text.add} title={text.add}
                        aria-expanded={dial} onClick={() => this.setState({dial: !dial, menu: null})}>＋</button>
                </div>
            </section>
        );
    }

    renderPreview() {
        const text = this.text;
        const layout = this.view(this.active);
        return (
            <section className="tw-bpe-panel tw-bpe-preview" aria-label={text.preview}>
                <h3 className="tw-bpe-panel-title">{text.preview}{layout ? ` — ${layout.name}` : ''}
                    <span className="tw-bpe-panel-note">{text.savedAs}</span></h3>
                <div className="tw-bpe-preview-canvas">
                    <PalettePreview layout={layout} groups={this.props.groups} horizontal={this.props.horizontal}
                        text={text} label={item => this.itemLabel(item)} />
                </div>
            </section>
        );
    }

    renderPopover() {
        const {popover} = this.state;
        const group = popover && this.group(popover.id);
        if (!popover || !group) return null;
        const text = this.text;
        const nested = this.props.groups.filter(item => item.parent === group.id);
        return (
            <div className="tw-bpe-popover" role="dialog" aria-label={group.name}
                style={{left: Math.max(8, popover.x), top: popover.y}}>
                <div className="tw-bpe-popover-header">
                    <GroupIcon group={group} size={22} />
                    <strong>{group.name}</strong>
                    <button type="button" className="tw-bpe-close" aria-label={text.close} onClick={() => this.setState({popover: null})}>×</button>
                </div>
                {group.extensionName && <p className="tw-bpe-popover-meta">{text.extension}: {group.extensionName}</p>}
                {nested.length > 0 && (
                    <>
                        <h4>{text.nested}</h4>
                        <ul className="tw-bpe-popover-nested">
                            {nested.map(item => <li key={item.id}><GroupIcon group={item} size={14} />{item.name}</li>)}
                        </ul>
                    </>
                )}
                <h4>{text.blocks} ({group.blocks.length})</h4>
                <ul className="tw-bpe-popover-blocks">
                    {group.blocks.map((block, index) => (
                        <li key={index} style={{borderLeftColor: groupColor(group)}}>{block}</li>
                    ))}
                </ul>
            </div>
        );
    }

    renderMenu() {
        const {menu} = this.state;
        if (!menu) return null;
        const text = this.text;
        const close = () => this.setState({menu: null});
        if (menu.kind === 'tab') {
            const layout = this.layouts.find(item => item.id === menu.layoutId);
            if (!layout) return null;
            return (
                <div className="tw-bpe-menu" role="menu" style={{left: menu.x, top: menu.y}}>
                    <button type="button" role="menuitem" onClick={() => {
                        close();
                        this.setState({prompt: {title: text.editTabLabel, value: layout.name,
                            submit: value => value.trim() && this.renameLayout(layout.id, value.trim())}});
                    }}>{text.editTabLabel}</button>
                    <button type="button" role="menuitem" onClick={() => {
                        close();
                        this.duplicateLayout(layout.id);
                    }}>{text.duplicate}</button>
                    {!layout.builtin && (
                        <button type="button" role="menuitem" onClick={() => {
                            close();
                            this.removeLayout(layout.id);
                        }}>{text.remove}</button>
                    )}
                </div>
            );
        }
        const layout = this.layouts.find(item => item.id === menu.layoutId);
        const path = layout && pathOfKey(layout, menu.key);
        const item = path && (path.child === undefined ? layout.items[path.index] :
            (layout.items[path.index] as PaletteLayoutFolder).items[path.child]);
        if (!item) return null;
        return (
            <div className="tw-bpe-menu" role="menu" style={{left: menu.x, top: menu.y}}>
                {item.kind !== 'separator' && (
                    <>
                        <button type="button" role="menuitem" onClick={() => {
                            close();
                            const value = item.kind === 'folder' ? item.label : item.label ?? this.group(item.ref)?.name ?? '';
                            this.setState({prompt: {title: text.editLabel.replace(/…$/, ''), value,
                                submit: next => this.changeItem(layout.id, item.key, {label: next})}});
                        }}>{text.editLabel}</button>
                        <div className="tw-bpe-submenu-host" onMouseEnter={() => this.setState({menu: {...menu, submenu: true}})}
                            onMouseLeave={() => this.setState({menu: {...menu, submenu: false}})}>
                            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={!!menu.submenu}
                                onClick={() => this.setState({menu: {...menu, submenu: !menu.submenu}})}>{text.display}<span aria-hidden="true">▸</span></button>
                            {menu.submenu && (
                                <div className="tw-bpe-menu tw-bpe-submenu" role="menu">
                                    {(['open', 'auto'] as const).map(mode => (
                                        <button key={mode} type="button" role="menuitemradio" aria-checked={item.mode === mode}
                                            onClick={() => {
                                                close();
                                                this.changeItem(layout.id, item.key, {mode});
                                            }}>
                                            <span className="tw-bpe-check" aria-hidden="true">{item.mode === mode ? '✓' : ''}</span>
                                            {mode === 'open' ? text.alwaysOpen : text.autoOpen}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}
                <button type="button" role="menuitem" onClick={() => {
                    close();
                    this.removeItem(layout.id, item.key);
                }}>{text.remove}</button>
            </div>
        );
    }

    renderPrompt() {
        const {prompt} = this.state;
        if (!prompt) return null;
        const text = this.text;
        const submit = () => {
            prompt.submit(prompt.value);
            this.setState({prompt: null});
        };
        return (
            <div className="tw-bpe-prompt-backdrop" onPointerDown={event => {
                if (event.target === event.currentTarget) this.setState({prompt: null});
            }}>
                <form className="tw-bpe-prompt" role="dialog" aria-label={prompt.title} onSubmit={event => {
                    event.preventDefault();
                    submit();
                }}>
                    <h3>{prompt.title}</h3>
                    <input type="text" aria-label={text.label} value={prompt.value} autoFocus
                        onFocus={event => event.currentTarget.select()}
                        onChange={event => {
                            const value = event.currentTarget.value;
                            this.setState(state => state.prompt && {prompt: {...state.prompt, value}});
                        }} />
                    <div className="tw-bpe-prompt-actions">
                        <button type="button" onClick={() => this.setState({prompt: null})}>{text.cancel}</button>
                        <button type="submit" className="tw-bpe-primary">{text.ok}</button>
                    </div>
                </form>
            </div>
        );
    }

    render() {
        const text = this.text;
        const {horizontal, onCancel, onApply} = this.props;
        const {sizes, drag, maximized} = this.state;
        const splitter = (index: 0 | 1) => (
            <div className="tw-bpe-splitter" role="separator" aria-orientation={horizontal ? 'horizontal' : 'vertical'}
                onPointerDown={event => this.startSplit(event, index)} />
        );
        return (
            <div className="tw-bpe" ref={this.root} data-orientation={horizontal ? 'horizontal' : 'vertical'}
                data-dragging={drag ? 'true' : undefined}
                onPointerDown={event => {
                    const target = event.target as HTMLElement;
                    if (this.state.menu && !target.closest('.tw-bpe-menu')) this.setState({menu: null});
                    if (this.state.popover && !target.closest('.tw-bpe-popover, .tw-bpe-source-tile')) this.setState({popover: null});
                    if (this.state.dial && !target.closest('.tw-bpe-dial')) this.setState({dial: false});
                }}>
                <header className="tw-bpe-header">
                    <h2>{text.title}</h2>
                    <span className="tw-bpe-header-controls">
                        <button type="button" className="tw-bpe-close tw-bpe-maximize"
                            aria-label={maximized ? text.restore : text.maximize} title={maximized ? text.restore : text.maximize}
                            aria-pressed={maximized} onClick={() => {
                                const value = !maximized;
                                this.setState({maximized: value});
                                this.root.current?.closest('dialog')?.toggleAttribute('data-maximized', value);
                            }}>{maximized ? '❐' : '□'}</button>
                        <button type="button" className="tw-bpe-close" aria-label={text.close} title={text.close} onClick={onCancel}>×</button>
                    </span>
                </header>
                <div className="tw-bpe-panels">
                    <div className="tw-bpe-pane" style={{flex: `${sizes[0]} 1 0`}}>{this.renderSource()}</div>
                    {splitter(0)}
                    <div className="tw-bpe-pane" style={{flex: `${sizes[1]} 1 0`}}>{this.renderLayouts()}</div>
                    {splitter(1)}
                    <div className="tw-bpe-pane" style={{flex: `${sizes[2]} 1 0`}}>{this.renderPreview()}</div>
                </div>
                <footer className="tw-bpe-footer">
                    <button type="button" onClick={onCancel}>{text.cancel}</button>
                    <button type="button" className="tw-bpe-primary" onClick={() => onApply(this.result())}>{text.apply}</button>
                </footer>
                {this.renderPopover()}
                {this.renderMenu()}
                {this.renderPrompt()}
                {drag && (
                    <div className="tw-bpe-ghost" style={{left: drag.x, top: drag.y}} aria-hidden="true">
                        <span className="tw-bpe-icon" style={{background: drag.color ?? '#9aa3b5', borderColor: drag.color ?? '#9aa3b5'}} />
                        <span>{drag.label}</span>
                    </div>
                )}
            </div>
        );
    }
}

/**
 * The palette a layout makes, drawn like the block palette: a row (or column) of group icons, always-open groups and
 * folders with their members beside them, separators, and child palettes that open from the other groups and folders.
 * The palette's frame can be resized to see how it wraps.
 */
export function PalettePreview({layout, groups, horizontal, text, label}: {
    layout?: PaletteLayout;
    groups: readonly PaletteSourceGroup[];
    horizontal: boolean;
    text: Text;
    label(item: PaletteLayoutItem): string;
}) {
    const [openKey, setOpenKey] = React.useState<string | null>(null);
    if (!layout || !layout.items.some(item => item.kind !== 'separator')) {
        return <div className="tw-bpe-preview-palette" data-orientation={horizontal ? 'horizontal' : 'vertical'}
            data-empty="true" title={text.resize}><div className="tw-bpe-empty">{text.emptyPreview}</div></div>;
    }
    const byId = (id: string) => groups.find(group => group.id === id);
    // Drawn as the palette draws it: what it leaves out is shown faded, with the reason.
    const {omitted, nested: nestedOf} = resolvePaletteLayout(layout, groups);
    const faded = (key: string) => {
        const reason = omitted.get(key);
        return reason ? {'data-omitted': reason, title: text.omitted[reason]} : {};
    };
    const entry = (group: PaletteSourceGroup | undefined, name: string, key: string, extra?: React.ReactNode, own = {}) => (
        <span key={key} className="tw-bpe-preview-item" title={name} {...own}>
            <GroupIcon group={group} size={20} />
            <span className="tw-bpe-preview-name">{name}</span>
            {extra}
        </span>
    );
    const toggle = (key: string) => setOpenKey(current => current === key ? null : key);
    const popup = (key: string, members: React.ReactNode[]) => openKey === key && (
        <span className="tw-bpe-preview-popup" role="group">{members}</span>
    );
    const groupNode = (item: PaletteLayoutGroup, inPalette = true) => {
        const group = byId(item.ref);
        const name = label(item);
        const nested = omitted.has(item.key) ? [] : nestedOf(item.ref).map(byId);
        // A group kept open in a horizontal palette has its own block list under its icon, which takes its width.
        if (!nested.length && horizontal && inPalette && item.mode === 'open' && !omitted.has(item.key)) {
            return <span key={item.key} className="tw-bpe-preview-kept" data-key={item.key}>
                {entry(group, name, 'self')}
                <span className="tw-bpe-preview-kept-blocks" aria-label={text.keptOpen}>
                    {(group?.blocks ?? []).map((block, index) => (
                        <span key={index} className="tw-bpe-preview-block" style={{background: groupColor(group)}}>{block}</span>
                    ))}
                </span>
            </span>;
        }
        if (!nested.length) return entry(group, name, item.key, undefined, faded(item.key));
        const members = nested.map(member => entry(member, member.name, `${item.key}-${member.id}`));
        if (item.mode === 'open') {
            return <span key={item.key} className="tw-bpe-preview-open" data-kind="group">
                {entry(group, name, 'self')}{members}
            </span>;
        }
        return <span key={item.key} className="tw-bpe-preview-auto">
            <button type="button" className="tw-bpe-preview-button" aria-expanded={openKey === item.key}
                onClick={() => toggle(item.key)}>{entry(group, name, 'self', <span className="tw-bpe-mode">▸</span>)}</button>
            {popup(item.key, members)}
        </span>;
    };
    const nodes = layout.items.map(item => {
        if (item.kind === 'separator') {
            return <span key={item.key} className="tw-bpe-preview-separator" role="separator" {...faded(item.key)} />;
        }
        if (item.kind === 'group') return groupNode(item);
        const members = item.items.map(member => groupNode(member, item.mode === 'open'));
        if (omitted.has(item.key)) {
            return <span key={item.key} className="tw-bpe-preview-item" {...faded(item.key)}>
                <span className="tw-bpe-preview-folder" aria-hidden="true">📁</span>
                <span className="tw-bpe-preview-name">{label(item)}</span>
            </span>;
        }
        if (item.mode === 'open') {
            return <span key={item.key} className="tw-bpe-preview-open" data-kind="folder">
                <span className="tw-bpe-preview-folder-label">📂 {label(item)}</span>{members}
            </span>;
        }
        return <span key={item.key} className="tw-bpe-preview-auto">
            <button type="button" className="tw-bpe-preview-button" aria-expanded={openKey === item.key} onClick={() => toggle(item.key)}>
                <span className="tw-bpe-preview-item"><span className="tw-bpe-preview-folder" aria-hidden="true">📁</span>
                    <span className="tw-bpe-preview-name">{label(item)}</span><span className="tw-bpe-mode">▸</span></span>
            </button>
            {popup(item.key, members)}
        </span>;
    });
    return <div className="tw-bpe-preview-palette" data-orientation={horizontal ? 'horizontal' : 'vertical'} title={text.resize}>
        {nodes}
    </div>;
}

/** Opens the editor as a modal `<dialog>` in `document`. Returns the function that closes it. */
export function openBlockPaletteEditor(document: Document, props: BlockPaletteEditorProps): () => void {
    const dialog = document.createElement('dialog');
    dialog.className = 'tw-block-palette-editor-dialog';
    dialog.setAttribute('aria-label', (isJapanese(props.locale) ? messages.ja : messages.en).title);
    document.body.append(dialog);
    let open = true;
    const close = () => {
        if (!open) return;
        open = false;
        ReactDOM.unmountComponentAtNode(dialog);
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        dialog.remove();
    };
    dialog.addEventListener('cancel', event => {
        event.preventDefault();
        close();
        props.onCancel();
    });
    ReactDOM.render(React.createElement(BlockPaletteEditor, {
        ...props,
        onApply: saved => {
            close();
            props.onApply(saved);
        },
        onCancel: () => {
            close();
            props.onCancel();
        },
        onAddExtension: props.onAddExtension && (saved => {
            close();
            props.onAddExtension!(saved);
        })
    }), dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return close;
}
