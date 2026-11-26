import {outlinePoint} from '../../src/script-outline.ts';
import {createOutlineWorker} from '../../src/script-outline-worker-client.ts';

Object.assign(globalThis, {outlinePoint, createOutlineWorker});
