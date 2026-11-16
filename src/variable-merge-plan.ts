/**
 * Merging a variable or list into another one, and moving one between "this sprite only" and
 * "for all sprites".
 *
 * Scratch refuses to rename a variable to a name that is already taken and has no way to change a
 * variable's scope. Both are plans over the VM's data: every field that holds the variable's id,
 * every "[name] of (sprite)" block that reads it by name, its monitor and the variable itself.
 * A plan is checked before anything changes, applied as a list of reversible steps, and undone by
 * running those steps backwards. Nothing here touches Blockly; the editor reloads the workspace
 * from the VM afterwards.
 */

export type VariableType = '' | 'list';

export interface VariableLike {
    id: string;
    name: string;
    type: string;
    value: unknown;
    isCloud?: boolean;
}

export interface FieldLike {
    name?: string;
    id?: string | null;
    value?: unknown;
    variableType?: string;
}

export interface BlockLike {
    id: string;
    opcode: string;
    fields: Record<string, FieldLike>;
    inputs: Record<string, {block?: string | null; shadow?: string | null}>;
}

export interface BlocksLike {
    _blocks: Record<string, BlockLike>;
    getBlock?(id: string): BlockLike | undefined;
    resetCache?(): void;
    createBlock?(block: object): void;
    deleteBlock?(id: string): void;
    changeBlock?(args: object, runtime?: object): void;
}

export interface TargetLike {
    id: string;
    isStage: boolean;
    isOriginal?: boolean;
    sprite?: object;
    variables: Record<string, VariableLike>;
    blocks: BlocksLike;
    getName(): string;
}

export interface RuntimeLike {
    targets: TargetLike[];
    getTargetForStage(): TargetLike;
    monitorBlocks?: BlocksLike;
    requestRemoveMonitor?(id: string): void;
    emitProjectChanged?(): void;
}

export interface VmLike {
    runtime: RuntimeLike;
    editingTarget: TargetLike | null;
    emitWorkspaceUpdate?(): void;
    emitTargetsUpdate?(triggerProjectChange?: boolean): void;
}

/** Why a merge or a scope change cannot be made. Names are display names of targets. */
export type Refusal =
    | {code: 'same'}
    | {code: 'missing'}
    | {code: 'type'}
    | {code: 'cloud'}
    | {code: 'stage'}
    | {code: 'not-visible'; owner: string; targets: string[]}
    | {code: 'used-elsewhere'; sprite: string; targets: string[]}
    | {code: 'name-taken'; targets: string[]};

/** Clones that kept separate values will share one, or the other way round. */
export type Warning = 'clones-share' | 'clones-split' | 'dynamic-sensing';

export interface VariableSummary {
    id: string;
    name: string;
    type: VariableType;
    value: unknown;
    /** Display name of the owner, or null for a global variable. */
    owner: string | null;
}

export interface Plan {
    kind: 'merge' | 'global' | 'local';
    source: VariableSummary;
    /** The variable that remains after a merge; for a move, the moved variable itself. */
    destination: VariableSummary;
    /** Fields holding the source's id, counted by the target that owns them. */
    references: {target: string; count: number}[];
    /** "[name] of (sprite)" blocks that are rewritten. */
    sensingReferences: number;
    warnings: Warning[];
    /** The sprite a "this sprite only" move goes to, or the sprite a local source lives in. */
    sprite: string | null;
}

export type PlanResult = {ok: true; plan: Plan} | {ok: false; refusal: Refusal};

type Step =
    | {type: 'field'; field: FieldLike; id: string | null | undefined; value: unknown}
    | {type: 'value'; field: FieldLike; value: unknown}
    | {type: 'remove'; owner: TargetLike; variable: VariableLike}
    | {type: 'add'; owner: TargetLike; variable: VariableLike}
    | {type: 'move'; from: TargetLike; to: TargetLike; variable: VariableLike}
    | {type: 'monitor'; variable: VariableLike; visible: boolean};

