import React from 'react';
import ReactDOM from 'react-dom';
import {ExtensionRow} from '@kubohiroya/turbowarp-extension-security-dialog/react';
import type {ExtensionMetadata} from '@kubohiroya/turbowarp-extension-security-dialog';
import {standardGroups, type PaletteGroupSet, type ReplaceablePaletteGroup} from './palette-category-visibility.ts';

export interface PaletteExtension {
    /** The extension ID, which is also its palette category ID. */
    id: string;
    /** What the host knows about the extension; at least its name. */
    metadata: ExtensionMetadata;
    /**
     * The groups the extension declares, each chosen on its own, in place of the extension. A group whose ID is the
     * extension's holds the blocks no declared group takes.
     */
    groups?: readonly {id: string; name: string; color?: string}[];
}

export interface PaletteVisibilityChoice {
    /** The groups to show for the target. */
    groups: string[];
    /** Sets added in this dialog, to keep with the project. */
    addedSets: PaletteGroupSet[];
}

export interface PaletteVisibilityDialogProps {
    locale?: string;
    targetName: string;
    isStage: boolean;
    /** The groups shown now. */
    initial: ReadonlySet<string>;
    /** How many blocks of each group the target's code uses. */
    used: ReadonlyMap<string, number>;
    extensions: readonly PaletteExtension[];
    sets: readonly PaletteGroupSet[];
    /** Asked for a sprite just added: the screen names it as a new sprite. */
    newSprite?: boolean;
    /**
     * For a new sprite: the sprites already in the project with the groups each shows. The screen offers to copy
     * one of them into its choices, which the person then adjusts and applies.
     */
    copySources?: readonly {name: string; groups: readonly string[]}[];
    onApply(choice: PaletteVisibilityChoice): void;
    onCancel(): void;
}

const standardNames = {
    en: {motion: 'Motion', looks: 'Looks', sound: 'Sound', events: 'Events', control: 'Control', sensing: 'Sensing',
        operators: 'Operators', variables: 'Variables', lists: 'Lists', myBlocks: 'My Blocks'},
    ja: {motion: '動き', looks: '見た目', sound: '音', events: 'イベント', control: '制御', sensing: '調べる',
        operators: '演算', variables: '変数', lists: 'リスト', myBlocks: 'ブロック定義'}
};
const standardColors: Record<string, string> = {
    motion: '#4C97FF', looks: '#9966FF', sound: '#CF63CF', events: '#FFBF00', control: '#FFAB19', sensing: '#5CB1D6',
    operators: '#59C059', variables: '#FF8C1A', lists: '#FF661A', myBlocks: '#FF6680'
};
const messages = {
    en: {
        title: 'Block groups shown in the palette', sprite: (name: string) => `Sprite “${name}”`, stage: 'Stage',
        newSprite: (name: string) => `New sprite “${name}”`,
        quick: 'Choose several at once', copyFrom: 'Copy settings from', copy: 'Copy', chooseSprite: 'Choose a sprite',
        sets: 'Setting shortcuts', addSet: 'Add setting shortcut', setName: 'Shortcut name', add: 'Add',
        standard: 'Standard block groups', extensions: 'Extension block groups', used: (count: number) => `In use ${count}`,
        hiddenInUse: (count: number) => `Hidden and in use: ${count}`, otherBlocks: 'Other blocks', cancel: 'Cancel', confirm: 'Confirm', close: 'Close'
    },
    ja: {
        title: 'パレット内のブロックグループの表示・非表示の設定', sprite: (name: string) => `スプライト「${name}」`, stage: 'ステージ',
        newSprite: (name: string) => `新しいスプライト「${name}」`,
        quick: 'まとめて選ぶ', copyFrom: '設定のコピー元', copy: 'コピー', chooseSprite: 'スプライトを選ぶ',
        sets: '設定のショートカット', addSet: '設定のショートカットを追加', setName: 'ショートカットの名前', add: '追加',
        standard: '標準のブロックグループ', extensions: '機能拡張のブロックグループ', used: (count: number) => `使用中 ${count}`,
        hiddenInUse: (count: number) => `非表示中・使用中 ${count} 件`, otherBlocks: 'そのほかのブロック', cancel: 'キャンセル', confirm: '確定', close: '閉じる'
    }
};
const isJapanese = (locale?: string) => /^ja(?:-|$)/i.test(locale ?? '');

