import { describe, expect, it } from 'vitest';
import { applyResolutionsToContent } from './applyResolutions.js';

describe('applyResolutionsToContent', () => {
  it('applies only non-null resolutions and keeps skipped conflict markers', () => {
    const file = [
      'A',
      '<<<<<<< HEAD',
      'ours1',
      '=======',
      'theirs1',
      '>>>>>>> branch',
      'B',
      '<<<<<<< HEAD',
      'ours2',
      '=======',
      'theirs2',
      '>>>>>>> branch',
      'C',
    ].join('\n');

    const result = applyResolutionsToContent(file, [
      { range: { start: 2, end: 6 }, resolution: null },
      { range: { start: 8, end: 12 }, resolution: 'merged2' },
    ]);

    expect(result.modified).toBe(true);
    expect(result.content).toBe(
      [
        'A',
        '<<<<<<< HEAD',
        'ours1',
        '=======',
        'theirs1',
        '>>>>>>> branch',
        'B',
        'merged2',
        'C',
      ].join('\n')
    );
  });
});