export interface UndoRecord {
    plan: Plan;
    steps: Step[];
}

const STAGE_KEY = '_stage_';

const originals = (vm: VmLike) => vm.runtime.targets.filter(target => target.isOriginal !== false);

/**
 * The target whose variables hold an id.
 * @param {VmLike} vm The VM.
 * @param {string} id The variable id.
 * @returns {{variable: VariableLike, owner: TargetLike} | null} The variable and its owner.
 */
export const findVariable = (vm: VmLike, id: string) => {
    const stage = vm.runtime.getTargetForStage();
    if (stage && Object.hasOwn(stage.variables, id)) return {variable: stage.variables[id], owner: stage};
    for (const target of originals(vm)) {
        if (Object.hasOwn(target.variables, id)) return {variable: target.variables[id], owner: target};
    }
    return null;
};

const ownerKey = (owner: TargetLike) => owner.isStage ? STAGE_KEY : owner.getName();

const summary = (variable: VariableLike, owner: TargetLike): VariableSummary => ({
    id: variable.id,
    name: variable.name,
    type: variable.type === 'list' ? 'list' : '',
    value: variable.value,
    owner: owner.isStage ? null : owner.getName()
});

/** Each distinct blocks container once, with the original target that owns it. */
const blockContainers = (vm: VmLike) => {
    const seen = new Set<BlocksLike>();
    const containers: {target: TargetLike; blocks: BlocksLike}[] = [];
    for (const target of originals(vm)) {
        if (!target.blocks || seen.has(target.blocks)) continue;
        seen.add(target.blocks);
        containers.push({target, blocks: target.blocks});
    }
    return containers;
};

/** Every field, anywhere in the project's code, that holds a variable's id. */
const fieldReferences = (vm: VmLike, id: string) => {
    const found: {target: TargetLike; field: FieldLike}[] = [];
    for (const {target, blocks} of blockContainers(vm)) {
        for (const block of Object.values(blocks._blocks)) {
            for (const field of Object.values(block.fields ?? {})) {
                if (field && field.id === id) found.push({target, field});
            }
        }
    }
    return found;
};

/**
 * "[name] of (owner)" blocks that read a scalar variable by name. A block whose sprite menu has a
 * reporter dropped in is dynamic: which sprite it reads is known only while the project runs.
 */
const sensingReferences = (vm: VmLike, variable: VariableLike, owner: TargetLike) => {
    const fixed: {target: TargetLike; property: FieldLike; object: FieldLike}[] = [];
    let dynamic = 0;
    if (variable.type !== '') return {fixed, dynamic};
    const key = ownerKey(owner);
    for (const {target, blocks} of blockContainers(vm)) {
        for (const block of Object.values(blocks._blocks)) {
            if (block.opcode !== 'sensing_of' || block.fields?.PROPERTY?.value !== variable.name) continue;
            const input = block.inputs?.OBJECT;
            if (!input) continue;
            if (input.block !== input.shadow) {
                dynamic++;
                continue;
            }
            const menu = input.block ? blocks._blocks[input.block] : undefined;
            const object = menu?.fields?.OBJECT;
            if (object && object.value === key) fixed.push({target, property: block.fields.PROPERTY, object});
        }
    }
    return {fixed, dynamic};
};

const countByTarget = (references: {target: TargetLike}[]) => {
    const counts = new Map<TargetLike, number>();
    for (const {target} of references) counts.set(target, (counts.get(target) ?? 0) + 1);
    return [...counts].map(([target, count]) => ({target: target.getName(), count}));
};

