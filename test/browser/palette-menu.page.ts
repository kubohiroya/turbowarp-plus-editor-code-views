import styles from '../../src/styles.css';
import horizontalStyles from '../../src/horizontal-block-palette.css';
import {createHorizontalBlockPalette} from '../../dist/horizontal-block-palette.js';

declare const EditorRuntime: any;
declare const Blockly: any;

(globalThis as any).setup = async (horizontal = true, showPaletteMenu = true) => {
    const style = document.createElement('style');
    style.textContent = styles + horizontalStyles.replace(/:global\(([^)]+)\)/g, '$1');
    document.head.append(style);
    const palette = createHorizontalBlockPalette({
        getScratchBlocks: () => Blockly,
        openExtensionLibrary() {},
        styles: {horizontal: 'horizontal', panel: 'panel', scrollbar: 'scrollbar'}, showPaletteMenu
    });
    palette.installHorizontalBlockPalette(Blockly);
    palette.setHorizontalBlockPalette(horizontal);
    const host = await EditorRuntime.start(document.getElementById('workspace'), {locale: 'en'});
    (globalThis as any).palette = {
        host, setHorizontal: palette.setHorizontalBlockPalette,
        originalSetVisible: Blockly.WorkspaceSvg.prototype.setVisible
    };
};
