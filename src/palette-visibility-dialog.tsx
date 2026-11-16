import React from 'react';
import ReactDOM from 'react-dom';
import {ExtensionRow} from '@kubohiroya/turbowarp-extension-security-dialog/react';
import type {ExtensionMetadata} from '@kubohiroya/turbowarp-extension-security-dialog';
import {standardGroups, type PaletteGroupSet} from './palette-category-visibility.ts';

export interface PaletteExtension {
    /** The extension ID, which is also its palette category ID. */
    id: string;
    /** What the host knows about the extension; at least its name. */
    metadata: ExtensionMetadata;
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
     * one of them and apply it at once.
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
        copyFrom: 'Copy from an existing sprite', copyApply: 'Copy and apply',
        sets: 'Applicable sets', addSet: 'Add applicable set', setName: 'Set name', add: 'Add',
        standard: 'Standard block groups', extensions: 'Extension block groups', used: (count: number) => `In use ${count}`,
        hiddenInUse: (count: number) => `Hidden and in use: ${count}`, cancel: 'Cancel', apply: 'Apply', close: 'Close'
    },
    ja: {
        title: 'パレット内のブロックグループの表示・非表示の設定', sprite: (name: string) => `スプライト「${name}」`, stage: '背景',
        newSprite: (name: string) => `新しいスプライト「${name}」`,
        copyFrom: '作成済みのスプライトからコピー', copyApply: 'コピーして適用',
        sets: '適用可能なセット', addSet: '適用可能なセットを追加', setName: 'セットの名前', add: '追加',
        standard: '標準のブロックグループ', extensions: '機能拡張のブロックグループ', used: (count: number) => `使用中 ${count}`,
        hiddenInUse: (count: number) => `非表示中・使用中 ${count} 件`, cancel: 'キャンセル', apply: '適用', close: '閉じる'
    }
};
const isJapanese = (locale?: string) => /^ja(?:-|$)/i.test(locale ?? '');

interface DialogState {
    shown: Set<string>;
    addedSets: PaletteGroupSet[];
    naming: boolean;
    setName: string;
    copySource: number;
}

/**
 * The screen that chooses which block groups the palette shows for one sprite or the stage: sets that
 * switch several groups at once, the standard groups, and one row per extension drawn the same way as the
 * extension review.
 */
export class PaletteVisibilityDialog extends React.PureComponent<PaletteVisibilityDialogProps, DialogState> {
    constructor(props: PaletteVisibilityDialogProps) {
        super(props);
        this.state = {shown: new Set(props.initial), addedSets: [], naming: false, setName: '', copySource: 0};
    }
    get text() {
        return isJapanese(this.props.locale) ? messages.ja : messages.en;
    }
    standard() {
        // The stage has no motion blocks.
        return standardGroups.filter(group => !(this.props.isStage && group === 'motion'));
    }
    available(groups: readonly string[]) {
        const offered = new Set<string>([...this.standard(), ...this.props.extensions.map(extension => extension.id)]);
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
        const groups = [...this.standard(), ...this.props.extensions.map(extension => extension.id)]
            .filter(group => this.state.shown.has(group));
        this.setState(({addedSets}) => ({addedSets: [...addedSets, {id, name, groups}], naming: false, setName: ''}));
    }
    /** Apply the groups another sprite shows, as far as this one is offered them. */
    copyAndApply() {
        const source = this.props.copySources?.[this.state.copySource];
        if (!source) return;
        const order = [...this.standard(), ...this.props.extensions.map(extension => extension.id)];
        const groups = new Set(source.groups);
        this.props.onApply({groups: order.filter(group => groups.has(group)), addedSets: this.state.addedSets});
    }
    apply() {
        const order = [...this.standard(), ...this.props.extensions.map(extension => extension.id)];
        this.props.onApply({groups: order.filter(group => this.state.shown.has(group)), addedSets: this.state.addedSets});
    }
    render() {
        const {locale, targetName, isStage, used, extensions, onCancel} = this.props;
        const {shown, naming, setName} = this.state;
        const text = this.text;
        const names = isJapanese(locale) ? standardNames.ja : standardNames.en;
        const sets = [...this.props.sets, ...this.state.addedSets];
        const hiddenInUse = [...used].filter(([group, count]) => count > 0 && !shown.has(group)).length;
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
                {this.props.newSprite && (this.props.copySources?.length ?? 0) > 0 && (
                    <section aria-label={text.copyFrom}>
                        <h3>{text.copyFrom}</h3>
                        <div className="tw-palette-visibility-copy">
                            <select aria-label={text.copyFrom} value={this.state.copySource}
                                onChange={event => this.setState({copySource: Number(event.currentTarget.value)})}>
                                {this.props.copySources.map((source, index) => (
                                    <option key={index} value={index}>{source.name}</option>
                                ))}
                            </select>
                            <button type="button" className="tw-palette-visibility-copy-apply"
                                onClick={() => this.copyAndApply()}>{text.copyApply}</button>
                        </div>
                    </section>
                )}
                <section aria-label={text.sets}>
                    <h3>{text.sets}</h3>
                    <div className="tw-palette-visibility-sets">
                        {sets.map(set => {
                            const groups = this.available(set.groups);
                            const all = groups.length > 0 && groups.every(group => shown.has(group));
                            return (
                                <button key={set.id} type="button" aria-pressed={all} data-set={set.id}
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
                </section>
                <section aria-label={text.standard}>
                    <h3>{text.standard}</h3>
                    <div className="tw-palette-visibility-standard">
                        {this.standard().map(group => (
                            <label key={group} data-group={group}>
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
                                {extensions.map(extension => (
                                    <ExtensionRow
                                        key={extension.id}
                                        metadata={extension.metadata}
                                        ids={[extension.id]}
                                        locale={locale}
                                        itemProps={{'data-group': extension.id}}
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
                            {text.apply}
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