/** Whether a sprite's values are split across clones, now or once its code runs. */
const usesClones = (vm: VmLike, sprite: TargetLike) => {
    if (vm.runtime.targets.some(target => target.isOriginal === false && target.sprite && target.sprite === sprite.sprite)) {
        return true;
    }
    for (const {target, blocks} of blockContainers(vm)) {
        for (const block of Object.values(blocks._blocks)) {
            if (block.opcode !== 'control_create_clone_of_menu') continue;
            const option = block.fields?.CLONE_OPTION?.value;
            if (option === sprite.getName() || (option === '_myself_' && target === sprite)) return true;
        }
    }
    return false;
};

const unique = (names: string[]) => [...new Set(names)];

/**
 * Check merging one variable or list into another.
 * @param {VmLike} vm The VM.
 * @param {string} sourceId The variable that goes away.
 * @param {string} destinationId The variable that remains.
 * @returns {PlanResult} The plan, or why it cannot be made.
 */
export const planMerge = (vm: VmLike, sourceId: string, destinationId: string): PlanResult => {
    if (sourceId === destinationId) return {ok: false, refusal: {code: 'same'}};
    const source = findVariable(vm, sourceId);
    const destination = findVariable(vm, destinationId);
    if (!source || !destination) return {ok: false, refusal: {code: 'missing'}};
    const sourceType = source.variable.type;
    if ((sourceType !== '' && sourceType !== 'list') || sourceType !== destination.variable.type) {
        return {ok: false, refusal: {code: 'type'}};
    }
    if (source.variable.isCloud || destination.variable.isCloud) return {ok: false, refusal: {code: 'cloud'}};

    const fields = fieldReferences(vm, sourceId);
    if (!destination.owner.isStage) {
        const outside = fields.filter(({target}) => target !== destination.owner).map(({target}) => target.getName());
        if (outside.length) {
            return {ok: false, refusal: {code: 'not-visible', owner: destination.owner.getName(), targets: unique(outside)}};
        }
    }
    const sensing = sensingReferences(vm, source.variable, source.owner);
    const warnings: Warning[] = [];
    if (sensing.dynamic) warnings.push('dynamic-sensing');
    // A local value per clone becomes one shared value, or the other way round.
    const localSide = !source.owner.isStage ? source.owner : !destination.owner.isStage ? destination.owner : null;
    if (localSide && source.owner.isStage !== destination.owner.isStage && usesClones(vm, localSide)) {
        warnings.push(destination.owner.isStage ? 'clones-share' : 'clones-split');
    }
    return {
        ok: true,
        plan: {
            kind: 'merge',
            source: summary(source.variable, source.owner),
            destination: summary(destination.variable, destination.owner),
            references: countByTarget(fields),
            sensingReferences: sensing.fixed.length,
            warnings,
            sprite: source.owner.isStage ? null : source.owner.getName()
        }
    };
};

/**
 * Check moving a variable or list to "for all sprites" or to "this sprite only".
 * Moving a sprite's variable to all sprites when the stage already has one of the same name is a
 * merge into that one.
 * @param {VmLike} vm The VM.
 * @param {string} id The variable.
 * @param {'global' | 'local'} scope Where it goes.
 * @param {TargetLike} sprite The sprite a "this sprite only" variable belongs to; defaults to the editing target.
 * @returns {PlanResult} The plan, or why it cannot be made.
 */
