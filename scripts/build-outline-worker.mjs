import {mkdir, writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const output = await build({
    entryPoints: [fileURLToPath(new URL('../src/script-outline-worker.ts', import.meta.url))],
    bundle: true, platform: 'browser', format: 'iife', target: 'es2020',
    minify: true, legalComments: 'inline', write: false
});
const generated = new URL('../src/generated/', import.meta.url);
await mkdir(generated, {recursive: true});
await writeFile(new URL('script-outline-worker-source.ts', generated),
    'const workerSource: string = ' + JSON.stringify(output.outputFiles[0].text) + ';\nexport default workerSource;\n');
