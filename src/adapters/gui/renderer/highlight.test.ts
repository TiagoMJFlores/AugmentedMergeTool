import { describe, expect, it } from 'vitest';
import { computeHighlightRange, computeHighlightedLineNumbers } from './highlight.js';

describe('computeHighlightRange', () => {
  it('uses owner lines when they exist for active conflict', () => {
    const range = computeHighlightRange(20, 2, [-1, 2, 2, -1, 1, 1], { start: 10, end: 12 });
    expect(range).toEqual({ start: 2, end: 3 });
  });

  it('falls back to provided range when owner lines are missing', () => {
    const range = computeHighlightRange(20, 3, [-1, 2, 2, -1, 1, 1], { start: 10, end: 12 });
    expect(range).toEqual({ start: 10, end: 12 });
  });

  it('clamps out-of-bounds fallback ranges', () => {
    const range = computeHighlightRange(5, 10, [], { start: 9, end: 14 });
    expect(range).toEqual({ start: 5, end: 5 });
  });

  it('handles negative and inverted ranges safely', () => {
    const range = computeHighlightRange(8, 99, [], { start: -4, end: -1 });
    expect(range).toEqual({ start: 1, end: 1 });
  });
});

describe('computeHighlightedLineNumbers', () => {
  it('returns full line list for the computed range', () => {
    expect(computeHighlightedLineNumbers(10, 1, [-1, 1, 1, 1], { start: 7, end: 8 })).toEqual([2, 3, 4]);
  });

  it('returns single line when range collapses', () => {
    expect(computeHighlightedLineNumbers(3, 77, [], { start: 9, end: 11 })).toEqual([3]);
  });
});