export const planScopeChange = (vm: VmLike, id: string, scope: 'global' | 'local',
    sprite: TargetLike | null = vm.editingTarget): PlanResult => {
    const found = findVariable(vm, id);
    if (!found) return {ok: false, refusal: {code: 'missing'}};
    const {variable, owner} = found;
    if (variable.type !== '' && variable.type !== 'list') return {ok: false, refusal: {code: 'type'}};
    if (variable.isCloud) return {ok: false, refusal: {code: 'cloud'}};
    const stage = vm.runtime.getTargetForStage();
    const sameName = (target: TargetLike) => Object.values(target.variables)
        .find(other => other.id !== id && other.name === variable.name && other.type === variable.type);
    const fields = fieldReferences(vm, id);
    const sensing = sensingReferences(vm, variable, owner);
    const warnings: Warning[] = [];
    if (sensing.dynamic) warnings.push('dynamic-sensing');

    if (scope === 'global') {
        if (owner.isStage) return {ok: false, refusal: {code: 'same'}};
        const existing = sameName(stage);
        if (existing) return planMerge(vm, id, existing.id);
        const taken = originals(vm).filter(target => !target.isStage && target !== owner && sameName(target));
        if (taken.length) return {ok: false, refusal: {code: 'name-taken', targets: taken.map(target => target.getName())}};
        if (usesClones(vm, owner)) warnings.push('clones-share');
        return {
            ok: true,
            plan: {
                kind: 'global',
                source: summary(variable, owner),
                destination: summary(variable, owner),
                references: countByTarget(fields),
                sensingReferences: sensing.fixed.length,
                warnings,
                sprite: owner.getName()
            }
        };
    }

    if (!sprite || sprite.isStage) return {ok: false, refusal: {code: 'stage'}};
    if (!owner.isStage) return {ok: false, refusal: {code: 'same'}};
    if (sameName(sprite)) return {ok: false, refusal: {code: 'name-taken', targets: [sprite.getName()]}};
    // "[name] of (Stage)" reads it by name; a sprite's own menu cannot name the sprite itself, so
    // any such block, in this sprite or elsewhere, would stop finding it.
    const outside = [
        ...fields.filter(({target}) => target !== sprite),
        ...sensing.fixed
    ].map(({target}) => target.getName());
    if (outside.length) {
        return {ok: false, refusal: {code: 'used-elsewhere', sprite: sprite.getName(), targets: unique(outside)}};
    }
    if (usesClones(vm, sprite)) warnings.push('clones-split');
    return {
        ok: true,
        plan: {
            kind: 'local',
            source: summary(variable, owner),
            destination: summary(variable, owner),
            references: countByTarget(fields),
            sensingReferences: 0,
            warnings,
            sprite: sprite.getName()
        }
    };
};

/** Show or hide a variable's monitor through the same path as the palette's checkbox. */
const setMonitor = (vm: VmLike, variable: VariableLike, visible: boolean) => {
    const monitors = vm.runtime.monitorBlocks;
    if (!monitors) return;
    if (!visible) {
        if (monitors.getBlock?.(variable.id)) {
            vm.runtime.requestRemoveMonitor?.(variable.id);
            monitors.deleteBlock?.(variable.id);
        }
        return;
    }
    if (!monitors.getBlock?.(variable.id)) {
        const list = variable.type === 'list';
        const field = list ? 'LIST' : 'VARIABLE';
        monitors.createBlock?.({
            id: variable.id,
            opcode: list ? 'data_listcontents' : 'data_variable',
            inputs: {},
            fields: {[field]: {name: field, id: variable.id, value: variable.name, variableType: variable.type}},
            next: null,
            topLevel: true,
            parent: null,
            shadow: false,
            x: 0,
            y: 0
        });
    }
    monitors.changeBlock?.({id: variable.id, element: 'checkbox', value: true}, vm.runtime);
};

const monitorVisible = (vm: VmLike, id: string) => Boolean(
    (vm.runtime.monitorBlocks?.getBlock?.(id) as {isMonitored?: boolean} | undefined)?.isMonitored
);

const run = (vm: VmLike, step: Step) => {
    switch (step.type) {
    case 'field':
    case 'value':
        break;
    case 'remove':
        delete step.owner.variables[step.variable.id];
        break;
    case 'add':
        step.owner.variables[step.variable.id] = step.variable;
        break;
    case 'move':
        delete step.from.variables[step.variable.id];
        step.to.variables[step.variable.id] = step.variable;
        break;
    case 'monitor':
        setMonitor(vm, step.variable, step.visible);
        break;
    }
};

/**
 * Apply a plan made from the VM's current data.
 * @param {VmLike} vm The VM.
 * @param {Plan} plan A plan from planMerge or planScopeChange.
 * @returns {UndoRecord} What undoes it.
 */
