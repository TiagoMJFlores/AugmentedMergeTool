import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ResolutionCache } from './cache.js';

const TEST_CACHE_DIR = path.join(__dirname, '../../.test-cache');

describe('ResolutionCache', () => {
  let cache: ResolutionCache;

  beforeEach(() => {
    cache = new ResolutionCache(TEST_CACHE_DIR, 24, 5);
  });

  afterEach(() => {
    try {
      fs.rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should compute a deterministic key from content', () => {
    const key1 = cache.computeKey('base', 'ours', 'theirs');
    const key2 = cache.computeKey('base', 'ours', 'theirs');
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{32}$/);
  });

  it('should produce different keys for different content', () => {
    const key1 = cache.computeKey('base', 'ours1', 'theirs');
    const key2 = cache.computeKey('base', 'ours2', 'theirs');
    expect(key1).not.toBe(key2);
  });

  it('should return null for cache miss', () => {
    const result = cache.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should store and retrieve a result', () => {
    const key = cache.computeKey('', 'a', 'b');
    const result = { resolution: 'merged', explanation: 'test' };

    cache.set(key, result);
    const retrieved = cache.get(key);

    expect(retrieved).toEqual(result);
  });

  it('should return null for expired entries', () => {
    const key = cache.computeKey('', 'expired', 'test');
    // Write the entry manually with a createdAt in the past
    const entryPath = path.join(TEST_CACHE_DIR, `${key}.json`);
    fs.mkdirSync(TEST_CACHE_DIR, { recursive: true });
    fs.writeFileSync(entryPath, JSON.stringify({
      result: { resolution: 'old', explanation: 'expired' },
      createdAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago, exceeds 24h TTL
    }));

    const result = cache.get(key);
    expect(result).toBeNull();
  });

  it('should evict oldest entries when max is exceeded', () => {
    // Set 6 entries with max 5
    for (let i = 0; i < 6; i++) {
      const key = cache.computeKey('', `ours-${i}`, 'theirs');
      cache.set(key, { resolution: `res-${i}`, explanation: `exp-${i}` });
    }

    const files = fs.readdirSync(TEST_CACHE_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeLessThanOrEqual(5);
  });

  it('should clear all entries', () => {
    cache.set(cache.computeKey('', 'a', 'b'), { resolution: 'r', explanation: 'e' });
    cache.set(cache.computeKey('', 'c', 'd'), { resolution: 'r2', explanation: 'e2' });

    cache.clear();

    const files = fs.readdirSync(TEST_CACHE_DIR).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(0);
  });
});
