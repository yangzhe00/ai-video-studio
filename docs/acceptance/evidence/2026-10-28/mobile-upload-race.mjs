import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('/Users/yangzhe/Documents/ChatGPT/剪辑/apps/web/package.json');
const ts = require('typescript');
const root = '/Users/yangzhe/Documents/ChatGPT/剪辑/apps/mobile/src';
function loadSource(name, deps) {
  const source = readFileSync(`${root}/${name}`, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', 'Blob', 'Response', 'Headers', code)(
    id => { if (!(id in deps)) throw new Error(`Missing mock: ${id}`); return deps[id]; },
    module, module.exports, globalThis.fetch, Blob, Response, Headers);
  return module.exports;
}

const values = new Map();
const secureStore = {
  getItemAsync: async key => values.get(key) ?? null,
  setItemAsync: async (key, value) => { values.set(key, value); },
  deleteItemAsync: async key => { values.delete(key); },
};
const session = loadSource('session.ts', {});
let releasePhoto;
let photoReadStarted;
const gate = new Promise(resolve => { releasePhoto = resolve; });
const started = new Promise(resolve => { photoReadStarted = resolve; });
let uploadCookie;
globalThis.fetch = async (url, init) => {
  if (url === 'file://qa-photo') return { blob: async () => {
    photoReadStarted(); await gate; return new Blob(['test photo'], { type: 'image/jpeg' });
  } };
  if (url === 'https://a.example/auth/login') return Response.json({}, { headers: { 'set-cookie': 'avs_session=server-a; HttpOnly' } });
  if (url === 'https://b.example/auth/login') return Response.json({}, { headers: { 'set-cookie': 'avs_session=server-b; HttpOnly' } });
  if (url === 'https://a.example/objects') {
    uploadCookie = new Headers(init.headers).get('Cookie');
    return Response.json({ object: { id: 'asset-0001' } });
  }
  throw new Error(`Unexpected URL ${url}`);
};
const api = loadSource('api.ts', {
  'expo-secure-store': secureStore,
  '@ai-video/project-core': { parseCloudEnvelope: value => value },
  './session': session,
});
await api.setApiUrl('https://a.example');
await api.request('/auth/login', 'POST', {});
const pending = api.uploadPhoto('file://qa-photo', 'image/jpeg');
await started;
await api.setApiUrl('https://b.example');
await api.request('/auth/login', 'POST', {});
releasePhoto();
await pending;
process.stdout.write(`A upload Cookie: ${uploadCookie ?? '<none>'}\n`);
if (uploadCookie === 'avs_session=server-b') {
  process.stdout.write('DEFECT REPRODUCED: B session was sent to A upload endpoint\n');
  process.exitCode = 1;
} else process.stdout.write('PASS: B session not sent to A\n');
