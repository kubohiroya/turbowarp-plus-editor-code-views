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
    /** Scratch VM targets carry their runtime; its loaded extension info supplies block declarations. */
    runtime?: RelationRuntime;
}

/**
 * One extension block's relation declaration, read from the block entry of the extension's `getInfo()`
 * as `scriptRelations`. Channels are names shared by both sides rather than opcodes, so a declaration
 * survives bundling and may link blocks of different extensions.
 */
export interface ScriptRelationBlockDeclaration {
    /** This block is a destination for references in `channel` whose `argument` value equals its own. */
    targets?: readonly {channel: string; argument: string}[];
    /** This block refers, through `argument`, to the blocks declared as targets of `channel`. */
    references?: readonly ScriptRelationReferenceDeclaration[];
}

export interface ScriptRelationReferenceDeclaration {
    channel: string;
    argument: string;
    /**
     * Read several references from a JSON object in the argument instead of its whole text. The first
     * path that names an object is used (`[]` is the root), and each of its string property values is
     * one reference, labelled `key → value`. Other values are ignored.
     */
    json?: {objectPaths: readonly (readonly string[])[]};
}

interface RelationBlockInfo {
    info?: {opcode?: string; scriptRelations?: unknown; arguments?: Record<string, {menu?: unknown}>};
    json?: {type?: unknown; [key: string]: unknown} | null;
}

interface RelationCategoryInfo {
    blocks?: readonly RelationBlockInfo[];
    menus?: readonly {json?: {type?: unknown; [key: string]: unknown} | null}[];
}

export interface RelationRuntime {
    _blockInfo?: readonly RelationCategoryInfo[];
}

export interface ScriptEndpoint {
    targetId: string;
    blockId: string;
    scriptId: string;
}

export type ScriptRelationKind = 'function' | 'message' | 'reference';

export interface ScriptRelation {
    kind: ScriptRelationKind;
    source: ScriptEndpoint;
    destination?: ScriptEndpoint;
    label: string;
    wait: boolean;
    unresolved?: 'dynamic' | 'missing' | 'ambiguous';
}

const namedPrefix = 'kubohiroyanamedfunctions_';

export type ScriptRelationProgram = {
    target: RelationTarget;
    blocks: Record<string, RelationBlock>;
    /** The endpoint of any block, with the top block of its script; undefined for a detached or cyclic block. */
    endpoint(id: string): ScriptEndpoint | undefined;
};
type Program = ScriptRelationProgram;

/**
 * An editor-side source of additional relations. It reads the same serialized program as the built-in
 * relations and must not execute or modify it.
 */
export interface ScriptRelationResolver {
    resolve(programs: readonly ScriptRelationProgram[]): readonly ScriptRelation[];
}
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

type Declared = {channel: string; argument: string; json?: {objectPaths: string[][]}};
type DeclarationIndex = {
    targets: Map<string, Declared[]>;
    references: Map<string, Declared[]>;
    label(opcode: string, argument: string, value: string): string;
};

const relationChannel = /^[A-Za-z0-9_.:-]{1,128}$/;
const relationArgument = /^[A-Za-z0-9_]{1,64}$/;

function declarations(value: unknown, key: 'targets' | 'references'): Declared[] {
    const list = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
    if (!Array.isArray(list)) return [];
    return list.filter((entry): entry is Declared => Boolean(entry) && typeof entry === 'object' &&
        typeof entry.channel === 'string' && relationChannel.test(entry.channel) &&
        typeof entry.argument === 'string' && relationArgument.test(entry.argument))
        .map(({channel, argument, json}) => {
            const paths = key === 'references' && json && typeof json === 'object' &&
                Array.isArray((json as {objectPaths?: unknown}).objectPaths) ?
                (json as {objectPaths: unknown[]}).objectPaths.filter((path): path is string[] => Array.isArray(path) &&
                    path.length <= 8 && path.every(part => typeof part === 'string')).slice(0, 8) : undefined;
            return paths?.length ? {channel, argument, json: {objectPaths: paths.map(path => [...path])}} : {channel, argument};
        });
}

