interface GuiConflictBlock {
  id: string;
  index: number;
  range: { start: number; end: number };
  localRange: { start: number; end: number };
  remoteRange: { start: number; end: number };
  previewRange: { start: number; end: number };
  ours: string;
  theirs: string;
  aiResult: string;
  explanation: string;
  appliedResolution: string | null;
  actionTaken: boolean;
  selectedSide: 'local' | 'remote' | 'both' | null;
  selectedAction:
    | 'choose-ai'
    | 'choose-left'
    | 'choose-right'
    | 'choose-both-left-first'
    | 'choose-both-right-first'
    | null;
}

interface GuiFileEntry {
  path: string;
  conflictCount: number;
  allResolved: boolean;
}

interface GuiMultiFileState {
  files: GuiFileEntry[];
  activeFilePath: string;
}

interface GuiSessionState {
  mergedPath: string;
  total: number;
  currentIndex: number;
  complete: boolean;
  localFullContent: string;
  remoteFullContent: string;
  previewContent: string;
  previewLineOwners: number[];
  blocks: GuiConflictBlock[];
  multiFile: GuiMultiFileState | null;
}

const progress = document.getElementById('progress');
const localPane = document.getElementById('local-content');
const remotePane = document.getElementById('remote-content');
const conflictGutter = document.getElementById('conflict-gutter');
const explanation = document.getElementById('explanation');
const explanationLabel = document.getElementById('explanation-label');
const conflictIndicator = document.getElementById('conflict-indicator');
const actionsSelect = document.getElementById('actions-select') as HTMLSelectElement | null;
const conflictStatus = document.getElementById('conflict-status');
const resolveProgress = document.getElementById('resolve-progress');
const prevButton = document.getElementById('prev-btn') as HTMLButtonElement | null;
const nextButton = document.getElementById('next-btn') as HTMLButtonElement | null;
const finishButton = document.getElementById('finish-btn') as HTMLButtonElement | null;
const resultEditor = document.getElementById('result-editor') as HTMLTextAreaElement | null;
const resultHighlight = document.getElementById('result-highlight');
const fileSidebar = document.getElementById('file-sidebar');
const fileList = document.getElementById('file-list');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarClose = document.getElementById('sidebar-close');
const finishAllButton = document.getElementById('finish-all-btn') as HTMLButtonElement | null;

if (!resultEditor) {
  throw new Error('result editor not found');
}

let state: GuiSessionState | null = null;
let hasManualResultEdits = false;
let centerResultOnNextRender = false;

function computeHighlightRange(
  totalLines: number,
  activeConflictIndex: number,
  lineOwners: number[],
  fallbackRange: { start: number; end: number }
): { start: number; end: number } {
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

interface ConflictDiffInfo {
  range: { start: number; end: number };
  oppositeLines: Set<string>;
}

function renderCodePane(
  container: HTMLElement | null,
  content: string,
  oppositeContent: string,
  activeRange: { start: number; end: number },
  conflictDiffs: ConflictDiffInfo[]
): void {
  if (!container) return;

  const lines = content.split('\n');
  const oppositeLines = oppositeContent.split('\n');
  const oppositeSet = new Set(oppositeLines.map((l) => l.trim()));
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const lineElement = document.createElement('div');
    lineElement.className = 'code-line';
    lineElement.dataset.line = String(lineNumber);
    const trimmed = (lines[index] ?? '').trim();

    // Find which conflict range this line belongs to (if any)
    const conflict = conflictDiffs.find(
      (c) => lineNumber >= c.range.start && lineNumber <= c.range.end
    );

    const isGenuineDiff = conflict
      ? !conflict.oppositeLines.has(trimmed)  // inside conflict: differs from opposite side's conflict content
      : (trimmed !== '' && !oppositeSet.has(trimmed));  // outside conflict: not in opposite file at all

    const isInActiveRange = lineNumber >= activeRange.start && lineNumber <= activeRange.end;

    if (isGenuineDiff) {
      if (isInActiveRange) {
        lineElement.classList.add('active-line');
      } else {
        lineElement.classList.add(conflict ? 'diff-line' : 'change-line');
      }
    }
    lineElement.textContent = lines[index] ?? '';
    fragment.appendChild(lineElement);
  }

  container.replaceChildren(fragment);
}

