import {JSDOM} from 'jsdom';

// Imported before React, which decides at load time whether it has a DOM.
export const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/', pretendToBeVisual: true});
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Event', 'KeyboardEvent', 'MouseEvent']) {
    Object.defineProperty(globalThis, name, {value: dom.window[name], configurable: true});
}
// React 18 in legacy mode renders synchronously; this tells it the test drives the updates.
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
// React's browser scheduler keeps Node's native MessagePort referenced forever, so the test would never exit.
globalThis.MessageChannel = undefined;
