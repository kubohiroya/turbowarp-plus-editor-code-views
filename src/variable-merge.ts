import {applyPlan, planMerge, planScopeChange, refreshEditor, undoPlan,
    type Plan, type Refusal, type VmLike} from './variable-merge-plan.ts';

export {applyPlan, findVariable, planMerge, planScopeChange, refreshEditor, undoPlan} from './variable-merge-plan.ts';
export type {Plan, PlanResult, Refusal, UndoRecord, VmLike, Warning} from './variable-merge-plan.ts';

/**
 * Entry points for merging variables and changing their scope.
 *
 * - Renaming a variable or list to the name of another one it can see offers to merge it into
 *   that one, instead of only refusing.
 * - The palette's variable and list blocks get "Make it for all sprites" / "Make it for this
 *   sprite only" in their context menu.
 *
 * Both go through scratch-blocks' own functions (`Variables.renameVariable`,
 * `Variables.validateScalarVarOrListName_` and the data blocks' context menu mixins), so the fork
 * needs no hook. The change itself is made on the VM and the workspace is reloaded from it.
 */

type Kind = 'variable' | 'list';

const MESSAGES = {
    en: {
        variable: 'variable', list: 'list', stage: 'Stage',
        mergeTitle: (kind: Kind): string => kind === 'list' ? 'Merge lists' : 'Merge variables',
        mergeLead: (a: string, b: string) => `“${b}” already exists. Merge “${a}” into “${b}”?`,
        mergeBody: (a: string, b: string, n: number) =>
            `${n} block${n === 1 ? '' : 's'} using “${a}” will use “${b}”, and “${a}” will be deleted.`,
        perTarget: (target: string, n: number) => `${target}: ${n}`,
        values: (a: string, b: string, aValue: string, bValue: string) =>
            `“${b}” keeps its value ${bValue}. The value of “${a}”, ${aValue}, is discarded.`,
        sensing: (n: number) => `${n} “( ) of ( )” block${n === 1 ? '' : 's'} will be updated.`,
        makeGlobal: 'Make it for all sprites',
        makeLocal: 'Make it for this sprite only',
        globalLead: (a: string) => `Make “${a}” usable by all sprites?`,
        localLead: (a: string, sprite: string) => `Make “${a}” usable by “${sprite}” only?`,
        warnShare: 'Clones of this sprite kept a value each; afterwards they all share one value.',
        warnSplit: 'Clones of this sprite shared one value; afterwards each clone keeps its own.',
        warnDynamic: '“( ) of ( )” blocks whose sprite is a reporter cannot be updated and may stop finding it.',
        refusedTitle: 'Cannot do this',
        refusals: {
            same: 'There is nothing to change.',
            missing: 'The variable no longer exists.',
            type: 'Only a variable with a variable, or a list with a list, can be merged.',
            cloud: 'Cloud variables cannot be merged or moved.',
            stage: 'The Stage has no variables of its own; choose a sprite first.',
            'not-visible': (owner: string, targets: string) => `That one belongs to “${owner}” only, so it cannot be seen from: ${targets}.`,
            'used-elsewhere': (sprite: string, targets: string) =>
                `It cannot belong to “${sprite}” only, because it is also used in: ${targets}.`,
            'name-taken': (targets: string) => `These already have one with the same name: ${targets}.`
        },
        merge: 'Merge', change: 'Change', cancel: 'Cancel', ok: 'OK',
        merged: (a: string, b: string) => `Merged “${a}” into “${b}”.`,
        madeGlobal: (a: string) => `“${a}” is now for all sprites.`,
        madeLocal: (a: string) => `“${a}” is now for this sprite only.`,
        undo: 'Undo', undone: 'Undone.', close: 'Close', failed: 'The change could not be made.',
        items: (n: number) => `${n} item${n === 1 ? '' : 's'}`
    },
    ja: {
        variable: '変数', list: 'リスト', stage: 'ステージ',
        mergeTitle: (kind: Kind): string => kind === 'list' ? 'リストを統合' : '変数を統合',
        mergeLead: (a: string, b: string) => `「${b}」は既にあります。「${a}」を「${b}」に統合しますか？`,
        mergeBody: (a: string, b: string, n: number) => `「${a}」を使っているブロック ${n} 個を「${b}」に付け替え、「${a}」を削除します。`,
        perTarget: (target: string, n: number) => `${target}: ${n} 個`,
        values: (a: string, b: string, aValue: string, bValue: string) =>
            `「${b}」の値 ${bValue} を残し、「${a}」の値 ${aValue} は捨てます。`,
        sensing: (n: number) => `「( ) の ( )」のブロック ${n} 個も書き換えます。`,
        makeGlobal: 'すべてのスプライト用にする',
        makeLocal: 'このスプライトのみにする',
        globalLead: (a: string) => `「${a}」を、すべてのスプライトで使えるようにしますか？`,
        localLead: (a: string, sprite: string) => `「${a}」を、「${sprite}」だけで使えるようにしますか？`,
        warnShare: 'このスプライトのクローンは、これまでそれぞれ別の値を持っていましたが、変更後は1つの値を共有します。',
        warnSplit: 'このスプライトのクローンは、これまで1つの値を共有していましたが、変更後はそれぞれ別の値を持ちます。',
        warnDynamic: '「( ) の ( )」でスプライトをブロックで指定しているものは書き換えられず、値を読めなくなることがあります。',
        refusedTitle: 'この変更はできません',
        refusals: {
            same: '変えるものがありません。',
            missing: 'その変数はもうありません。',
            type: '変数は変数と、リストはリストとだけ統合できます。',
            cloud: 'クラウド変数は統合やスコープの変更ができません。',
            stage: 'ステージだけの変数はありません。先にスプライトを選んでください。',
            'not-visible': (owner: string, targets: string) => `それは「${owner}」だけのものなので、次の場所からは見えません: ${targets}`,
            'used-elsewhere': (sprite: string, targets: string) =>
                `次の場所でも使われているため、「${sprite}」だけのものにはできません: ${targets}`,
            'name-taken': (targets: string) => `次の場所に同じ名前のものが既にあります: ${targets}`
        },
        merge: '統合', change: '変更', cancel: 'キャンセル', ok: 'OK',
        merged: (a: string, b: string) => `「${a}」を「${b}」に統合しました。`,
        madeGlobal: (a: string) => `「${a}」をすべてのスプライト用にしました。`,
        madeLocal: (a: string) => `「${a}」をこのスプライトのみにしました。`,
        undo: '元に戻す', undone: '元に戻しました。', close: '閉じる', failed: '変更できませんでした。',
        items: (n: number) => `${n} 個の項目`
    },
    'ja-hira': {
        variable: 'へんすう', list: 'リスト', stage: 'ステージ',
        mergeTitle: (kind: Kind): string => kind === 'list' ? 'リストをまとめる' : 'へんすうをまとめる',
        mergeLead: (a: string, b: string) => `「${b}」は もう あります。「${a}」を「${b}」に まとめますか？`,
        mergeBody: (a: string, b: string, n: number) => `「${a}」を つかっている ブロック ${n}こを「${b}」に つけかえ、「${a}」を けします。`,
        perTarget: (target: string, n: number) => `${target}: ${n}こ`,
        values: (a: string, b: string, aValue: string, bValue: string) =>
            `「${b}」の あたい ${bValue} を のこし、「${a}」の あたい ${aValue} は すてます。`,
        sensing: (n: number) => `「( ) の ( )」の ブロック ${n}こも かきかえます。`,
        makeGlobal: 'すべての スプライトように する',
        makeLocal: 'この スプライトだけに する',
        globalLead: (a: string) => `「${a}」を、すべての スプライトで つかえるように しますか？`,
        localLead: (a: string, sprite: string) => `「${a}」を、「${sprite}」だけで つかえるように しますか？`,
        warnShare: 'この スプライトの クローンは、いままで べつべつの あたいを もっていましたが、かえたあとは 1つの あたいを いっしょに つかいます。',
        warnSplit: 'この スプライトの クローンは、いままで 1つの あたいを いっしょに つかっていましたが、かえたあとは べつべつの あたいを もちます。',
        warnDynamic: '「( ) の ( )」で スプライトを ブロックで えらんでいる ものは かきかえられず、あたいを よめなく なることが あります。',
        refusedTitle: 'この へんこうは できません',
        refusals: {
            same: 'かえる ものが ありません。',
            missing: 'その へんすうは もう ありません。',
            type: 'へんすうは へんすうと、リストは リストと だけ まとめられます。',
            cloud: 'クラウドへんすうは まとめたり、つかえる はんいを かえたり できません。',
            stage: 'ステージだけの へんすうは ありません。さきに スプライトを えらんでください。',
            'not-visible': (owner: string, targets: string) => `それは「${owner}」だけの ものなので、つぎの ばしょからは みえません: ${targets}`,
            'used-elsewhere': (sprite: string, targets: string) =>
                `つぎの ばしょでも つかわれているので、「${sprite}」だけの ものには できません: ${targets}`,
            'name-taken': (targets: string) => `つぎの ばしょに おなじ なまえの ものが もう あります: ${targets}`
        },
        merge: 'まとめる', change: 'かえる', cancel: 'キャンセル', ok: 'OK',
        merged: (a: string, b: string) => `「${a}」を「${b}」に まとめました。`,
        madeGlobal: (a: string) => `「${a}」を すべての スプライトように しました。`,
        madeLocal: (a: string) => `「${a}」を この スプライトだけに しました。`,
        undo: 'もとに もどす', undone: 'もとに もどしました。', close: 'とじる', failed: 'かえられませんでした。',
        items: (n: number) => `${n}この こうもく`
    }
};