function renderResultHighlight(
  highlight: HTMLElement | null,
  content: string,
  activeConflictIndex: number,
  lineOwners: number[]
): void {
  if (!highlight) return;

  const lines = content.split('\n');
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < lines.length; index++) {
    const lineElement = document.createElement('div');
    lineElement.className = 'code-line';
    lineElement.dataset.line = String(index + 1);

    const owner = lineOwners[index] ?? -1;
    if (owner >= 0) {
      if (owner === activeConflictIndex) {
        lineElement.classList.add('active-line');
      } else {
        lineElement.classList.add('conflict-line');
      }
    }

    lineElement.textContent = lines[index] ?? '';
    fragment.appendChild(lineElement);
  }

  highlight.replaceChildren(fragment);
}

function renderResultPane(
  editor: HTMLTextAreaElement | null,
  content: string,
  activeConflictIndex: number,
  lineOwners: number[],
  _fallbackRange: { start: number; end: number }
): void {
  if (!editor) return;

  renderResultHighlight(resultHighlight, content, activeConflictIndex, lineOwners);

  if (!hasManualResultEdits) {
    editor.value = content;
  }
}

function getArrowLabel(selectedSide: 'local' | 'remote' | 'both' | null): string {
  if (selectedSide === 'local') return '\u2190';
  if (selectedSide === 'remote') return '\u2192';
  if (selectedSide === 'both') return '\u2194';
  return '\u2190';
}

function getNextMode(selectedSide: 'local' | 'remote' | 'both' | null): 'use-local' | 'use-remote' | 'accept-both' {
  if (selectedSide === null) return 'use-local';
  if (selectedSide === 'local') return 'use-remote';
  if (selectedSide === 'remote') return 'accept-both';
  return 'use-local';
}

function updateActionButtons(block: GuiConflictBlock): void {
  if (actionsSelect) {
    actionsSelect.value = block.selectedAction ?? 'choose-left';
  }
}

function renderConflictArrow(nextState: GuiSessionState): void {
  if (!conflictGutter) return;

  const block = nextState.blocks[nextState.currentIndex];
  if (!block) {
    conflictGutter.replaceChildren();
    return;
  }

  const arrowButton = document.createElement('button');
  arrowButton.className = 'conflict-arrow active';
  arrowButton.textContent = getArrowLabel(block.selectedSide);
  arrowButton.title = `Click to toggle selection direction`;
  arrowButton.addEventListener('click', async () => {
    centerResultOnNextRender = true;
    const navigatedState = await window.mergeGuiApi.navigateTo(block.index);
    const updatedState = await window.mergeGuiApi.applyResolution({
      conflictIndex: block.index,
      mode: getNextMode(navigatedState.blocks[block.index]?.selectedSide ?? null),
    });
    render(updatedState);
  });

  conflictGutter.replaceChildren(arrowButton);
}

function scrollActiveLineToCenter(container: HTMLElement | null, instant = false): void {
  if (!container) return;
  const activeLine = container.querySelector('.active-line');
  if (!(activeLine instanceof HTMLElement)) return;
  const targetTop = Math.max(0, activeLine.offsetTop - container.clientHeight / 2 + activeLine.clientHeight / 2);
  if (instant) {
    container.scrollTop = targetTop;
  } else {
    container.scrollTo({ top: targetTop, behavior: 'smooth' });
  }
}

let sidebarInitialized = false;

function renderFileSidebar(multiFile: GuiMultiFileState | null): void {
  if (!multiFile) {
    if (fileSidebar) fileSidebar.classList.add('hidden');
    if (sidebarToggle) sidebarToggle.classList.add('hidden');
    return;
  }

  // Open sidebar by default on first render
  if (!sidebarInitialized) {
    sidebarInitialized = true;
    if (fileSidebar) fileSidebar.classList.remove('hidden');
    if (sidebarToggle) sidebarToggle.classList.add('hidden');
  }

  // Show toggle button when sidebar is closed, hide when open
  const sidebarOpen = fileSidebar && !fileSidebar.classList.contains('hidden');
  if (sidebarToggle) {
    sidebarToggle.classList.toggle('hidden', !!sidebarOpen);
  }
  if (!fileList) return;

  const fragment = document.createDocumentFragment();

  for (const file of multiFile.files) {
    const li = document.createElement('li');
    li.className = 'file-entry';
    if (file.path === multiFile.activeFilePath) li.classList.add('active');
    if (file.allResolved) li.classList.add('resolved');

    const indicator = document.createElement('span');
    indicator.className = 'file-entry-indicator';
    li.appendChild(indicator);

    const name = document.createElement('span');
    name.className = 'file-entry-name';
    name.textContent = file.path;
    name.title = file.path;
    li.appendChild(name);

    const badge = document.createElement('span');
    badge.className = 'file-entry-badge';
    badge.textContent = file.allResolved ? 'Done' : `${file.conflictCount}`;
    li.appendChild(badge);

    li.addEventListener('click', async () => {
      hasManualResultEdits = false;
      centerResultOnNextRender = true;
      if (explanation) explanation.textContent = 'Analysing conflicts...';
      const newState = await window.mergeGuiApi.switchFile(file.path);
      render(newState);
      // Generate AI for new file if needed
      if (newState.total > 0 && newState.blocks.some((b) => !b.aiResult)) {
        if (explanation) explanation.textContent = 'Analysing conflicts...';
        try {
          render(await window.mergeGuiApi.generateAllAiResolutions());
          // explanation will be set per-conflict by render()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (explanation) explanation.textContent = 'Something went wrong while analysing conflicts. Please check your API key and try again.';
        }
      }
    });

    fragment.appendChild(li);
  }

  fileList.replaceChildren(fragment);

  // Enable "Write All & Exit" when at least one file is resolved
  if (finishAllButton) {
    const anyResolved = multiFile.files.some((f) => f.allResolved);
    finishAllButton.disabled = !anyResolved;
  }
}

