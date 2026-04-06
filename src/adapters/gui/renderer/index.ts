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
    | 'choose-left'
    | 'choose-right'
    | 'choose-both-left-first'
    | 'choose-both-right-first'
    | null;
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
}

const progress = document.getElementById('progress');
const localPane = document.getElementById('local-content');
const remotePane = document.getElementById('remote-content');
const conflictGutter = document.getElementById('conflict-gutter');
const explanation = document.getElementById('explanation');
const explanationLabel = document.getElementById('explanation-label');
const conflictIndicator = document.getElementById('conflict-indicator');
const status = document.getElementById('status');
const actionsSelect = document.getElementById('actions-select') as HTMLSelectElement | null;
const prevButton = document.getElementById('prev-btn') as HTMLButtonElement | null;
const nextButton = document.getElementById('next-btn') as HTMLButtonElement | null;
const resolveButton = document.getElementById('resolve-btn') as HTMLButtonElement | null;
const finishButton = document.getElementById('finish-btn') as HTMLButtonElement | null;
const resultEditor = document.getElementById('result-editor') as HTMLTextAreaElement | null;
const resultHighlight = document.getElementById('result-highlight');

if (!resultEditor) {
  throw new Error('result editor not found');
}

let state: GuiSessionState | null = null;
let syncingScroll = false;
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