export type VariableMergeMessages = typeof MESSAGES.en;

/**
 * Messages for a locale: `ja-Hira` gets hiragana, other `ja` Japanese, anything else English.
 * @param {string} locale The editor's language.
 * @returns {VariableMergeMessages} The messages.
 */
export const variableMergeMessages = (locale: string): VariableMergeMessages => {
    if (/^ja-hira/i.test(locale ?? '')) return MESSAGES['ja-hira'];
    if (/^ja(?:-|$)/i.test(locale ?? '')) return MESSAGES.ja;
    return MESSAGES.en;
};

const shorten = (text: string) => text.length > 40 ? `${text.slice(0, 39)}…` : text;

const formatValue = (value: unknown, list: boolean, m: VariableMergeMessages) => {
    if (list) return Array.isArray(value) ? m.items(value.length) : m.items(0);
    return `“${shorten(String(value ?? ''))}”`;
};

/**
 * The sentences a confirmation shows for a plan.
 * @param {Plan} plan The plan.
 * @param {VariableMergeMessages} m The messages.
 * @returns {{title: string, lead: string, details: string[], warnings: string[], confirm: string}} What to show.
 */
export const describePlan = (plan: Plan, m: VariableMergeMessages) => {
    const list = plan.source.type === 'list';
    const kind: Kind = list ? 'list' : 'variable';
    const a = plan.source.name;
    const b = plan.destination.name;
    const total = plan.references.reduce((sum, {count}) => sum + count, 0);
    const details: string[] = [];
    let title: string;
    let lead: string;
    let confirm: string;
    if (plan.kind === 'merge') {
        title = m.mergeTitle(kind);
        lead = m.mergeLead(a, b);
        confirm = m.merge;
        details.push(m.mergeBody(a, b, total));
        details.push(...plan.references.map(({target, count}) => m.perTarget(target, count)));
        details.push(m.values(a, b, formatValue(plan.source.value, list, m), formatValue(plan.destination.value, list, m)));
    } else {
        title = plan.kind === 'global' ? m.makeGlobal : m.makeLocal;
        lead = plan.kind === 'global' ? m.globalLead(a) : m.localLead(a, plan.sprite ?? '');
        confirm = m.change;
        details.push(...plan.references.map(({target, count}) => m.perTarget(target, count)));
    }
    if (plan.sensingReferences) details.push(m.sensing(plan.sensingReferences));
    const warnings = plan.warnings.map(warning =>
        warning === 'clones-share' ? m.warnShare : warning === 'clones-split' ? m.warnSplit : m.warnDynamic);
    return {title, lead, details, warnings, confirm};
};