interface DialogState {
    shown: Set<string>;
    addedSets: PaletteGroupSet[];
    naming: boolean;
    setName: string;
    /** The sprite chosen to copy from, or null before one is chosen. */
    copySource: number | null;
    /** The groups a shortcut or a copy source under the pointer or focus would choose, shown in the lists. */
    highlight: Set<string> | null;
}

/**
 * The screen that chooses which block groups the palette shows for one sprite or the stage: sets that
 * switch several groups at once, the standard groups, and one row per extension drawn the same way as the
 * extension review.
 */
export class PaletteVisibilityDialog extends React.PureComponent<PaletteVisibilityDialogProps, DialogState> {
    constructor(props: PaletteVisibilityDialogProps) {
        super(props);
        this.state = {shown: new Set(props.initial), addedSets: [], naming: false, setName: '', copySource: null, highlight: null};
    }
    get text() {
        return isJapanese(this.props.locale) ? messages.ja : messages.en;
    }
    standard() {
        // The stage has no motion blocks.
        return standardGroups.filter(group => !(this.props.isStage && group === 'motion'));
    }
    /** Every group on offer, in the order the screen lists them. */
    offered() {
        return [...this.standard(), ...this.props.extensions.flatMap(extension =>
            extension.groups ? extension.groups.map(group => group.id) : [extension.id])];
    }
    available(groups: readonly string[]) {
        const offered = new Set<string>(this.offered());
        return groups.filter(group => offered.has(group));
    }
    toggle(group: string) {
        this.setState(({shown}) => {
            const next = new Set(shown);
            if (next.has(group)) next.delete(group);
            else next.add(group);
            return {shown: next};
        });
    }
    toggleSet(set: PaletteGroupSet) {
        const groups = this.available(set.groups);
        this.setState(({shown}) => {
            const next = new Set(shown);
            const all = groups.every(group => next.has(group));
            for (const group of groups) {
                if (all) next.delete(group);
                else next.add(group);
            }
            return {shown: next};
        });
    }
    addSet() {
        const name = this.state.setName.trim();
        if (!name) return;
        const taken = new Set([...this.props.sets, ...this.state.addedSets].map(set => set.id));
        let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'set';
        for (let index = 2; taken.has(id); index++) id = `${id.replace(/-\d+$/, '')}-${index}`;
        const groups = this.offered().filter(group => this.state.shown.has(group));
        this.setState(({addedSets}) => ({addedSets: [...addedSets, {id, name, groups}], naming: false, setName: ''}));
    }
    /**
     * Choose the groups another sprite shows, as far as this one is offered them. The screen stays open, so the
     * person sees the copy, adds or removes checks, and applies.
     */
    copy() {
        if (this.state.copySource === null || !this.props.copySources?.[this.state.copySource]) return;
        this.setState({shown: new Set(this.copyGroups())});
    }
    /** The groups of the chosen copy source this sprite can show, or none before one is chosen. */
    copyGroups() {
        const source = this.state.copySource === null ? undefined : this.props.copySources?.[this.state.copySource];
        return source ? this.available(source.groups) : [];
    }
    apply() {
        this.props.onApply({groups: this.offered().filter(group => this.state.shown.has(group)), addedSets: this.state.addedSets});
    }
    render() {
        const {locale, targetName, isStage, used, extensions, onCancel} = this.props;
        const {shown, naming, setName} = this.state;
        const text = this.text;
        const names = isJapanese(locale) ? standardNames.ja : standardNames.en;
        const sets = [...this.props.sets, ...this.state.addedSets];
        const hiddenInUse = [...used].filter(([group, count]) => count > 0 && !shown.has(group)).length;
        // Under the pointer or focus first; otherwise, while a copy source is chosen, the groups it would choose.
        const highlight = this.state.highlight ?? (this.state.copySource !== null ? new Set(this.copyGroups()) : null);
        const highlighted = (group: string) => highlight?.has(group) ? 'true' : undefined;
        // Pointing at or focusing a shortcut or the copy source marks the groups it would choose, as hovering them does.
        const highlighting = (groups: readonly string[]) => {
            const on = () => this.setState({highlight: new Set(groups)});
            const off = () => this.setState({highlight: null});
            return {onMouseEnter: on, onMouseLeave: off, onFocus: on, onBlur: off};
        };
        const copying = Boolean(this.props.newSprite && this.props.copySources?.length);
        const copyGroups = copying ? this.copyGroups() : [];
        const usedBadge = (group: string) => !shown.has(group) && (used.get(group) ?? 0) > 0 && (
            <span className="tw-palette-visibility-used">{text.used(used.get(group)!)}</span>
        );
        return (
            <div className="tw-palette-visibility">
                <header className="tw-palette-visibility-header">
                    <div>
                        <h2>{text.title}</h2>
                        <p>{isStage ? text.stage : this.props.newSprite ? text.newSprite(targetName) : text.sprite(targetName)}</p>
                    </div>
                    <button type="button" className="tw-palette-visibility-close" aria-label={text.close} title={text.close}
                        onClick={onCancel}>×</button>
                </header>
                <section aria-label={text.quick}>
                    <h3>{text.quick}</h3>
                    <div className="tw-palette-visibility-quick" data-columns={copying ? '2' : '1'}>
                        <div className="tw-palette-visibility-panel" aria-label={text.sets} role="group">
                            <h4>{text.sets}</h4>
                            <div className="tw-palette-visibility-sets">
                                {sets.map(set => {
                                    const groups = this.available(set.groups);
                                    const all = groups.length > 0 && groups.every(group => shown.has(group));
                                    return (
                                        <button key={set.id} type="button" aria-pressed={all} data-set={set.id}
                                            {...highlighting(groups)}
                                            onClick={() => this.toggleSet(set)}>{set.name}{all ? ' ✓' : ''}</button>
                                    );
                                })}
                                {naming ? (
                                    <span className="tw-palette-visibility-naming">
                                        <input type="text" aria-label={text.setName} placeholder={text.setName} value={setName}
                                            autoFocus
                                            onChange={event => this.setState({setName: event.currentTarget.value})}
                                            onKeyDown={event => {if (event.key === 'Enter') this.addSet();}} />
                                        <button type="button" onClick={() => this.addSet()}>{text.add}</button>
                                    </span>
                                ) : (
                                    <button type="button" className="tw-palette-visibility-add-set"
                                        onClick={() => this.setState({naming: true})}>＋{text.addSet}</button>
                                )}
                            </div>
                        </div>
                        {copying && (
                            <div className="tw-palette-visibility-panel" aria-label={text.copyFrom} role="group"
                                {...highlighting(copyGroups)}>
                                <h4>{text.copyFrom}</h4>
                                <div className="tw-palette-visibility-copy">
                                    <select aria-label={text.copyFrom} value={this.state.copySource ?? ''}
                                        onChange={event => {
                                            const value = event.currentTarget.value;
                                            this.setState({copySource: value === '' ? null : Number(value), highlight: null});
                                        }}>
                                        <option value="">{text.chooseSprite}</option>
                                        {this.props.copySources.map((source, index) => (
                                            <option key={index} value={index}>{source.name}</option>
                                        ))}
                                    </select>
                                    <button type="button" className="tw-palette-visibility-copy-button"
                                        disabled={this.state.copySource === null}
                                        onClick={() => this.copy()}>{text.copy}</button>
                                </div>
                            </div>
                        )}
                    </div>
                </section>
                <section aria-label={text.standard}>
                    <h3>{text.standard}</h3>
                    <div className="tw-palette-visibility-standard">
                        {this.standard().map(group => (
                            <label key={group} data-group={group} data-highlighted={highlighted(group)}>
                                <input type="checkbox" checked={shown.has(group)} onChange={() => this.toggle(group)} />
                                <span className="tw-palette-visibility-swatch" style={{color: standardColors[group]}}
                                    aria-hidden="true">●</span>
                                {names[group]}
                                {usedBadge(group)}
                            </label>
                        ))}
                    </div>
                </section>
                {extensions.length > 0 && (
                    <section aria-label={text.extensions}>
                        <h3>{text.extensions}</h3>
                        <div className="twextsec-review">
                            <ul className="twextsec-rows">
                                {extensions.map(extension => extension.groups ? (
                                    <ExtensionRow
                                        key={extension.id}
                                        metadata={extension.metadata}
                                        ids={[extension.id]}
                                        locale={locale}
                                        itemProps={{'data-extension': extension.id}}
                                    >
                                        <div className="tw-palette-visibility-extension-groups">
                                            {extension.groups.map(group => (
                                                <label key={group.id} data-group={group.id}
                                                    data-highlighted={highlighted(group.id)}>
                                                    <input type="checkbox" checked={shown.has(group.id)}
                                                        onChange={() => this.toggle(group.id)} />
                                                    <span className="tw-palette-visibility-swatch" aria-hidden="true"
                                                        style={{color: group.color}}>●</span>
                                                    {group.id === extension.id ? text.otherBlocks : group.name}
                                                    {usedBadge(group.id)}
                                                </label>
                                            ))}
                                        </div>
                                    </ExtensionRow>
                                ) : (
                                    <ExtensionRow
                                        key={extension.id}
                                        metadata={extension.metadata}
                                        ids={[extension.id]}
                                        locale={locale}
                                        itemProps={{'data-group': extension.id, 'data-highlighted': highlighted(extension.id)}}
                                        pick={{checked: shown.has(extension.id), onToggle: () => this.toggle(extension.id)}}
                                    >
                                        {usedBadge(extension.id)}
                                    </ExtensionRow>
                                ))}
                            </ul>
                        </div>
                    </section>
                )}
                <footer className="tw-palette-visibility-footer">
                    <span role="status">{hiddenInUse > 0 ? text.hiddenInUse(hiddenInUse) : ''}</span>
                    <span>
                        <button type="button" onClick={onCancel}>{text.cancel}</button>
                        <button type="button" className="tw-palette-visibility-apply" onClick={() => this.apply()}>
                            {text.confirm}
                        </button>
                    </span>
                </footer>
            </div>
        );
    }
}