function assertState(): GuiSessionState {
  if (!state) {
    throw new Error('State not loaded');
  }
  return state;
}

function render(nextState: GuiSessionState): void {
  state = nextState;
  renderFileSidebar(nextState.multiFile);
  const mergedPathLabel = nextState.mergedPath;

  if (nextState.total === 0) {
    if (explanation) {
      explanation.textContent = '';
    }
    if (progress) progress.textContent = `0 / 0 \u2022 ${mergedPathLabel}`;
    if (conflictIndicator) conflictIndicator.textContent = '';
    renderCodePane(localPane, '', '', { start: 0, end: 0 }, []);
    renderCodePane(remotePane, '', '', { start: 0, end: 0 }, []);

    renderResultPane(resultEditor, '', -1, [], { start: 0, end: 0 });
    if (conflictGutter) {
      conflictGutter.replaceChildren();
    }
    if (explanation) explanation.textContent = '';
    if (explanationLabel) explanationLabel.textContent = '';
    return;
  }

  const idx = nextState.currentIndex;
  const block = nextState.blocks[idx];

  if (progress) {
    progress.textContent = mergedPathLabel;
  }

  if (conflictIndicator) {
    conflictIndicator.textContent = `${idx + 1} / ${nextState.total}`;
  }

  // Build diff info: for each conflict, collect the opposite side's lines
  // so we can avoid highlighting lines that are identical in both sides
  const localDiffs: ConflictDiffInfo[] = nextState.blocks.map((b) => ({
    range: b.localRange,
    oppositeLines: new Set(b.theirs.split('\n').map((l) => l.trim())),
  }));
  const remoteDiffs: ConflictDiffInfo[] = nextState.blocks.map((b) => ({
    range: b.remoteRange,
    oppositeLines: new Set(b.ours.split('\n').map((l) => l.trim())),
  }));
  renderCodePane(localPane, nextState.localFullContent, nextState.remoteFullContent, block.localRange, localDiffs);
  renderCodePane(remotePane, nextState.remoteFullContent, nextState.localFullContent, block.remoteRange, remoteDiffs);
  renderResultPane(
    resultEditor,
    nextState.previewContent,
    nextState.currentIndex,
    nextState.previewLineOwners,
    block.previewRange
  );

  if (explanation) {
    if (block.explanation) {
      explanation.textContent = block.explanation;
    } else if (!block.actionTaken) {
      // Keep existing message (error or "Analysing...") — don't overwrite
    }
  }

  updateActionButtons(block);

  if (prevButton) prevButton.disabled = nextState.total === 0;
  if (nextButton) nextButton.disabled = nextState.total === 0;
  // Current conflict status badge
  if (conflictStatus) {
    if (block.actionTaken) {
      conflictStatus.textContent = '✓';
      conflictStatus.className = 'conflict-status resolved';
    } else {
      conflictStatus.textContent = 'pending';
      conflictStatus.className = 'conflict-status pending';
    }
  }

  // Overall resolve progress
  const resolved = nextState.blocks.filter((b) => b.actionTaken).length;
  const pending = nextState.total - resolved;

  if (resolveProgress) {
    resolveProgress.innerHTML = `<span class="progress-count">${resolved}</span> / ${nextState.total} resolved`;
  }

  if (finishButton) {
    finishButton.disabled = pending > 0;
    finishButton.textContent = pending > 0 ? `Resolve File (${pending} pending)` : 'Resolve File';
  }
  renderConflictArrow(nextState);

  const navigating = centerResultOnNextRender;
  scrollActiveLineToCenter(localPane, navigating);
  scrollActiveLineToCenter(remotePane, navigating);

  if (navigating) {
    centerResultOnNextRender = false;
    if (resultHighlight && resultEditor) {
      const activeLine = resultHighlight.querySelector('.active-line');
      if (activeLine instanceof HTMLElement) {
        const targetTop = Math.max(
          0,
          activeLine.offsetTop - resultHighlight.clientHeight / 2 + activeLine.clientHeight / 2
        );
        resultHighlight.scrollTop = targetTop;
        resultEditor.scrollTop = targetTop;
      }
    }
  }
}