/**
 * The sentence for a refusal.
 * @param {Refusal} refusal Why the change cannot be made.
 * @param {VariableMergeMessages} m The messages.
 * @returns {string} The sentence.
 */
export const describeRefusal = (refusal: Refusal, m: VariableMergeMessages) => {
    const join = (names: string[]) => names.join(', ');
    switch (refusal.code) {
    case 'not-visible': return m.refusals['not-visible'](refusal.owner, join(refusal.targets));
    case 'used-elsewhere': return m.refusals['used-elsewhere'](refusal.sprite, join(refusal.targets));
    case 'name-taken': return m.refusals['name-taken'](join(refusal.targets));
    default: return m.refusals[refusal.code];
    }
};

const element = <K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, className?: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/**
 * Ask before a change, or explain why it cannot be made when there is no `onConfirm`.
 * @returns {HTMLDialogElement} The open dialog.
 */
export const openVariableMergeDialog = (document: Document, {title, lead, details = [], warnings = [], confirm, cancel, onConfirm}: {
    title: string; lead: string; details?: string[]; warnings?: string[];
    confirm: string; cancel?: string; onConfirm?: () => void;
}) => {
    const dialog = element(document, 'dialog', 'twPlusVariableMergeDialog');
    dialog.setAttribute('aria-label', title);
    const form = element(document, 'form');
    form.method = 'dialog';
    form.append(element(document, 'h2', undefined, title), element(document, 'p', 'twPlusVariableMergeLead', lead));
    if (details.length) {
        const list = element(document, 'ul', 'twPlusVariableMergeDetails');
        for (const line of details) list.append(element(document, 'li', undefined, line));
        form.append(list);
    }
    for (const line of warnings) {
        const warning = element(document, 'p', 'twPlusVariableMergeWarning', line);
        warning.setAttribute('role', 'note');
        form.append(warning);
    }
    const footer = element(document, 'footer', 'tw-plus-dialog-actions');
    let cancelButton: HTMLButtonElement | null = null;
    if (onConfirm && cancel) {
        cancelButton = element(document, 'button', undefined, cancel);
        cancelButton.type = 'button';
        cancelButton.dataset.dialogAction = 'cancel';
        footer.append(cancelButton);
    }
    const submit = element(document, 'button', undefined, confirm);
    submit.type = 'submit';
    submit.dataset.dialogAction = 'confirm';
    footer.append(submit);
    form.append(footer);
    dialog.append(form);

    let open = true;
    const close = () => {
        if (!open) return;
        open = false;
        if (dialog.open) dialog.close();
        dialog.remove();
    };
    cancelButton?.addEventListener('click', close);
    dialog.addEventListener('cancel', event => {
        event.preventDefault();
        close();
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        close();
        onConfirm?.();
    });
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    (cancelButton ?? submit).focus();
    return dialog;
};

