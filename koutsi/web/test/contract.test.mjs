// Both backends must implement exactly the contract: a missing function would crash a screen
// at runtime, an extra one means the contract (and the demo) has drifted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_CONTRACT } from '../src/api/contract.js';
import { backend as supabase } from '../src/api/supabase/index.js';
import { backend as demo } from '../src/api/demo/index.js';

for (const [name, impl] of [['supabase', supabase], ['demo', demo]]) {
  test(`${name} backend implements exactly the contract`, () => {
    assert.deepEqual(Object.keys(impl).sort(), Object.keys(API_CONTRACT).sort(), 'domains');
    for (const [domain, fns] of Object.entries(API_CONTRACT)) {
      assert.deepEqual(Object.keys(impl[domain]).sort(), [...fns].sort(), `${name}.${domain}`);
      for (const fn of fns) assert.equal(typeof impl[domain][fn], 'function', `${name}.${domain}.${fn}`);
    }
  });
}
