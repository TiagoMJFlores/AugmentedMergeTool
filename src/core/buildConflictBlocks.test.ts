import { describe, it, expect } from 'vitest';
import {
  parseConflictMarkers,
  commitToTicketId,
  parseGitLogOutput,
} from './buildConflictBlocks.js';

describe('parseConflictMarkers', () => {
  it('should parse a single conflict block', () => {
    const content = [
      'line before',
      '<<<<<<< HEAD',
      'ours line 1',
      'ours line 2',
      '=======',
      'theirs line 1',
      '>>>>>>> feature-branch',
      'line after',
    ].join('\n');

    const result = parseConflictMarkers(content);

    expect(result).toHaveLength(1);
    expect(result[0].oursContent).toBe('ours line 1\nours line 2');
    expect(result[0].theirsContent).toBe('theirs line 1');
    expect(result[0].range).toEqual({ start: 2, end: 7 });
  });

  it('should parse multiple conflict blocks', () => {
    const content = [
      '<<<<<<< HEAD',
      'ours A',
      '=======',
      'theirs A',
      '>>>>>>> branch-a',
      'some code in between',
      '<<<<<<< HEAD',
      'ours B',
      '=======',
      'theirs B',
      '>>>>>>> branch-b',
    ].join('\n');

    const result = parseConflictMarkers(content);

    expect(result).toHaveLength(2);
    expect(result[0].oursContent).toBe('ours A');
    expect(result[0].theirsContent).toBe('theirs A');
    expect(result[0].range).toEqual({ start: 1, end: 5 });

    expect(result[1].oursContent).toBe('ours B');
    expect(result[1].theirsContent).toBe('theirs B');
    expect(result[1].range).toEqual({ start: 7, end: 11 });
  });

  it('should return empty array for file with no conflicts', () => {
    const content = 'just some normal code\nno conflicts here\n';
    const result = parseConflictMarkers(content);
    expect(result).toHaveLength(0);
  });

  it('should handle empty ours side', () => {
    const content = [
      '<<<<<<< HEAD',
      '=======',
      'theirs content',
      '>>>>>>> branch',
    ].join('\n');

    const result = parseConflictMarkers(content);

    expect(result).toHaveLength(1);
    expect(result[0].oursContent).toBe('');
    expect(result[0].theirsContent).toBe('theirs content');
  });

  it('should handle empty theirs side', () => {
    const content = [
      '<<<<<<< HEAD',
      'ours content',
      '=======',
      '>>>>>>> branch',
    ].join('\n');

    const result = parseConflictMarkers(content);

    expect(result).toHaveLength(1);
    expect(result[0].oursContent).toBe('ours content');
    expect(result[0].theirsContent).toBe('');
  });

  it('should include surrounding context (up to 20 lines before and after)', () => {
    const beforeLines = Array.from({ length: 25 }, (_, i) => `before-${i}`);
    const afterLines = Array.from({ length: 25 }, (_, i) => `after-${i}`);
    const content = [
      ...beforeLines,
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> branch',
      ...afterLines,
    ].join('\n');

    const result = parseConflictMarkers(content);

    expect(result).toHaveLength(1);
    expect(result[0].surroundingContext).toContain('before-5');
    expect(result[0].surroundingContext).toContain('before-24');
    expect(result[0].surroundingContext).toContain('after-0');
    expect(result[0].surroundingContext).toContain('after-19');
    expect(result[0].surroundingContext).not.toContain('before-4');
    expect(result[0].surroundingContext).not.toContain('after-20');
  });

  it('should handle multiline content on both sides', () => {
    const content = [
      '<<<<<<< HEAD',
      'line 1 ours',
      'line 2 ours',
      'line 3 ours',
      '=======',
      'line 1 theirs',
      'line 2 theirs',
      '>>>>>>> branch',
    ].join('\n');

    const result = parseConflictMarkers(content);

    expect(result).toHaveLength(1);
    expect(result[0].oursContent).toBe('line 1 ours\nline 2 ours\nline 3 ours');
    expect(result[0].theirsContent).toBe('line 1 theirs\nline 2 theirs');
  });
});

describe('commitToTicketId', () => {
  it('should extract ticket ID from a standard commit message', () => {
    expect(commitToTicketId('NOV-28: add conflict parser')).toBe('NOV-28');
  });

  it('should extract ticket ID in uppercase even if lowercase in message', () => {
    expect(commitToTicketId('nov-28: fix merge logic')).toBe('NOV-28');
  });

  it('should return null when no ticket ID is found', () => {
    expect(commitToTicketId('fix merge logic')).toBeNull();
  });

  it('should extract the first ticket ID from a message with multiple', () => {
    expect(commitToTicketId('NOV-28: relates to NOV-30')).toBe('NOV-28');
  });

  it('should handle ticket IDs with different prefixes', () => {
    expect(commitToTicketId('ENG-123: refactor config')).toBe('ENG-123');
  });

  it('should handle ticket ID embedded in message', () => {
    expect(commitToTicketId('implement parser for ENG-42 feature')).toBe(
      'ENG-42'
    );
  });
});

describe('parseGitLogOutput', () => {
  it('should parse commits from git log output', () => {
    const output = `commit abc1234def567890
Author: Dev <dev@example.com>
Date:   Mon Jan 1 12:00:00 2024 +0000

    NOV-28: implement conflict parser

diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,5 @@
`;

    const result = parseGitLogOutput(output);

    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe('abc1234def567890');
    expect(result[0].message).toBe('NOV-28: implement conflict parser');
  });

  it('should parse multiple commits', () => {
    const output = `commit aaaa1111
Author: Dev <dev@example.com>
Date:   Mon Jan 1 12:00:00 2024 +0000

    NOV-28: first commit

diff --git a/src/file.ts b/src/file.ts

commit bbbb2222
Author: Dev <dev@example.com>
Date:   Tue Jan 2 12:00:00 2024 +0000

    NOV-29: second commit

diff --git a/src/other.ts b/src/other.ts
`;

    const result = parseGitLogOutput(output);

    expect(result).toHaveLength(2);
    expect(result[0].hash).toBe('aaaa1111');
    expect(result[0].message).toBe('NOV-28: first commit');
    expect(result[1].hash).toBe('bbbb2222');
    expect(result[1].message).toBe('NOV-29: second commit');
  });

  it('should return empty array for empty output', () => {
    const result = parseGitLogOutput('');
    expect(result).toHaveLength(0);
  });
});