const SVG = 'http://www.w3.org/2000/svg';

const closeIcon = (document: Document) => {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', 'M4 4l8 8M12 4l-8 8');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    svg.append(path);
    return svg;
};

const notices = new WeakMap<Document, () => void>();

/**
 * Say what changed, with an Undo button when the change can be undone. One notice per document:
 * a new one replaces the last. It hides after `timeout` ms unless the pointer or focus is on it.
 * @returns {() => void} A function that removes it.
 */
export const showVariableMergeNotice = (document: Document, text: string, m: VariableMergeMessages,
    onUndo?: () => void, timeout = 10000) => {
    notices.get(document)?.();
    const notice = element(document, 'div', 'twPlusVariableMergeNotice');
    notice.setAttribute('role', 'status');
    notice.append(element(document, 'span', undefined, text));
    const view = document.defaultView;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const remove = () => {
        if (timer !== undefined) (view ?? globalThis).clearTimeout(timer);
        timer = undefined;
        notice.remove();
        if (notices.get(document) === remove) notices.delete(document);
    };
    if (onUndo) {
        const undo = element(document, 'button', 'twPlusVariableMergeUndo', m.undo);
        undo.type = 'button';
        undo.addEventListener('click', () => {
            remove();
            onUndo();
        });
        notice.append(undo);
    }
    const close = element(document, 'button', 'twPlusVariableMergeClose');
    close.type = 'button';
    close.title = m.close;
    close.setAttribute('aria-label', m.close);
    close.append(closeIcon(document));
    close.addEventListener('click', remove);
    notice.append(close);
    const arm = () => {
        if (timer !== undefined) (view ?? globalThis).clearTimeout(timer);
        timer = (view ?? globalThis).setTimeout(remove, timeout);
    };
    const hold = () => {
        if (timer !== undefined) (view ?? globalThis).clearTimeout(timer);
        timer = undefined;
    };
    notice.addEventListener('pointerenter', hold);
    notice.addEventListener('focusin', hold);
    notice.addEventListener('pointerleave', arm);
    notice.addEventListener('focusout', arm);
    document.body.append(notice);
    notices.set(document, remove);
    arm();
    return remove;
};

