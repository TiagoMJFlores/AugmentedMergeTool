import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { GuiSession } from './session.js';

const createdFiles: string[] = [];

afterEach(() => {
  for (const file of createdFiles.splice(0, createdFiles.length)) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
});

describe('GuiSession.create', () => {
  it('loads conflict markers from merged file into GUI state', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}.txt`);
    createdFiles.push(mergedPath);

    fs.writeFileSync(
      mergedPath,
      [
        'before',
        '<<<<<<< HEAD',
        'ours line',
        '=======',
        'theirs line',
        '>>>>>>> feature/branch',
        'after',
      ].join('\n'),
      'utf-8'
    );

    const session = await GuiSession.create({
      local: mergedPath,
      base: mergedPath,
      remote: mergedPath,
      merged: mergedPath,
    });

    const state = session.getState();

    expect(state.total).toBe(1);
    expect(state.blocks[0]?.ours).toBe('ours line');
    expect(state.blocks[0]?.theirs).toBe('theirs line');
    expect(state.localFullContent).toBe(['before', 'ours line', 'after'].join('\n'));
    expect(state.remoteFullContent).toBe(['before', 'theirs line', 'after'].join('\n'));
  });

  it('accept-both mode keeps local then remote content', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-both.txt`);
    createdFiles.push(mergedPath);

    fs.writeFileSync(
      mergedPath,
      [
        'before',
        '<<<<<<< HEAD',
        'local line',
        '=======',
        'remote line',
        '>>>>>>> feature/branch',
        'after',
      ].join('\n'),
      'utf-8'
    );

    const session = await GuiSession.create({
      local: mergedPath,
      base: mergedPath,
      remote: mergedPath,
      merged: mergedPath,
    });

    const state = session.applyResolution({ conflictIndex: 0, mode: 'accept-both' });

    expect(state.blocks[0]?.appliedResolution).toBe(['local line', 'remote line'].join('\n'));
  });
});
