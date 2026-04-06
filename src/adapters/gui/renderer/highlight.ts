export interface LineRange {
  start: number;
  end: number;
}

export function computeHighlightRange(
  totalLines: number,
  activeConflictIndex: number,
  lineOwners: number[],
  fallbackRange: LineRange
): LineRange {
  const ownerLineIndexes = lineOwners
    .map((owner, index) => (owner === activeConflictIndex ? index + 1 : -1))
    .filter((lineNumber) => lineNumber > 0);

  const rawStart = ownerLineIndexes.length > 0 ? Math.min(...ownerLineIndexes) : fallbackRange.start;
  const rawEnd = ownerLineIndexes.length > 0 ? Math.max(...ownerLineIndexes) : fallbackRange.end;
  const safeTotal = Math.max(1, totalLines);
  const clampedStart = Math.min(Math.max(1, rawStart), safeTotal);
  const clampedEnd = Math.max(clampedStart, Math.min(rawEnd, safeTotal));
  return { start: clampedStart, end: clampedEnd };
}

export function computeHighlightedLineNumbers(
  totalLines: number,
  activeConflictIndex: number,
  lineOwners: number[],
  fallbackRange: LineRange
): number[] {
  const range = computeHighlightRange(totalLines, activeConflictIndex, lineOwners, fallbackRange);
  const highlighted: number[] = [];
  for (let line = range.start; line <= range.end; line++) {
    highlighted.push(line);
  }
  return highlighted;
}
