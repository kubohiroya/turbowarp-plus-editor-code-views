import workerSource from './generated/script-outline-worker-source.ts';
import type {OutlineCut, OutlineResults} from './script-outline-worker.ts';

type WindowContext = Window & typeof globalThis;
const timeoutMs = 2000;

// A classic blob worker travels with Code Views in every host bundle. Hosts that block it use native SVG.
export function createOutlineWorker(view: WindowContext) {
    let worker: Worker | undefined;
    let url: string | undefined;
    let unavailable = false;
    let pending: {settle: (result: OutlineResults | null) => void; timer: number; length: number} | undefined;

    function complete(result: OutlineResults | null) {
        if (!pending) return;
        const {timer, settle} = pending;
        pending = undefined;
        view.clearTimeout(timer);
        settle(result);
    }

    function close() {
        unavailable = true;
        worker?.terminate();
        worker = undefined;
        if (url) view.URL.revokeObjectURL(url);
        url = undefined;
        complete(null);
    }

    function open() {
        url = view.URL.createObjectURL(new view.Blob([workerSource], {type: 'text/javascript'}));
        worker = new view.Worker(url);
        worker.addEventListener('error', close);
        worker.addEventListener('messageerror', close);
        worker.addEventListener('message', ({data}: MessageEvent<OutlineResults>) => {
            if (Array.isArray(data) && data.length === pending?.length &&
                data.every(value => value === null || Number.isFinite(value))) complete(data);
            else close();
        });
    }

    return {
        calculate(cuts: OutlineCut[]): Promise<OutlineResults | null> {
            if (unavailable || !view.Worker || pending) return Promise.resolve(null);
            return new Promise(settle => {
                pending = {settle, length: cuts.length, timer: view.setTimeout(close, timeoutMs)};
                try {
                    if (!worker) open();
                    worker.postMessage(cuts);
                } catch { close(); }
            });
        },
        dispose: close
    };
}