/** Opens the screen as a modal `<dialog>` in `document`. Returns the function that closes it. */
export function openPaletteVisibilityDialog(document: Document, props: PaletteVisibilityDialogProps): () => void {
    const dialog = document.createElement('dialog');
    dialog.className = 'tw-palette-visibility-dialog';
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
        props.onCancel();
        close();
    });
    ReactDOM.render(React.createElement(PaletteVisibilityDialog, {
        ...props,
        onApply: choice => {
            close();
            props.onApply(choice);
        },
        onCancel: () => {
            close();
            props.onCancel();
        }
    }), dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return close;
}

/** Asks whether to hide the standard groups an enabled extension offers to replace. */
export function openPaletteReplacementDialog(document: Document, {locale, targetName, isStage, extensions, groups, onHide, onClose}: {
    locale?: string;
    targetName: string;
    isStage?: boolean;
    extensions: readonly string[];
    groups: readonly ReplaceablePaletteGroup[];
    onHide(): void;
    onClose(): void;
}): () => void {
    const ja = isJapanese(locale);
    const language = ja ? 'ja' : 'en';
    const names = standardNames[language];
    const targetLabel = isStage ? messages[language].stage : targetName;
    const groupNames = groups.map(group => names[group]).join(ja ? '・' : ' and ');
    const extensionNames = extensions.join(ja ? '、' : ', ');
    const title = ja ? `標準の${groupNames}を隠しますか？` : `Hide standard blocks for ${groupNames}?`;
    const detail = ja ? `${extensionNames} が代替を提供します。設定は「${targetLabel}」のパレットに適用されます。` :
        `This applies to the palette for “${targetLabel}”. Alternative: ${extensionNames}.`;
    const dialog = document.createElement('dialog');
    dialog.className = 'tw-palette-visibility-dialog tw-palette-replacement-dialog';
    dialog.setAttribute('aria-label', title);
    document.body.append(dialog);
    const close = () => {
        if (!dialog.isConnected) return;
        ReactDOM.unmountComponentAtNode(dialog);
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        dialog.remove();
        onClose();
    };
    dialog.addEventListener('cancel', event => {
        event.preventDefault();
        close();
    });
    ReactDOM.render(<div className="tw-palette-visibility">
        <header className="tw-palette-visibility-header"><h2>{title}</h2></header>
        <section>{detail}</section>
        <footer className="tw-palette-visibility-footer">
            <button type="button" autoFocus onClick={close}>{ja ? '表示したまま' : 'Keep visible'}</button>
            <button type="button" className="tw-palette-visibility-apply" onClick={() => {
                close();
                onHide();
            }}>{ja ? '隠す' : 'Hide'}</button>
        </footer>
    </div>, dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return close;
}
