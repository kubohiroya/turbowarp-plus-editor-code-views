// The test page for palette-groups.browser.ts: the runtime's workspace with its toolbox wired to the child palettes
// the way the Editor wires them, and the detached block palette.
import styles from '../../src/styles.css';
import {attachPaletteCategoryGroups} from '../../dist/palette-category-groups.js';
import {createPaletteOrder} from '../../dist/palette-category-visibility.js';
import {connectDetachedBlockPalette, openDetachedBlockPalette} from '../../dist/detached-block-palette.js';

declare const EditorRuntime: any;
declare const Blockly: any;

const addStyles = (doc: Document) => {
    const style = doc.createElement('style');
    style.textContent = styles as unknown as string;
    doc.head.append(style);
    return () => style.remove();
};

(globalThis as any).setup = async (toolboxXml: string) => {
    addStyles(document);
    const host = await EditorRuntime.start(document.getElementById('workspace'), {locale: 'en'});
    const workspace = host.workspace;
    const toolbox = workspace.getToolbox();
    const menu: HTMLElement = toolbox.HtmlDiv;
    const categories = () => toolbox.categoryMenu_.categories_;
    const order = createPaletteOrder();
    let reorders = 0;
    // After members are reordered, the categories follow them, as the Editor lays its palette out again.
    const relayout = () => {
        reorders++;
        const current = categories();
        const arranged = groups.arrange(current, () => 0);
        current.splice(0, current.length, ...arranged);
        toolbox.categoryMenu_.table.append(...arranged.map((category: any) => category.item_.parentElement));
    };
    const groups = attachPaletteCategoryGroups(menu, {
        categories,
        horizontal: () => false,
        choose: category => toolbox.setSelectedItem(category),
        reorder: true,
        onReorder: relayout,
        order: () => order,
        locale: () => 'en'
    });
    const populate = toolbox.populate_;
    toolbox.populate_ = function (tree: Element) {
        const found = groups.prepare(tree);
        populate.call(this, tree);
        groups.update(found);
    };
    workspace.updateToolbox(toolboxXml);
    connectDetachedBlockPalette({
        blocks: Blockly, workspace, flyout: toolbox.flyout_, menu,
        categories: () => categories().map((category: any) => ({
            id: category.id_, label: category.name_,
            color: category.item_.querySelector('.scratchCategoryItemBubble')?.style.backgroundColor
        })),
        grouping: () => ({groups: groups.current(), order}),
        show(id: string) {
            const category = categories().find((item: any) => item.id_ === id);
            if (category) toolbox.setSelectedItem(category);
        },
        setDetached() {}
    });
    (globalThis as any).palette = {
        order,
        reorders: () => reorders,
        ids: () => categories().map((category: any) => category.id_),
        selected: () => toolbox.getSelectedItem()?.id_,
        openDetached: () => openDetachedBlockPalette(workspace, {locale: 'en', categoryIcons: {}, decorate: addStyles})
    };
};