async function refresh(): Promise<void> {
  render(await window.mergeGuiApi.getState());
}

function wireActions(): void {
  prevButton?.addEventListener('click', async () => {
    const current = assertState();
    centerResultOnNextRender = true;
    const previousIndex =
      current.total === 0
        ? 0
        : (current.currentIndex - 1 + current.total) % current.total;
    render(await window.mergeGuiApi.navigateTo(previousIndex));
  });

  nextButton?.addEventListener('click', async () => {
    const current = assertState();
    centerResultOnNextRender = true;
    const nextIndex = current.total === 0 ? 0 : (current.currentIndex + 1) % current.total;
    render(await window.mergeGuiApi.navigateTo(nextIndex));
  });

  actionsSelect?.addEventListener('change', async () => {
    const current = assertState();
    centerResultOnNextRender = true;
    const action = actionsSelect.value;
    const mode =
      action === 'choose-ai'
        ? 'apply-ai'
        : action === 'choose-right'
          ? 'use-remote'
          : action === 'choose-both-left-first'
            ? 'accept-both'
            : action === 'choose-both-right-first'
              ? 'accept-both-right-first'
              : 'use-local';
    render(await window.mergeGuiApi.applyResolution({ conflictIndex: current.currentIndex, mode }));
  });

  finishButton?.addEventListener('click', async () => {
    await window.mergeGuiApi.finish(resultEditor?.value);
    // In multi-file mode, finish doesn't exit — it switches to next file
    if (state?.multiFile) {
      hasManualResultEdits = false;
      centerResultOnNextRender = true;
      const newState = await window.mergeGuiApi.getState();
      render(newState);
      if (newState.total > 0 && newState.blocks.some((b) => !b.aiResult)) {
        try {
          render(await window.mergeGuiApi.generateAllAiResolutions());
        } catch { /* handled in render */ }
      }
    }
  });

  resultEditor?.addEventListener('scroll', () => {
    if (resultHighlight) {
      resultHighlight.scrollTop = resultEditor.scrollTop;
      resultHighlight.scrollLeft = resultEditor.scrollLeft;
    }
  });

  resultEditor?.addEventListener('input', () => {
    hasManualResultEdits = true;
    const current = state;
    if (!current) return;
    const block = current.blocks[current.currentIndex];
    if (!block) return;
    renderResultPane(resultEditor, resultEditor.value, current.currentIndex, current.previewLineOwners, block.previewRange);
  });

  sidebarToggle?.addEventListener('click', () => {
    if (fileSidebar) fileSidebar.classList.remove('hidden');
    if (sidebarToggle) sidebarToggle.classList.add('hidden');
  });

  sidebarClose?.addEventListener('click', () => {
    if (fileSidebar) fileSidebar.classList.add('hidden');
    if (sidebarToggle) sidebarToggle.classList.remove('hidden');
  });

  finishAllButton?.addEventListener('click', async () => {
    await window.mergeGuiApi.finishAll();
  });
}

async function init(): Promise<void> {
  wireActions();
  centerResultOnNextRender = true;
  await refresh();

  const current = assertState();
  if (current.total === 0) return;

  const hasPending = current.blocks.some((block) => !block.aiResult);
  if (!hasPending) return;

  if (explanation) {
    explanation.textContent = 'Analysing conflicts...';
  }

  try {
    render(await window.mergeGuiApi.generateAllAiResolutions());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (explanation) {
      explanation.textContent = 'Something went wrong while analysing conflicts. Please check your API key and try again.';
    }
  }
}

void init().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (explanation) {
    explanation.textContent = 'Something went wrong while analysing conflicts. Please check your API key and try again.';
  }
  if (progress) {
    progress.textContent = 'Initialization error';
  }
  console.error(error);
});
