// Both backends must implement exactly the functions listed in src/api/contract.js —
// otherwise the demo (or production) would crash at runtime with "x is not a function".
import assert from 'node:assert/strict';
import test from 'node:test';
import { API_CONTRACT } from '../src/api/contract.js';

const backends = {
  supabase: () => import('../src/api/supabase/index.js'),
  demo: () => import('../src/api/demo/index.js'),
};

for (const [name, load] of Object.entries(backends)) {
  test(`${name} backend implements the whole API contract`, async () => {
    const { backend } = await load();
    const missing = [];
    const extra = [];
    for (const [domain, fns] of Object.entries(API_CONTRACT)) {
      const impl = backend[domain];
      if (!impl) { missing.push(`${domain}.*`); continue; }
      for (const fn of fns) if (typeof impl[fn] !== 'function') missing.push(`${domain}.${fn}`);
      for (const key of Object.keys(impl)) if (!fns.includes(key)) extra.push(`${domain}.${key}`);
    }
    assert.deepEqual(missing, [], `${name}: missing ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `${name}: not in contract ${extra.join(', ')} — add to contract.js or remove`);
  });
}
