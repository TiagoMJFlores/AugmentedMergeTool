import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ResolveResult } from './types.js';

interface CacheEntry {
  result: ResolveResult;
  createdAt: number;
}

export class ResolutionCache {
  private readonly dir: string;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(cacheDir: string, ttlHours = 24, maxEntries = 500) {
    this.dir = cacheDir;
    this.ttlMs = ttlHours * 60 * 60 * 1000;
    this.maxEntries = maxEntries;
  }

  computeKey(baseContent: string, oursContent: string, theirsContent: string, surroundingContext = ''): string {
    const hash = crypto.createHash('md5');
    hash.update(baseContent);
    hash.update('||');
    hash.update(oursContent);
    hash.update('||');
    hash.update(theirsContent);
    hash.update('||');
    hash.update(surroundingContext);
    return hash.digest('hex');
  }

  get(key: string): ResolveResult | null {
    const filePath = this.entryPath(key);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const entry: CacheEntry = JSON.parse(raw);

      if (Date.now() - entry.createdAt > this.ttlMs) {
        fs.unlinkSync(filePath);
        return null;
      }

      return entry.result;
    } catch {
      return null;
    }
  }

  set(key: string, result: ResolveResult): void {
    this.ensureDir();

    const entry: CacheEntry = {
      result,
      createdAt: Date.now(),
    };

    fs.writeFileSync(this.entryPath(key), JSON.stringify(entry), 'utf-8');
    this.evictIfNeeded();
  }

  clear(): void {
    try {
      const files = fs.readdirSync(this.dir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(this.dir, file));
        }
      }
    } catch {
      // dir may not exist
    }
  }

  private entryPath(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  private ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private evictIfNeeded(): void {
    try {
      const files = fs.readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({
          name: f,
          path: path.join(this.dir, f),
          mtime: fs.statSync(path.join(this.dir, f)).mtimeMs,
        }))
        .sort((a, b) => a.mtime - b.mtime);

      if (files.length <= this.maxEntries) return;

      const toRemove = files.length - this.maxEntries;
      for (let i = 0; i < toRemove; i++) {
        fs.unlinkSync(files[i].path);
      }
    } catch {
      // best-effort eviction
    }
  }
}