const jsonReferenceLimit = 64 * 1024;

/** The `key → value` pairs of the first declared object path; undefined when the text is not such JSON. */
function jsonReferences(text: string, objectPaths: string[][]): {key: string; value: string}[] | undefined {
    if (text.length > jsonReferenceLimit) return undefined;
    let root: unknown;
    try {
        root = JSON.parse(text);
    } catch {
        return undefined;
    }
    const isObject = (value: unknown): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    for (const path of objectPaths) {
        let current: unknown = root;
        for (const part of path) current = isObject(current) && Object.hasOwn(current, part) ? current[part] : undefined;
        if (isObject(current)) {
            return Object.entries(current).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
                .map(([key, value]) => ({key, value}));
        }
    }
    return undefined;
}

/** Dropdown options as Blockly would show them; a dynamic menu is the same function the dropdown calls. */
function optionPairs(options: unknown): [string, string][] {
    let value = options;
    if (typeof value === 'function') {
        try {
            value = value();
        } catch {
            return [];
        }
    }
    if (!Array.isArray(value)) return [];
    return value.filter(Array.isArray).filter(pair => typeof pair[0] === 'string' && pair[1] !== undefined)
        .map(pair => [pair[0], String(pair[1])]);
}

function blockArgs(json: RelationBlockInfo['json']) {
    const args: Record<string, unknown>[] = [];
    if (!json) return args;
    for (const [key, value] of Object.entries(json)) {
        if (/^args\d+$/.test(key) && Array.isArray(value)) args.push(...value.filter(arg => arg && typeof arg === 'object'));
    }
    return args;
}

function declarationIndex(runtime: RelationRuntime | undefined): DeclarationIndex | undefined {
    const categories = Array.isArray(runtime?._blockInfo) ? runtime._blockInfo : [];
    const targets = new Map<string, Declared[]>();
    const references = new Map<string, Declared[]>();
    const infos = new Map<string, {block: RelationBlockInfo; category: RelationCategoryInfo}>();
    for (const category of categories) {
        for (const block of Array.isArray(category?.blocks) ? category.blocks : []) {
            const opcode = block?.json?.type;
            const declaration = block?.info?.scriptRelations;
            if (typeof opcode !== 'string' || !declaration) continue;
            const own = declarations(declaration, 'targets');
            const outgoing = declarations(declaration, 'references');
            if (own.length) targets.set(opcode, own);
            if (outgoing.length) references.set(opcode, outgoing);
            if (outgoing.length) infos.set(opcode, {block, category});
        }
    }
    if (!targets.size || !references.size) return undefined;
    const labels = new Map<string, Map<string, string>>();
    return {targets, references, label(opcode, argument, value) {
        const key = `${opcode}\u0000${argument}`;
        if (!labels.has(key)) {
            const {block, category} = infos.get(opcode) ?? {};
            let options: unknown;
            // A menu without reporters is a dropdown on the block; otherwise it is the menu shadow's dropdown.
            const field = blockArgs(block?.json).find(arg => arg.name === argument && arg.type === 'field_dropdown');
            if (field) options = field.options;
            else {
                const menu = block?.info?.arguments?.[argument]?.menu;
                const extension = opcode.slice(0, Math.max(0, opcode.length - String(block?.info?.opcode ?? '').length - 1));
                const shadow = typeof menu === 'string' && extension ? `${extension}_menu_${menu}` : undefined;
                const json = shadow ? category?.menus?.find(entry => entry?.json?.type === shadow)?.json : undefined;
                options = blockArgs(json).find(arg => arg.type === 'field_dropdown')?.options;
            }
            labels.set(key, new Map(optionPairs(options).map(([text, option]) => [option, text])));
        }
        return labels.get(key).get(value) ?? value;
    }};
}

/**
 * Read a declared argument without evaluating it: a dropdown field, or the single field of the active
 * shadow. A reporter placed in the input is a runtime value.
 */
