import {getCodeSession} from './workspace.ts';

/** Reuse the script editor: its root stays at its original project coordinates. */
export function openSerialScriptEditor(vm: object, target, id: string, document: Document, locale: string) {
    const bridge = getCodeSession(vm).bridge;
    if (!bridge || !target?.blocks._blocks[id]) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'tw-serial-script-editor';
    const title = document.createElement('h2');
    title.textContent = /^ja(?:-|$)/i.test(locale) ? 'スクリプトを編集' : 'Edit script';
    title.id = `script-editor-${document.defaultView.crypto.randomUUID()}`;
    dialog.setAttribute('aria-labelledby', title.id);
    const area = document.createElement('div');
    area.dataset.serialScriptEditor = id;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = /^ja(?:-|$)/i.test(locale) ? '閉じる' : 'Close';
    dialog.append(title, area, close);
    document.body.append(dialog);
    dialog.showModal();
    let editor: ReturnType<typeof bridge.editProcedure>;
    try {
        editor = bridge.editProcedure(area, {target, definitionId: id, editable: true, locale});
    } catch (error) {
        dialog.close();
        dialog.remove();
        throw error;
    }
    let closed = false;
    const dispose = () => {
        if (closed) return;
        closed = true;
        editor.flush();
        editor.dispose();
        dialog.close();
        dialog.remove();
    };
    close.addEventListener('click', dispose);
    dialog.addEventListener('cancel', event => {event.preventDefault(); dispose();});
    return {dispose};
}