type ScratchBlocksLike = {
    Variables?: Record<string, unknown> & {
        renameVariable?: (...args: unknown[]) => unknown;
        createVariable?: (...args: unknown[]) => unknown;
        validateScalarVarOrListName_?: (...args: unknown[]) => unknown;
        trimName_?: (name: string) => string;
        CLOUD_PREFIX?: string;
    };
    Constants?: {Data?: Record<string, {customContextMenu?: (options: unknown[]) => void}>};
    ScratchMsgs?: {currentLocale_?: string};
    getMainWorkspace?: () => unknown;
};

type WorkspaceLike = {
    targetWorkspace?: WorkspaceLike | null;
    listeners_?: unknown[];
    getVariable?(name: string, type: string): {getId(): string} | null;
    getInjectionDiv?(): {ownerDocument?: Document} | null;
};

/**
 * Patch ScratchBlocks so renames offer merging and the palette offers scope changes.
 * @param {VmLike} vm The VM; its `blockListener` identifies the code area's workspace.
 * @param {object} ScratchBlocks The loaded ScratchBlocks.
 * @param {object} options How to find the document and the language, and where errors go.
 * @returns {() => void} A function that removes the patches.
 */
export function installVariableMerge (vm: VmLike & {blockListener?: unknown}, ScratchBlocks: ScratchBlocksLike, {
    document: fallbackDocument, locale, onError = error => console.error(error)
}: {
    document?: Document;
    locale?: string | (() => string);
    onError?: (error: unknown) => void;
} = {}) {
    const variables = ScratchBlocks?.Variables;
    if (!variables?.renameVariable || !variables.validateScalarVarOrListName_) return () => {};
    const getLocale = () => (typeof locale === 'function' ? locale() : locale) ??
        ScratchBlocks.ScratchMsgs?.currentLocale_ ?? 'en';
    const isCodeWorkspace = (workspace: WorkspaceLike) => {
        const main = workspace?.targetWorkspace ?? workspace;
        if (!main) return false;
        if (vm.blockListener && Array.isArray(main.listeners_)) return main.listeners_.includes(vm.blockListener);
        return main === ScratchBlocks.getMainWorkspace?.();
    };
    const documentOf = (workspace: WorkspaceLike) => {
        const main = workspace?.targetWorkspace ?? workspace;
        return main?.getInjectionDiv?.()?.ownerDocument ?? fallbackDocument ?? globalThis.document;
    };

    const carryOut = (document: Document, plan: Plan, done: string) => {
        const m = variableMergeMessages(getLocale());
        try {
            const record = applyPlan(vm, plan);
            refreshEditor(vm);
            showVariableMergeNotice(document, done, m, () => {
                try {
                    undoPlan(vm, record);
                    refreshEditor(vm);
                    showVariableMergeNotice(document, m.undone, m, undefined, 3000);
                } catch (error) {
                    onError(error);
                    showVariableMergeNotice(document, m.failed, m);
                }
            });
        } catch (error) {
            onError(error);
            showVariableMergeNotice(document, m.failed, m);
        }
    };

    const offer = (workspace: WorkspaceLike, result: ReturnType<typeof planMerge>) => {
        const document = documentOf(workspace);
        if (!document) return;
        const m = variableMergeMessages(getLocale());
        if ('refusal' in result) {
            openVariableMergeDialog(document, {title: m.refusedTitle, lead: describeRefusal(result.refusal, m), confirm: m.ok});
            return;
        }
        const {plan} = result;
        const text = describePlan(plan, m);
        const done = plan.kind === 'merge' ? m.merged(plan.source.name, plan.destination.name) :
            plan.kind === 'global' ? m.madeGlobal(plan.source.name) : m.madeLocal(plan.source.name);
        openVariableMergeDialog(document, {...text, cancel: m.cancel, onConfirm: () => carryOut(document, plan, done)});
    };

    // Renaming: the validator refuses a taken name with an alert. When the name belongs to another
    // variable of the same type that this workspace can see, offer to merge into it instead.
    const {renameVariable, createVariable, validateScalarVarOrListName_: validate} = variables;
    let pending: {workspace: WorkspaceLike; variable: {getId(): string; type: string}} | null = null;
    variables.renameVariable = function (workspace, variable, ...rest) {
        pending = {workspace: workspace as WorkspaceLike, variable: variable as {getId(): string; type: string}};
        return renameVariable.call(this, workspace, variable, ...rest);
    };
    if (createVariable) {
        variables.createVariable = function (...args) {
            pending = null;
            return createVariable.apply(this, args);
        };
    }
    variables.validateScalarVarOrListName_ = function (name, workspace, additionalVars, isCloud, type, ...rest) {
        const rename = pending;
        if (rename && rename.workspace === workspace && rename.variable.type === type) {
            pending = null;
            const ws = workspace as WorkspaceLike;
            const trimmed = typeof name === 'string' ? (variables.trimName_?.(name) ?? name.trim()) : '';
            const full = isCloud ? `${variables.CLOUD_PREFIX ?? ''}${trimmed}` : trimmed;
            const existing = trimmed ? ws.getVariable?.(full, type as string) : null;
            if (existing && existing.getId() !== rename.variable.getId() && isCodeWorkspace(ws)) {
                const [sourceId, destinationId] = [rename.variable.getId(), existing.getId()];
                // Let the rename prompt finish closing first.
                setTimeout(() => {
                    try {
                        offer(ws, planMerge(vm, sourceId, destinationId));
                    } catch (error) {
                        onError(error);
                    }
                });
                return null;
            }
        }
        return validate.call(this, name, workspace, additionalVars, isCloud, type, ...rest);
    };

    // The palette: the variable and list blocks' context menus get a scope change.
    const data = ScratchBlocks.Constants?.Data;
    const menus = [
        [data?.CUSTOM_CONTEXT_MENU_GET_VARIABLE_MIXIN, 'VARIABLE'],
        [data?.CUSTOM_CONTEXT_MENU_GET_LIST_MIXIN, 'LIST']
    ] as const;
    const restoreMenus: (() => void)[] = [];
    for (const [mixin, fieldName] of menus) {
        const original = mixin?.customContextMenu;
        if (!mixin || !original) continue;
        mixin.customContextMenu = function (options) {
            original.call(this, options);
            try {
                if (!this.isInFlyout || this.isCollapsed?.()) return;
                const id = this.getField?.(fieldName)?.getVariable?.()?.getId?.();
                const target = vm.editingTarget;
                const workspace = this.workspace as WorkspaceLike;
                if (!id || !target || target.isStage || !isCodeWorkspace(workspace)) return;
                const global = Object.hasOwn(vm.runtime.getTargetForStage().variables, id);
                const m = variableMergeMessages(getLocale());
                options.push({
                    text: global ? m.makeLocal : m.makeGlobal,
                    enabled: true,
                    callback: () => {
                        try {
                            offer(workspace, planScopeChange(vm, id, global ? 'local' : 'global', target));
                        } catch (error) {
                            onError(error);
                        }
                    }
                });
            } catch (error) {
                onError(error);
            }
        };
        restoreMenus.push(() => {
            mixin.customContextMenu = original;
        });
    }

    return () => {
        variables.renameVariable = renameVariable;
        if (createVariable) variables.createVariable = createVariable;
        variables.validateScalarVarOrListName_ = validate;
        for (const restore of restoreMenus) restore();
    };
}

/**
 * Install the merge and scope-change entry points once ScratchBlocks has loaded.
 * @param {object} options The VM, how to get ScratchBlocks, and optionally the document and language.
 * @returns {{ready: Promise<void>, dispose(): void}} Resolves once installed; dispose removes the patches.
 */
export function attachVariableMerge ({vm, getBlockly, document, locale, onError}: {
    vm: VmLike & {blockListener?: unknown};
    getBlockly: () => ScratchBlocksLike | Promise<ScratchBlocksLike>;
    document?: Document;
    locale?: string | (() => string);
    onError?: (error: unknown) => void;
}) {
    let disposed = false;
    let remove: (() => void) | null = null;
    const ready = Promise.resolve().then(() => getBlockly()).then(ScratchBlocks => {
        if (disposed || !ScratchBlocks) return;
        remove = installVariableMerge(vm, ScratchBlocks, {document, locale, onError});
    });
    return {
        ready,
        dispose () {
            disposed = true;
            remove?.();
            remove = null;
        }
    };
}
