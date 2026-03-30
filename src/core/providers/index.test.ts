import { describe, expect, it } from 'vitest';
import { createProvider, normalizeProvider } from './index.js';
import { NullProvider } from './NullProvider.js';

describe('normalizeProvider', () => {
  it('defaults to none when undefined', () => {
    expect(normalizeProvider(undefined)).toBe('none');
  });

  it('normalizes known providers', () => {
    expect(normalizeProvider('LINEAR')).toBe('linear');
    expect(normalizeProvider('jira')).toBe('jira');
    expect(normalizeProvider('github')).toBe('github');
    expect(normalizeProvider('none')).toBe('none');
  });

  it('throws for unknown provider', () => {
    expect(() => normalizeProvider('trello')).toThrow(/Invalid provider/);
  });
});

describe('createProvider', () => {
  it('returns NullProvider for none', () => {
    const provider = createProvider({ provider: 'none' });
    expect(provider).toBeInstanceOf(NullProvider);
  });
});
