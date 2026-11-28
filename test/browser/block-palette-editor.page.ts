// The test page for block-palette-editor.browser.ts: the horizontal block palette with its ▼ button opening the block
// palette editor, in the minimal editor runtime.
import styles from '../../src/styles.css';
import horizontalStyles from '../../src/horizontal-block-palette.css';
import dockviewStyles from 'dockview/dist/styles/dockview.css';
import {createHorizontalBlockPalette} from '../../dist/horizontal-block-palette.js';

declare const EditorRuntime: any;
declare const Blockly: any;

(globalThis as any).setup = async (horizontal: boolean, toolboxXml: string, locale = 'en') => {
    const style = document.createElement('style');
    style.textContent = dockviewStyles + styles + horizontalStyles.replace(/:global\(([^)]+)\)/g, '$1');
    document.head.append(style);
    let libraryOpened = 0;
    const palette = createHorizontalBlockPalette({
        getScratchBlocks: () => Blockly,
        openExtensionLibrary() { libraryOpened++; },
        styles: {horizontal: 'horizontal', panel: 'panel', scrollbar: 'scrollbar'}
    });
    palette.installHorizontalBlockPalette(Blockly);
    palette.setHorizontalBlockPalette(horizontal);
    const host = await EditorRuntime.start(document.getElementById('workspace'), {locale});
    host.workspace.updateToolbox(toolboxXml);
    const toolbox = host.workspace.getToolbox();
    (globalThis as any).palette = {
        host,
        libraryOpened: () => libraryOpened,
        ids: () => toolbox.categoryMenu_.categories_.map((category: any) => category.id_),
        rows: () => Array.from(toolbox.categoryMenu_.table.children as HTMLCollectionOf<HTMLElement>).map(row =>
            row.hasAttribute('data-palette-layout-separator') ? '|' :
                row.querySelector('[class*="scratchCategoryId-"]')?.className.match(/scratchCategoryId-(\S+)/)?.[1] ?? '?')
            .filter(id => id === '|' || !row(id)),
        names: () => toolbox.categoryMenu_.categories_.map((category: any) => category.name_),
        flyoutBlocks: () => toolbox.flyout_.isVisible() ? toolbox.flyout_.workspace_.getTopBlocks(true).map((block: any) => block.type) : []
    };
    // A member of a folded group stays in the table but is hidden.
    function row(id: string) {
        const item = toolbox.categoryMenu_.categories_.find((category: any) => category.id_ === id)?.item_;
        return item && getComputedStyle(item.parentElement).display === 'none';
    }
};