function renderCodePane(
  container: HTMLElement | null,
  content: string,
  oppositeContent: string,
  activeRange: { start: number; end: number }
): void {
  if (!container) return;

  const lines = content.split('\n');
  const oppositeLines = oppositeContent.split('\n');
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const lineElement = document.createElement('div');
    lineElement.className = 'code-line';
    lineElement.dataset.line = String(lineNumber);
    if ((oppositeLines[index] ?? '') !== (lines[index] ?? '')) {
      lineElement.classList.add('diff-line');
    }
    if (lineNumber >= activeRange.start && lineNumber <= activeRange.end) {
      lineElement.classList.add('active-line');
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

function renderConflictArrows(nextState: GuiSessionState): void {
  if (!conflictGutter || !localPane) return;
  const gutterInner = document.createElement('div');
  gutterInner.className = 'conflict-gutter-inner';
  gutterInner.style.height = `${localPane.scrollHeight}px`;
  const firstLine = localPane.querySelector('.code-line') as HTMLElement | null;
  const lineHeight =
    firstLine?.getBoundingClientRect().height || Number.parseFloat(getComputedStyle(localPane).lineHeight) || 20;

  for (const block of nextState.blocks) {
    const arrowButton = document.createElement('button');
    arrowButton.className = `conflict-arrow${block.index === nextState.currentIndex ? ' active' : ''}`;
    arrowButton.textContent = getArrowLabel(block.selectedSide);
    arrowButton.title = `Conflict ${block.index + 1}: click to toggle selection direction`;
    arrowButton.setAttribute('aria-label', `Conflict ${block.index + 1} selector`);

    const midpointLine = Math.floor((block.localRange.start + block.localRange.end) / 2);
    const topOffset = Math.max(0, (midpointLine - 1) * lineHeight);
    arrowButton.style.top = `${Math.max(0, topOffset)}px`;
    arrowButton.addEventListener('click', async () => {
      centerResultOnNextRender = true;
      const navigatedState = await window.mergeGuiApi.navigateTo(block.index);
      const updatedState = await window.mergeGuiApi.applyResolution({
        conflictIndex: block.index,
        mode: getNextMode(navigatedState.blocks[block.index]?.selectedSide ?? null),
      });
      render(updatedState);
    });
    gutterInner.appendChild(arrowButton);
  }

  conflictGutter.replaceChildren(gutterInner);
}

function syncPaneScroll(source: HTMLElement): void {
  if (syncingScroll) return;
  syncingScroll = true;
  const top = source.scrollTop;
  if (localPane && source !== localPane) {
    localPane.scrollTop = top;
  }
  if (remotePane && source !== remotePane) {
    remotePane.scrollTop = top;
  }
  if (conflictGutter) {
    conflictGutter.scrollTop = top;
  }
  syncingScroll = false;
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

function assertState(): GuiSessionState {
  if (!state) {
    throw new Error('State not loaded');
  }
  return state;
}

function render(nextState: GuiSessionState): void {
  state = nextState;
  const mergedPathLabel = nextState.mergedPath;

  if (nextState.total === 0) {
    if (status) {
      status.textContent = `No conflict markers found in MERGED file: ${nextState.mergedPath}`;
    }
    if (progress) progress.textContent = `0 / 0 \u2022 ${mergedPathLabel}`;
    if (conflictIndicator) conflictIndicator.textContent = '';
    renderCodePane(localPane, '', '', { start: 0, end: 0 });
    renderCodePane(remotePane, '', '', { start: 0, end: 0 });
    renderResultPane(resultEditor, '', -1, [], { start: 0, end: 0 });
    if (conflictGutter) {
      conflictGutter.replaceChildren();
    }
    if (explanation) explanation.textContent = 'Open a file that still contains Git conflict markers.';
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

  renderCodePane(localPane, nextState.localFullContent, nextState.remoteFullContent, block.localRange);
  renderCodePane(remotePane, nextState.remoteFullContent, nextState.localFullContent, block.remoteRange);
  renderResultPane(
    resultEditor,
    nextState.previewContent,
    nextState.currentIndex,
    nextState.previewLineOwners,
    block.previewRange
  );

  if (explanationLabel) {
    explanationLabel.textContent = `Conflict ${idx + 1} of ${nextState.total}`;
  }
  if (explanation) {
    explanation.textContent = block.explanation || 'Generating AI explanation...';
  }

  if (status) {
    status.textContent = block.actionTaken ? 'AI resolution applied.' : 'Pending AI resolution...';
  }
  updateActionButtons(block);

  if (prevButton) prevButton.disabled = nextState.total === 0;
  if (nextButton) nextButton.disabled = nextState.total === 0;
  if (finishButton) finishButton.disabled = !nextState.complete;
  renderConflictArrows(nextState);

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
    // Sync gutter after all panes have scrolled instantly
    if (conflictGutter && localPane) {
      conflictGutter.scrollTop = localPane.scrollTop;
    }
  } else if (localPane) {
    queueMicrotask(() => syncPaneScroll(localPane));
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

  resolveButton?.addEventListener('click', async () => {
    const current = assertState();
    centerResultOnNextRender = true;
    render(await window.mergeGuiApi.generateAiResolution({ conflictIndex: current.currentIndex }));
  });

  actionsSelect?.addEventListener('change', async () => {
    const current = assertState();
    centerResultOnNextRender = true;
    const action = actionsSelect.value;
    const mode =
      action === 'choose-right'
        ? 'use-remote'
        : action === 'choose-both-left-first'
          ? 'accept-both'
          : action === 'choose-both-right-first'
            ? 'accept-both-right-first'
            : 'use-local';
    render(await window.mergeGuiApi.applyResolution({ conflictIndex: current.currentIndex, mode }));
  });

  localPane?.addEventListener('scroll', () => syncPaneScroll(localPane));
  remotePane?.addEventListener('scroll', () => syncPaneScroll(remotePane));
  finishButton?.addEventListener('click', async () => {
    await window.mergeGuiApi.finish(resultEditor?.value);
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
    renderResultPane(resultEditor, resultEditor.value, current.currentIndex, [], block.previewRange);
  });
}

async function init(): Promise<void> {
  wireActions();
  centerResultOnNextRender = true;
  await refresh();

  const current = assertState();
  const currentBlock = current.blocks[current.currentIndex];
  if (current.total > 0 && currentBlock && !currentBlock.aiResult) {
    if (status) {
      status.textContent = 'Generating initial AI suggestion...';
    }
    try {
      render(await window.mergeGuiApi.generateAiResolution({ conflictIndex: current.currentIndex }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (status) {
        status.textContent = `Could not generate initial AI suggestion: ${message}`;
      }
    }
  }
}

void init().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (status) {
    status.textContent = `Failed to initialize GUI: ${message}`;
  }
  if (progress) {
    progress.textContent = 'Initialization error';
  }
  console.error(error);
});
