import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attachCodeZoomRange, minimumCodeScale} from '../dist/code-zoom.js';

test('code workspaces reach two percent and restore their previous range after the last attachment', () => {
    const workspace = {options: {zoomOptions: {minScale: .3}}};
    const first = attachCodeZoomRange(workspace), second = attachCodeZoomRange(workspace);
    assert.equal(workspace.options.zoomOptions.minScale, .02);
    assert.equal(minimumCodeScale, .02);
    first(); first();
    assert.equal(workspace.options.zoomOptions.minScale, .02);
    second();
    assert.equal(workspace.options.zoomOptions.minScale, .3);
});

test('a smaller host limit or a later host change is preserved', () => {
    const workspace = {options: {zoomOptions: {minScale: .01}}};
    const dispose = attachCodeZoomRange(workspace);
    assert.equal(workspace.options.zoomOptions.minScale, .01);
    workspace.options.zoomOptions.minScale = .005;
    dispose();
    assert.equal(workspace.options.zoomOptions.minScale, .005);
});
