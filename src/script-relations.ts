/** The serialized program is the source of relations, even when a view omits a folded body. */
export interface RelationBlock {
    id: string;
    opcode: string;
    parent?: string | null;
    next?: string | null;
    inputs?: Record<string, {block?: string | null; shadow?: string | null}>;
    fields?: Record<string, {value?: unknown; id?: string}>;
    mutation?: Record<string, unknown>;
    topLevel?: boolean;
    shadow?: boolean;
    x?: number;
    y?: number;
}

export interface RelationTarget {
    id: string;
    isOriginal?: boolean;
    isStage?: boolean;
    getName?(): string;
    blocks: {_blocks: Record<string, RelationBlock>};
}

export interface ScriptEndpoint {
    targetId: string;
    blockId: string;
    scriptId: string;
}

export interface ScriptRelation {
    kind: 'function' | 'message';
    source: ScriptEndpoint;
    destination?: ScriptEndpoint;
    label: string;
    wait: boolean;
    unresolved?: 'dynamic' | 'missing' | 'ambiguous';
}

const namedPrefix = 'kubohiroyanamedfunctions_';

type Program = {target: RelationTarget; blocks: Record<string, RelationBlock>; endpoint(id: string): ScriptEndpoint | undefined};
type Definition = {endpoint: ScriptEndpoint; scope: 'global' | 'sprite'};

function program(target: RelationTarget): Program {
    const blocks = target.blocks._blocks;
    const roots = new Map<string, string | undefined>();
    function endpoint(id: string): ScriptEndpoint | undefined {
        const path = new Set<string>();
        let current = id;
        let root: string | undefined;
        while (true) {
            if (roots.has(current)) {
                root = roots.get(current);
                break;
            }
            if (path.has(current) || !blocks[current]) break;
            path.add(current);
            const parent = blocks[current].parent;
            if (!parent) {
                root = current;
                break;
            }
            current = parent;
        }
        for (const member of path) roots.set(member, root);
        return root ? {targetId: target.id, blockId: id, scriptId: root} : undefined;
    }
    return {target, blocks, endpoint};
}

/** Read the active literal only; an obscured menu/text shadow is never a possible destination. */
function inputLiteral(block: RelationBlock, blocks: Program['blocks'], name: string): string | undefined {
    const input = block.inputs?.[name];
    const value = input?.block ? blocks[input.block] : undefined;
    if (!value) return undefined;
    const field = value.opcode === 'text' ? value.fields?.TEXT :
        value.opcode === 'event_broadcast_menu' ? value.fields?.BROADCAST_OPTION : undefined;
    return field?.value === undefined || field.value === null ? undefined : String(field.value);
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V) {
    const entries = map.get(key);
    if (entries) entries.push(value);
    else map.set(key, [value]);
}

/**
 * Extract possible static calls without executing the project or modifying its blocks.
 * Broadcasts fan out; conflicting function definitions and computed names stay unresolved.
 */
export function readScriptRelations(targets: readonly RelationTarget[]): ScriptRelation[] {
    const seenTargets = new Set<string>();
    const programs = targets.filter(target => {
        if (target.isOriginal === false || seenTargets.has(target.id)) return false;
        seenTargets.add(target.id);
        return true;
    }).map(program);
    const procedures = new Map<string, Map<string, ScriptEndpoint[]>>();
    const functions = new Map<string, Definition[]>();
    const receivers = new Map<string, ScriptEndpoint[]>();

    for (const {target, blocks, endpoint} of programs) {
        const own = new Map<string, ScriptEndpoint[]>();
        procedures.set(target.id, own);
        for (const block of Object.values(blocks)) {
            if (block.parent || block.topLevel === false || block.shadow) continue;
            const destination = endpoint(block.id);
            if (!destination) continue;
            if (block.opcode === 'procedures_definition') {
                const prototype = blocks[block.inputs?.custom_block?.block ?? ''];
                const code = prototype?.opcode === 'procedures_prototype' ? prototype.mutation?.proccode : undefined;
                if (typeof code === 'string') append(own, code, destination);
            } else if (block.opcode === `${namedPrefix}defineFunction`) {
                // A named definition's NAME is required to be literal, including its shadow connection.
                const input = block.inputs?.NAME;
                if (input?.block && input.block !== input.shadow) continue;
                const name = inputLiteral(block, blocks, 'NAME')?.trim();
                const scope = block.fields?.SCOPE?.value;
                if (name && (scope === undefined || scope === null || scope === 'global' || scope === 'sprite')) {
                    append(functions, name, {endpoint: destination, scope: scope === 'sprite' ? 'sprite' : 'global'});
                }
            } else if (block.opcode === 'event_whenbroadcastreceived') {
                const name = block.fields?.BROADCAST_OPTION?.value;
                if (name !== undefined && name !== null) append(receivers, String(name).toUpperCase(), destination);
            }
        }
    }

    const relations: ScriptRelation[] = [];
    for (const {target, blocks, endpoint} of programs) {
        for (const block of Object.values(blocks)) {
            let kind: ScriptRelation['kind'];
            let name: string | undefined;
            let wait = true;
            let destinations: ScriptEndpoint[] = [];
            let hasInput = true;
            if (block.opcode === 'procedures_call') {
                kind = 'function';
                name = typeof block.mutation?.proccode === 'string' ? block.mutation.proccode : undefined;
                destinations = procedures.get(target.id)?.get(name) ?? [];
                hasInput = name !== undefined;
            } else if (block.opcode === 'event_broadcast' || block.opcode === 'event_broadcastandwait') {
                kind = 'message';
                wait = block.opcode === 'event_broadcastandwait';
                name = inputLiteral(block, blocks, 'BROADCAST_INPUT');
                destinations = name === undefined ? [] : receivers.get(name.toUpperCase()) ?? [];
                hasInput = Boolean(block.inputs?.BROADCAST_INPUT?.block);
            } else if (block.opcode === `${namedPrefix}callFunction` || block.opcode === `${namedPrefix}startFunction` ||
                block.opcode === `${namedPrefix}callFunctionFromMenu`) {
                kind = 'function';
                wait = block.opcode !== `${namedPrefix}startFunction`;
                if (block.opcode === `${namedPrefix}callFunctionFromMenu`) {
                    const field = block.fields?.FUNCTION?.value;
                    name = field === undefined || field === null ? undefined : String(field);
                    hasInput = name !== undefined;
                } else {
                    name = inputLiteral(block, blocks, 'NAME');
                    hasInput = Boolean(block.inputs?.NAME?.block);
                }
                name = name?.trim();
                destinations = (functions.get(name) ?? []).filter(definition => definition.scope === 'global' ||
                    definition.endpoint.targetId === target.id).map(definition => definition.endpoint);
            } else continue;
            const source = endpoint(block.id);
            if (!source || block.shadow) continue;
            const relation = {kind, source, label: name ?? '', wait};
            if (name === undefined) {
                relations.push({...relation, unresolved: hasInput ? 'dynamic' : 'missing'});
            } else if (!destinations.length) {
                relations.push({...relation, unresolved: 'missing'});
            } else if (kind === 'function' && destinations.length > 1) {
                relations.push({...relation, unresolved: 'ambiguous'});
            } else {
                for (const destination of destinations) relations.push({...relation, destination});
            }
        }
    }
    return relations;
}
