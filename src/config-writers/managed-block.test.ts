import { describe, expect, it } from 'vitest';
import { MANAGED_KEY, mergeManagedEntries, removeManagedEntries } from './managed-block.js';
import type { ManagedEntry } from './writer-interface.js';

function gatewayEntry(url: string): ManagedEntry {
  return { type: 'http', url, headers: { Authorization: 'Bearer tok-123' } };
}

describe('managed-block', () => {
  it('CFG-02: merges the managed entry into an empty config', () => {
    const result = mergeManagedEntries({}, { [MANAGED_KEY]: gatewayEntry('http://127.0.0.1:4000/mcp/tok-123') });

    expect(result).toEqual({
      [MANAGED_KEY]: gatewayEntry('http://127.0.0.1:4000/mcp/tok-123'),
    });
  });

  it('CFG-02: preserves existing user entries untouched when merging', () => {
    const existing = {
      'my-custom-mcp': { command: 'npx', args: ['-y', 'some-mcp'] },
    };

    const result = mergeManagedEntries(existing, {
      [MANAGED_KEY]: gatewayEntry('http://127.0.0.1:4000/mcp/tok-123'),
    });

    expect(result['my-custom-mcp']).toEqual(existing['my-custom-mcp']);
    expect(result[MANAGED_KEY]).toEqual(gatewayEntry('http://127.0.0.1:4000/mcp/tok-123'));
  });

  it('CFG-02: re-merging identical input yields byte-identical serialized output (idempotent)', () => {
    const existing = { 'other-mcp': { command: 'uvx' } };
    const managed = { [MANAGED_KEY]: gatewayEntry('http://127.0.0.1:4000/mcp/tok-123') };

    const first = JSON.stringify(mergeManagedEntries(existing, managed));
    const second = JSON.stringify(mergeManagedEntries(existing, managed));

    expect(second).toBe(first);
  });

  it('CFG-02: removing the managed set when a consumer has 0 assignments preserves user entries', () => {
    const existing = {
      'other-mcp': { command: 'uvx' },
      [MANAGED_KEY]: gatewayEntry('http://127.0.0.1:4000/mcp/tok-123'),
    };

    const result = removeManagedEntries(existing, [MANAGED_KEY]);

    expect(result).toEqual({ 'other-mcp': { command: 'uvx' } });
    expect(result[MANAGED_KEY]).toBeUndefined();
  });

  it('CFG-02: output key ordering is deterministic across runs regardless of insertion order', () => {
    const orderA = { zeta: 1, alpha: 2 };
    const orderB = { alpha: 2, zeta: 1 };

    const resultA = mergeManagedEntries(orderA, { [MANAGED_KEY]: gatewayEntry('http://x/mcp/t') });
    const resultB = mergeManagedEntries(orderB, { [MANAGED_KEY]: gatewayEntry('http://x/mcp/t') });

    expect(Object.keys(resultA)).toEqual(Object.keys(resultB));
    expect(JSON.stringify(resultA)).toBe(JSON.stringify(resultB));
    expect(Object.keys(resultA)).toEqual(['alpha', MANAGED_KEY, 'zeta']);
  });
});
