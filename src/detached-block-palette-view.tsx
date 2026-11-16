import React from 'react';
import {IconMenuButton} from '@kubohiroya/turbowarp-plus-editor-windows';
import type {PaletteItem, PaletteSource} from './detached-block-palette.ts';
import {attachPaletteCategoryGroups} from './palette-category-groups.ts';
import type {PaletteCategoryGroupsController, PaletteGroups} from './palette-category-groups.ts';

const noGroups: PaletteGroups = {members: new Map(), withOwnContents: new Set()};

const horizontalLayoutIconPath = 'M2 5h5v6H2zm7 0h5v6H9z';
const verticalLayoutIconPath = 'M5 2h6v5H5zm0 7h6v5H5z';

function BlockPreview({svg}: {svg: SVGSVGElement}) {
    const ref = React.useRef<HTMLSpanElement>(null);
    React.useLayoutEffect(() => {
        const node = ref.current;
        node.replaceChildren(node.ownerDocument.importNode(svg, true));
    }, [svg]);
    return <span ref={ref} aria-hidden="true" />;
}

function LayoutIcon({path}: {path: string}) {
    return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
        strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
}

export default function Palette({source, locale, categoryIcons, close, startDrag, endDrag}: {
    source: PaletteSource;
    locale: string;
    categoryIcons: Readonly<Record<string, string>>;
    close(): void;
    startDrag(item: PaletteItem, data: DataTransfer): void;
    endDrag(): void;
}) {
    const ja = /^ja(?:-|$)/i.test(locale);
    const [vertical, setVertical] = React.useState(false);
    const [categoryId, setCategory] = React.useState('');
    const [revision, refresh] = React.useReducer(value => value + 1, 0);
    const [items, setItems] = React.useState<PaletteItem[]>([]);
    const [tooltip, setTooltip] = React.useState<{label: string; position: React.CSSProperties} | null>(null);
    const categories = source.categories();
    const selected = categories.find(category => category.id === categoryId) ?? categories[0];
    const selectedId = selected?.id;
    React.useLayoutEffect(() => source.subscribe(refresh), [source]);

    // The editor's groups open in child palettes here too, and pinning one shows its members in this list.
    const list = React.useRef<HTMLDivElement>(null);
    const groupsControl = React.useRef<PaletteCategoryGroupsController | null>(null);
    const layout = React.useRef(vertical);
    layout.current = vertical;
    const grouping = source.grouping?.();
    // Opening a child palette or pinning a group only draws the list again; the blocks shown stay as they are.
    const [, redraw] = React.useReducer(value => value + 1, 0);
    React.useLayoutEffect(() => {
        const menu = list.current;
        const controller = attachPaletteCategoryGroups(menu, {
            categories: () => source.categories().map(({id, label}) => ({
                id_: id, name_: label, setSelected() {},
                item_: menu.querySelector<HTMLElement>(`button[data-category-id="${CSS.escape(id)}"]`)
            })).filter(category => category.item_),
            // A row of categories, when the blocks are laid out below them.
            horizontal: () => layout.current,
            choose: category => {
                setCategory(category.id_);
                setTooltip(null);
            },
            order: () => source.grouping?.()?.order,
            locale: () => locale,
            onChange: redraw
        });
        groupsControl.current = controller;
        return () => {
            groupsControl.current = null;
            controller.dispose();
        };
    }, [source, locale]);
    const categoryKey = categories.map(category => category.id).join('\n');
    React.useLayoutEffect(() => {
        groupsControl.current?.update(grouping?.groups ?? noGroups);
    }, [categoryKey, grouping?.groups, vertical]);
    React.useLayoutEffect(() => grouping?.order.subscribe(redraw), [grouping?.order]);
    // A group stands for the selected category while its child palette holds it.
    const pressed = (id: string) => id === selectedId ||
        (!!selectedId && groupsControl.current?.isGroup(id) && groupsControl.current.shownAs(selectedId) === id);
    React.useLayoutEffect(() => {
        setItems(selectedId ? source.read(selectedId) : []);
    }, [source, selectedId, revision]);

    function showLabel(button: HTMLButtonElement, label: string) {
        const {left, right, top, bottom, height} = button.getBoundingClientRect();
        const viewportWidth = button.ownerDocument.documentElement.clientWidth;
        const positionOnLeft = left < viewportWidth / 2;
        const position = vertical
            ? {top: bottom + 8, ...(positionOnLeft ? {left} : {right: viewportWidth - right})}
            : {top: top + height / 2, ...(positionOnLeft ? {left: right + 8} : {right: viewportWidth - left + 8})};
        setTooltip({label, position});
    }

    return <main className="tw-detached-palette" data-palette-orientation={vertical ? 'vertical' : 'horizontal'}>
        <div className="tw-detached-palette__content">
            <div ref={list} className="tw-detached-palette__categories" role="group"
                aria-label={ja ? 'ブロックのカテゴリ' : 'Block categories'} onScroll={() => setTooltip(null)}>
                {categories.map(({id, label, color, image}) => {
                    const artwork = categoryIcons[id];
                    const backgroundImage = image || (artwork ? `url("${artwork}")` : undefined);
                    // Each category sits in a row of its own, which a group hides while it holds the category.
                    return <span key={id} className="tw-detached-palette__category"><button type="button" data-category-id={id}
                        aria-label={label} aria-pressed={Boolean(pressed(id))}
                        onMouseEnter={event => showLabel(event.currentTarget, label)}
                        onMouseLeave={() => setTooltip(null)}
                        onFocus={event => showLabel(event.currentTarget, label)}
                        onBlur={() => setTooltip(null)}
                        onKeyDown={event => { if (event.key === 'Escape') setTooltip(null); }}
                        onClick={() => {
                            setCategory(id);
                            setTooltip(null);
                        }}>
                        <span aria-hidden="true" className="tw-detached-palette__category-icon" style={{backgroundColor: color, backgroundImage}}>
                            {!backgroundImage && <LayoutIcon path="M2 4h5V2h3v2h4v8H2z" />}
                        </span>
                    </button></span>;
                })}
            </div>
            <div className="tw-detached-palette__blocks" role="group" aria-label={selected?.label}>
                {items.map((item, index) => item.insert ? <button key={index} type="button" aria-label={item.label}
                    title={item.label} disabled={item.disabled} draggable={Boolean(item.preview && !item.disabled)}
                    onDragStart={event => startDrag(item, event.dataTransfer)} onDragEnd={endDrag}
                    onClick={() => item.insert()}>
                    {item.preview ? <BlockPreview svg={item.preview} /> : item.label}
                </button> : <span key={index}>{item.label}</span>)}
            </div>
        </div>
        {tooltip && <div className="tw-detached-palette__tooltip" role="tooltip" style={tooltip.position}>{tooltip.label}</div>}
        <IconMenuButton className="tw-detached-palette__layout-menu" label={ja ? 'ブロックパレットのレイアウト' : 'Block palette layout'}
            icon={<LayoutIcon path={vertical ? verticalLayoutIconPath : horizontalLayoutIconPath} />} items={[
                {id: 'horizontal', label: ja ? '横並びにする' : 'Arrange horizontally', checked: !vertical,
                    icon: <LayoutIcon path={horizontalLayoutIconPath} />, onSelect: () => setVertical(false)},
                {id: 'vertical', label: ja ? '縦並びにする' : 'Arrange vertically', checked: vertical,
                    icon: <LayoutIcon path={verticalLayoutIconPath} />, onSelect: () => setVertical(true)},
                {id: 'dock', label: ja ? 'このパネルを別画面から元に戻す' : 'Return this panel to the editor',
                    icon: <LayoutIcon path="M9 3h4v10H3V9m0-6 6 6M5 9h4V5" />, onSelect: close}
            ]} />
    </main>;
}
