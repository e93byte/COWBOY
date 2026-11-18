import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../app/components/AccountPicks';

test('client API converts a stalled request into a bounded, actionable error', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => {
    receivedSignal = init?.signal;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    });
  };
  try {
    await assert.rejects(
      api('/api/stalled', undefined, 10),
      error => (error as Error).message === 'This data request timed out. Showing the last available information; try again shortly.',
    );
    assert.equal(receivedSignal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('client API preserves caller cancellation instead of mislabeling navigation as a timeout', async () => {
  const originalFetch = globalThis.fetch;
  const parent = new AbortController();
  globalThis.fetch = async (_input, init) => await new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  try {
    const request = api('/api/cancelled', { signal: parent.signal }, 1000);
    parent.abort();
    await assert.rejects(request, error => (error as Error).name === 'AbortError');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
