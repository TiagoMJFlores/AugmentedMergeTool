export interface ResolutionDecision {
  range: { start: number; end: number };
  resolution: string | null;
}

export function applyResolutionsToContent(
  fileContent: string,
  decisions: ResolutionDecision[]
): { content: string; modified: boolean } {
  let nextContent = fileContent;
  let modified = false;

  for (const decision of [...decisions].reverse()) {
    if (decision.resolution === null) {
      continue;
    }

    const lines = nextContent.split('\n');
    const startIdx = decision.range.start - 1;
    const endIdx = decision.range.end - 1;
    const resolutionLines = decision.resolution.split('\n');
    lines.splice(startIdx, endIdx - startIdx + 1, ...resolutionLines);
    nextContent = lines.join('\n');
    modified = true;
  }

  return { content: nextContent, modified };
}
