/**
 * The workspaces that show a target's code and send their edits to the VM.
 *
 * Without the code area's own attachment the GUI adds `vm.blockListener` to the workspace, so a
 * module can recognise it by that listener. With `attachCodeWorkspace` the GUI adds the
 * attachment's own listener instead, which wraps `vm.blockListener`; the attachment records its
 * workspace here so other modules still recognise it.
 */
const codeWorkspaces = new WeakSet<object>();

/**
 * Record a workspace as one that shows a target's code.
 * @param {object} workspace The workspace.
 * @returns {() => void} A function that removes the record.
 */
export const registerCodeWorkspace = (workspace: object) => {
    codeWorkspaces.add(workspace);
    return () => {
        codeWorkspaces.delete(workspace);
    };
};

/**
 * Whether a workspace shows a target's code: it was recorded here, or it sends its events to
 * `vm.blockListener` directly.
 * @param {object} vm The VM.
 * @param {object} workspace The workspace.
 * @returns {boolean} Whether it is a code workspace.
 */
export const isCodeWorkspace = (vm: {blockListener?: unknown}, workspace: {listeners_?: unknown[]} | null | undefined) =>
    !!workspace && (codeWorkspaces.has(workspace) ||
        (!!vm.blockListener && Array.isArray(workspace.listeners_) && workspace.listeners_.includes(vm.blockListener)));