export const applyPlan = (vm: VmLike, plan: Plan): UndoRecord => {
    const steps: Step[] = [];
    const source = findVariable(vm, plan.source.id);
    const destination = findVariable(vm, plan.destination.id);
    if (!source || !destination) throw new Error('The variable is gone.');
    const setField = (field: FieldLike, id: string, value: unknown) => {
        steps.push({type: 'field', field, id: field.id, value: field.value});
        field.id = id;
        field.value = value;
    };
    const setValue = (field: FieldLike, value: unknown) => {
        steps.push({type: 'value', field, value: field.value});
        field.value = value;
    };
    const doStep = (step: Step, inverse: Step) => {
        run(vm, step);
        steps.push(inverse);
    };

    const sensing = sensingReferences(vm, source.variable, source.owner).fixed;
    if (plan.kind === 'merge') {
        const {variable, owner} = destination;
        for (const {field} of fieldReferences(vm, source.variable.id)) setField(field, variable.id, variable.name);
        for (const {property, object} of sensing) {
            setValue(property, variable.name);
            setValue(object, ownerKey(owner));
        }
        const showDestination = monitorVisible(vm, source.variable.id) && !monitorVisible(vm, variable.id);
        if (vm.runtime.monitorBlocks?.getBlock?.(source.variable.id)) {
            doStep({type: 'monitor', variable: source.variable, visible: false},
                {type: 'monitor', variable: source.variable, visible: monitorVisible(vm, source.variable.id)});
        }
        doStep({type: 'remove', owner: source.owner, variable: source.variable},
            {type: 'add', owner: source.owner, variable: source.variable});
        if (showDestination) {
            doStep({type: 'monitor', variable, visible: true}, {type: 'monitor', variable, visible: false});
        }
    } else {
        const stage = vm.runtime.getTargetForStage();
        const to = plan.kind === 'global' ? stage :
            originals(vm).find(target => !target.isStage && target.getName() === plan.sprite);
        if (!to) throw new Error('The sprite is gone.');
        for (const {object} of sensing) setValue(object, ownerKey(to));
        // A monitor remembers whether it belongs to a sprite, so it is made again for the new owner.
        const visible = monitorVisible(vm, source.variable.id);
        if (vm.runtime.monitorBlocks?.getBlock?.(source.variable.id)) {
            doStep({type: 'monitor', variable: source.variable, visible: false},
                {type: 'monitor', variable: source.variable, visible});
        }
        doStep({type: 'move', from: source.owner, to, variable: source.variable},
            {type: 'move', from: to, to: source.owner, variable: source.variable});
        if (visible) {
            doStep({type: 'monitor', variable: source.variable, visible: true},
                {type: 'monitor', variable: source.variable, visible: false});
        }
    }
    resetCaches(vm);
    return {plan, steps};
};

/**
 * Undo an applied plan by running its steps backwards.
 * @param {VmLike} vm The VM.
 * @param {UndoRecord} record What applyPlan returned.
 */
export const undoPlan = (vm: VmLike, record: UndoRecord) => {
    for (const step of [...record.steps].reverse()) {
        if (step.type === 'field') {
            step.field.id = step.id;
            step.field.value = step.value;
        } else if (step.type === 'value') {
            step.field.value = step.value;
        } else {
            run(vm, step);
        }
    }
    resetCaches(vm);
};

const resetCaches = (vm: VmLike) => {
    for (const {blocks} of blockContainers(vm)) blocks.resetCache?.();
    vm.runtime.emitProjectChanged?.();
};

/**
 * Show the VM's new state in the editor: the workspace, its palette and the target list.
 * @param {VmLike} vm The VM.
 */
export const refreshEditor = (vm: VmLike) => {
    vm.emitWorkspaceUpdate?.();
    vm.emitTargetsUpdate?.(false);
};
