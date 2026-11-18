// SPDX-License-Identifier: MPL-2.0
import {createCodeSession} from '@kubohiroya/turbowarp-plus-editor-code-views';
import {createSurface, pendingSurfaceEdits} from '@kubohiroya/turbowarp-plus-editor-windows/surfaces';

import type {SurfaceHost} from '@kubohiroya/turbowarp-plus-editor-windows/surfaces';
export function createDesktopCode({host, layoutMenu}: {host: SurfaceHost<any, any> | null; layoutMenu: boolean}) {
    const desktopCodeEnabled = Boolean(host);
    let openCode = null;

    const openDesktopCode = () => openCode?.();

    function attachDesktopCode(context) {
        if (!host) return null;
        const session = createCodeSession(context);
        const unregister = pendingSurfaceEdits.register(() => session.flush());
        const surfaces = new Set<{dock(): void}>();
        const menu = layoutMenu;
        const open = (target = context.vm.editingTarget) => {
            if (!target?.isOriginal || !context.canUse() || surfaces.size >= 2) return;
            let detach;
            const surface = createSurface(host, state => {
                if (state.kind === 'external') {
                    detach = session.attach({...state.target, target, close: () => surface.dock(),
                        duplicate: menu ? next => open(next) : undefined, layoutMenu: menu});
                } else if (state.kind === 'docked') {
                    surfaces.delete(surface);
                    detach?.();
                    if (menu) session.setCanDuplicate(surfaces.size < 2);
                }
            });
            surfaces.add(surface);
            if (menu) session.setCanDuplicate(surfaces.size < 2);
            surface.undock({timeoutMs: 15000});
        };
        openCode = open;
        return {dispose() {
            if (openCode === open) openCode = null;
            unregister();
            session.dispose();
            for (const surface of surfaces) surface.dock();
        }};
    }

    return {desktopCodeEnabled, openDesktopCode, attachDesktopCode};
}