function declaredArgument(block: RelationBlock, blocks: Program['blocks'], name: string):
    {value?: string; unresolved?: 'dynamic' | 'missing'} {
    const own = block.fields?.[name]?.value;
    if (own !== undefined && own !== null) return {value: String(own)};
    const input = block.inputs?.[name];
    const active = input?.block ? blocks[input.block] : undefined;
    if (!active) return {unresolved: 'missing'};
    if (!active.shadow && input.block !== input.shadow) return {unresolved: 'dynamic'};
    const fields = Object.values(active.fields ?? {});
    const value = fields.length === 1 ? fields[0]?.value : undefined;
    return value === undefined || value === null ? {unresolved: 'missing'} : {value: String(value)};
}

/** Relations declared by loaded extension blocks: each reference fans out to every matching target. */
function readDeclaredRelations(programs: readonly Program[]): ScriptRelation[] {
    const index = declarationIndex(programs.find(program => program.target.runtime)?.target.runtime);
    if (!index) return [];
    const destinations = new Map<string, ScriptEndpoint[]>();
    for (const {blocks, endpoint} of programs) {
        for (const block of Object.values(blocks)) {
            const declared = block.shadow ? undefined : index.targets.get(block.opcode);
            if (!declared) continue;
            const destination = endpoint(block.id);
            if (!destination) continue;
            for (const {channel, argument} of declared) {
                const {value} = declaredArgument(block, blocks, argument);
                if (value !== undefined) append(destinations, `${channel}\u0000${value}`, destination);
            }
        }
    }
    const relations: ScriptRelation[] = [];
    for (const {blocks, endpoint} of programs) {
        for (const block of Object.values(blocks)) {
            const declared = block.shadow ? undefined : index.references.get(block.opcode);
            if (!declared) continue;
            const source = endpoint(block.id);
            if (!source) continue;
            for (const {channel, argument, json} of declared) {
                const {value, unresolved} = declaredArgument(block, blocks, argument);
                const base = {kind: 'reference' as const, source, wait: true};
                if (unresolved || value === undefined) {
                    relations.push({...base, label: '', unresolved: unresolved ?? 'missing'});
                    continue;
                }
                const pairs = json ? jsonReferences(value, json.objectPaths) : undefined;
                if (json && !pairs) {
                    relations.push({...base, label: '', unresolved: 'missing'});
                    continue;
                }
                const references = pairs ? pairs.map(pair => ({value: pair.value, label: `${pair.key} → ${pair.value}`})) :
                    [{value, label: index.label(block.opcode, argument, value)}];
                for (const reference of references) {
                    const relation = {...base, label: reference.label};
                    const matches = (destinations.get(`${channel}\u0000${reference.value}`) ?? [])
                        .filter(destination => destination.targetId !== source.targetId || destination.blockId !== source.blockId);
                    if (!matches.length) relations.push({...relation, unresolved: 'missing'});
                    else for (const destination of matches) relations.push({...relation, destination});
                }
            }
        }
    }
    return relations;
}

const registeredResolvers = new Set<ScriptRelationResolver>();

/** Add relations from an editor integration to every later relation scan. Returns the unregistration. */
export function registerScriptRelationResolver(resolver: ScriptRelationResolver): () => void {
    if (!resolver || typeof resolver.resolve !== 'function') throw new TypeError('A script relation resolver is required.');
    registeredResolvers.add(resolver);
    return () => {
        registeredResolvers.delete(resolver);
    };
}

/**
 * Extract possible static calls without executing the project or modifying its blocks.
 * Broadcasts fan out; conflicting function definitions and computed names stay unresolved.
 */
export function readScriptRelations(targets: readonly RelationTarget[],
    options: {resolvers?: readonly ScriptRelationResolver[]} = {}): ScriptRelation[] {
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
    relations.push(...readDeclaredRelations(programs));
    for (const resolver of [...registeredResolvers, ...options.resolvers ?? []]) {
        try {
            relations.push(...resolver.resolve(programs));
        } catch {
            // One failing integration must not remove the native arrows.
        }
    }
    return relations;
}
