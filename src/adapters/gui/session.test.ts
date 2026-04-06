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
    expect(state.blocks[0]?.selectedSide).toBeNull();
    expect(state.blocks[0]?.selectedAction).toBeNull();
    expect(state.localFullContent).toBe(['before', 'ours line', 'after'].join('\n'));
    expect(state.remoteFullContent).toBe(['before', 'theirs line', 'after'].join('\n'));
    expect(state.previewLineOwners).toEqual([-1, 0, -1]);
    expect(state.blocks[0]?.localRange).toEqual({ start: 2, end: 2 });
    expect(state.blocks[0]?.remoteRange).toEqual({ start: 2, end: 2 });
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
    expect(state.blocks[0]?.selectedSide).toBe('both');
    expect(state.blocks[0]?.selectedAction).toBe('choose-both-left-first');
  });

  it('accept-both-right-first mode keeps remote then local content', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-both-right.txt`);
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

    const state = session.applyResolution({ conflictIndex: 0, mode: 'accept-both-right-first' });

    expect(state.blocks[0]?.appliedResolution).toBe(['remote line', 'local line'].join('\n'));
    expect(state.blocks[0]?.selectedSide).toBe('both');
    expect(state.blocks[0]?.selectedAction).toBe('choose-both-right-first');
  });

  it('finish writes manually edited final content when provided', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-manual.txt`);
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

    session.finish(['before', 'custom edit', 'after'].join('\n'));

    expect(fs.readFileSync(mergedPath, 'utf-8')).toBe(['before', 'custom edit', 'after'].join('\n'));
  });

  it('computes preview ranges based on actual rendered preview output', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-ranges.txt`);
    createdFiles.push(mergedPath);

    fs.writeFileSync(
      mergedPath,
      [
        'header',
        '<<<<<<< HEAD',
        'left one',
        '=======',
        'right one',
        '>>>>>>> branch-a',
        'middle',
        '<<<<<<< HEAD',
        'left two',
        '=======',
        'right two',
        '>>>>>>> branch-b',
        'footer',
      ].join('\n'),
      'utf-8'
    );

    const session = await GuiSession.create({
      local: mergedPath,
      base: mergedPath,
      remote: mergedPath,
      merged: mergedPath,
    });

    session.applyResolution({ conflictIndex: 0, mode: 'use-local' });
    const state = session.getState();

    expect(state.blocks[0]?.previewRange).toEqual({ start: 2, end: 2 });
    expect(state.blocks[1]?.previewRange).toEqual({ start: 4, end: 4 });
  });

  it('marks preview line owners for selected conflict lines after applying right side', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-owners.txt`);
    createdFiles.push(mergedPath);

    fs.writeFileSync(
      mergedPath,
      [
        'start',
        '<<<<<<< HEAD',
        'left choice',
        '=======',
        'right choice',
        '>>>>>>> branch',
        'end',
      ].join('\n'),
      'utf-8'
    );

    const session = await GuiSession.create({
      local: mergedPath,
      base: mergedPath,
      remote: mergedPath,
      merged: mergedPath,
    });

    const state = session.applyResolution({ conflictIndex: 0, mode: 'use-remote' });
    const rightChoiceLine = state.previewContent.split('\n').findIndex((line) => line === 'right choice');

    expect(rightChoiceLine).toBeGreaterThanOrEqual(0);
    expect(state.previewLineOwners[rightChoiceLine]).toBe(0);
    expect(state.previewContent).not.toContain('>>>>>>>');
  });

  it('defaults unresolved preview to local side content (no raw conflict markers)', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-default-preview.txt`);
    createdFiles.push(mergedPath);

    fs.writeFileSync(
      mergedPath,
      ['x', '<<<<<<< HEAD', 'local-default', '=======', 'remote-default', '>>>>>>> branch', 'y'].join('\n'),
      'utf-8'
    );

    const session = await GuiSession.create({
      local: mergedPath,
      base: mergedPath,
      remote: mergedPath,
      merged: mergedPath,
    });
    const state = session.getState();

    expect(state.previewContent).toContain('local-default');
    expect(state.previewContent).not.toContain('remote-default');
    expect(state.previewContent).not.toContain('<<<<<<<');
    expect(state.previewContent).not.toContain('>>>>>>>');
  });

  it('updates preview ownership when switching selection from left to right', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-switch.txt`);
    createdFiles.push(mergedPath);

    fs.writeFileSync(
      mergedPath,
      ['a', '<<<<<<< HEAD', 'left-switch', '=======', 'right-switch', '>>>>>>> branch', 'b'].join('\n'),
      'utf-8'
    );

    const session = await GuiSession.create({
      local: mergedPath,
      base: mergedPath,
      remote: mergedPath,
      merged: mergedPath,
    });

    const leftState = session.applyResolution({ conflictIndex: 0, mode: 'use-local' });
    const leftLineIndex = leftState.previewContent.split('\n').findIndex((line) => line === 'left-switch');
    expect(leftLineIndex).toBeGreaterThanOrEqual(0);
    expect(leftState.previewLineOwners[leftLineIndex]).toBe(0);

    const rightState = session.applyResolution({ conflictIndex: 0, mode: 'use-remote' });
    const rightLineIndex = rightState.previewContent.split('\n').findIndex((line) => line === 'right-switch');
    expect(rightLineIndex).toBeGreaterThanOrEqual(0);
    expect(rightState.previewLineOwners[rightLineIndex]).toBe(0);
  });

  it('tracks owner lines for accept-both-left-first order', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-both-left.txt`);
    createdFiles.push(mergedPath);

    fs.writeFileSync(
      mergedPath,
      ['a', '<<<<<<< HEAD', 'L1', '=======', 'R1', '>>>>>>> branch', 'b'].join('\n'),
      'utf-8'
    );

    const session = await GuiSession.create({
      local: mergedPath,
      base: mergedPath,
      remote: mergedPath,
      merged: mergedPath,
    });

    const state = session.applyResolution({ conflictIndex: 0, mode: 'accept-both' });
    expect(state.previewContent).toContain(['L1', 'R1'].join('\n'));
    const lines = state.previewContent.split('\n');
    const ownerLines = state.previewLineOwners
      .map((owner, index) => ({ owner, index }))
      .filter((entry) => entry.owner === 0)
      .map((entry) => lines[entry.index]);
    expect(ownerLines).toEqual(['L1', 'R1']);
  });

  it('tracks owner lines for accept-both-right-first order', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-both-right-order.txt`);
    createdFiles.push(mergedPath);

    fs.writeFileSync(
      mergedPath,
      ['a', '<<<<<<< HEAD', 'L2', '=======', 'R2', '>>>>>>> branch', 'b'].join('\n'),
      'utf-8'
    );

    const session = await GuiSession.create({
      local: mergedPath,
      base: mergedPath,
      remote: mergedPath,
      merged: mergedPath,
    });

    const state = session.applyResolution({ conflictIndex: 0, mode: 'accept-both-right-first' });
    expect(state.previewContent).toContain(['R2', 'L2'].join('\n'));
    const lines = state.previewContent.split('\n');
    const ownerLines = state.previewLineOwners
      .map((owner, index) => ({ owner, index }))
      .filter((entry) => entry.owner === 0)
      .map((entry) => lines[entry.index]);
    expect(ownerLines).toEqual(['R2', 'L2']);
  });

  it('assigns different owner ids for different conflicts in preview', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-owners-multi.txt`);
    createdFiles.push(mergedPath);

    fs.writeFileSync(
      mergedPath,
      [
        's',
        '<<<<<<< HEAD',
        'left-a',
        '=======',
        'right-a',
        '>>>>>>> branch-a',
        'm',
        '<<<<<<< HEAD',
        'left-b',
        '=======',
        'right-b',
        '>>>>>>> branch-b',
        'e',
      ].join('\n'),
      'utf-8'
    );

    const session = await GuiSession.create({
      local: mergedPath,
      base: mergedPath,
      remote: mergedPath,
      merged: mergedPath,
    });

    session.applyResolution({ conflictIndex: 0, mode: 'use-local' });
    const state = session.applyResolution({ conflictIndex: 1, mode: 'use-remote' });
    const lines = state.previewContent.split('\n');
    const owner0Lines = state.previewLineOwners
      .map((owner, index) => ({ owner, value: lines[index] }))
      .filter((entry) => entry.owner === 0)
      .map((entry) => entry.value);
    const owner1Lines = state.previewLineOwners
      .map((owner, index) => ({ owner, value: lines[index] }))
      .filter((entry) => entry.owner === 1)
      .map((entry) => entry.value);

    expect(owner0Lines).toEqual(['left-a']);
    expect(owner1Lines).toEqual(['right-b']);
  });

  it('keeps previewRange aligned with realistic multiline right-side selection', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-realistic.txt`);
    createdFiles.push(mergedPath);

    fs.writeFileSync(
      mergedPath,
      [
        'def calculate_fee(amount: float) -> float:',
        '<<<<<<< HEAD',
        '    # New tiered fee structure',
        '    if amount < 100:',
        '        return amount * 0.02',
        '=======',
        '    # Flat fee for simplicity',
        '    return 1.50',
        '>>>>>>> feature/async-processing',
        '',
        'def finalize() -> None:',
        '    pass',
      ].join('\n'),
      'utf-8'
    );

    const session = await GuiSession.create({
      local: mergedPath,
      base: mergedPath,
      remote: mergedPath,
      merged: mergedPath,
    });

    const state = session.applyResolution({ conflictIndex: 0, mode: 'use-remote' });
    const lines = state.previewContent.split('\n');
    const highlightedLines = state.previewLineOwners
      .map((owner, index) => ({ owner, line: lines[index] }))
      .filter((entry) => entry.owner === 0)
      .map((entry) => entry.line);

    expect(highlightedLines).toEqual(['    # Flat fee for simplicity', '    return 1.50']);
    expect(state.blocks[0]?.previewRange).toEqual({ start: 2, end: 3 });
  });

  it('updates previewRange when switching between left and right in realistic multiline conflict', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-switch-realistic.txt`);
    createdFiles.push(mergedPath);

    fs.writeFileSync(
      mergedPath,
      [
        'start',
        '<<<<<<< HEAD',
        'left-1',
        'left-2',
        '=======',
        'right-1',
        '>>>>>>> feat',
        'end',
      ].join('\n'),
      'utf-8'
    );

    const session = await GuiSession.create({
      local: mergedPath,
      base: mergedPath,
      remote: mergedPath,
      merged: mergedPath,
    });

    const leftState = session.applyResolution({ conflictIndex: 0, mode: 'use-local' });
    expect(leftState.blocks[0]?.previewRange).toEqual({ start: 2, end: 3 });

    const rightState = session.applyResolution({ conflictIndex: 0, mode: 'use-remote' });
    expect(rightState.blocks[0]?.previewRange).toEqual({ start: 2, end: 2 });
    expect(rightState.previewContent).toContain('right-1');
    expect(rightState.previewContent).not.toContain('left-2');
  });

  it('ensures each conflict previewRange is fully covered by matching owner ids', async () => {
    const mergedPath = path.join(process.cwd(), `tmp-gui-conflict-${Date.now()}-range-owner.txt`);
    createdFiles.push(mergedPath);

    fs.writeFileSync(
      mergedPath,
      [
        'a',
        '<<<<<<< HEAD',
        'l-a',
        '=======',
        'r-a',
        '>>>>>>> a',
        'b',
        '<<<<<<< HEAD',
        'l-b',
        '=======',
        'r-b',
        '>>>>>>> b',
        'c',
      ].join('\n'),
      'utf-8'
    );

    const session = await GuiSession.create({
      local: mergedPath,
      base: mergedPath,
      remote: mergedPath,
      merged: mergedPath,
    });
    session.applyResolution({ conflictIndex: 0, mode: 'use-local' });
    const state = session.applyResolution({ conflictIndex: 1, mode: 'use-remote' });

    state.blocks.forEach((block, blockIndex) => {
      const ownersInRange = state.previewLineOwners.slice(block.previewRange.start - 1, block.previewRange.end);
      expect(ownersInRange.every((owner) => owner === blockIndex)).toBe(true);
    });
  });
});
