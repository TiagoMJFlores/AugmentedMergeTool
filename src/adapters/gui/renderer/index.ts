type MonacoEditor = {
  getValue: () => string;
  setValue: (value: string) => void;
};

interface GuiConflictBlock {
  localRange: { start: number; end: number };
  remoteRange: { start: number; end: number };
  ours: string;
  theirs: string;
  aiResult: string;
  explanation: string;
  appliedResolution: string | null;
  actionTaken: boolean;
  selectedSide: 'local' | 'remote' | 'both' | null;
}

interface GuiSessionState {
  mergedPath: string;
  total: number;
  currentIndex: number;
  complete: boolean;
  localFullContent: string;
  remoteFullContent: string;
  blocks: GuiConflictBlock[];
}

const progress = document.getElementById('progress');
const localPane = document.getElementById('local-content');
const remotePane = document.getElementById('remote-content');
const selectionArrowButton = document.getElementById('selection-arrow-btn') as HTMLButtonElement | null;
const explanation = document.getElementById('explanation');
const status = document.getElementById('status');
const prevButton = document.getElementById('prev-btn') as HTMLButtonElement | null;
const nextButton = document.getElementById('next-btn') as HTMLButtonElement | null;
const resolveButton = document.getElementById('resolve-btn') as HTMLButtonElement | null;
const applyButton = document.getElementById('apply-btn') as HTMLButtonElement | null;
const skipButton = document.getElementById('skip-btn') as HTMLButtonElement | null;
const finishButton = document.getElementById('finish-btn') as HTMLButtonElement | null;
const editorContainer = document.getElementById('editor');

if (!editorContainer) {
  throw new Error('editor container not found');
}
const editorRoot = editorContainer;

let editor: MonacoEditor;
let state: GuiSessionState | null = null;

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

function updateSelectionArrow(nextState: GuiSessionState): void {
  if (!selectionArrowButton) return;
  const block = nextState.blocks[nextState.currentIndex];
  if (!block || block.selectedSide === null || block.selectedSide === 'local') {
    selectionArrowButton.textContent = '➡️';
    selectionArrowButton.title = 'Selecionar lado esquerdo (LOCAL)';
    return;
  }
  if (block.selectedSide === 'remote') {
    selectionArrowButton.textContent = '⬅️';
    selectionArrowButton.title = 'Selecionar lado direito (REMOTE)';
    return;
  }
  selectionArrowButton.textContent = '↔️';
  selectionArrowButton.title = 'Selecionar ambos os lados';
}

function scrollActiveLineToCenter(container: HTMLElement | null): void {
  if (!container) return;
  const activeLine = container.querySelector('.active-line');
  if (!activeLine) return;
  activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function createFallbackEditor(): MonacoEditor {
  const textarea = document.createElement('textarea');
  textarea.id = 'ai-fallback-editor';
  textarea.style.width = '100%';
  textarea.style.height = '100%';
  textarea.style.background = '#000f2e';
  textarea.style.color = '#e5e7eb';
  textarea.style.border = '1px solid #334155';
  textarea.style.padding = '12px';
  textarea.style.resize = 'none';
  editorRoot.replaceChildren(textarea);

  return {
    getValue: () => textarea.value,
    setValue: (value: string) => {
      textarea.value = value;
    },
  };
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
    if (progress) progress.textContent = `0 / 0 • ${mergedPathLabel}`;
    renderCodePane(localPane, '', '', { start: 0, end: 0 });
    renderCodePane(remotePane, '', '', { start: 0, end: 0 });
    if (explanation) explanation.textContent = 'Open a file that still contains Git conflict markers.';
    editor.setValue('');
    return;
  }

  const block = nextState.blocks[nextState.currentIndex];
  if (progress) {
    progress.textContent = `Conflict ${nextState.currentIndex + 1} of ${nextState.total} • ${mergedPathLabel}`;
  }

  renderCodePane(localPane, nextState.localFullContent, nextState.remoteFullContent, block.localRange);
  renderCodePane(remotePane, nextState.remoteFullContent, nextState.localFullContent, block.remoteRange);
  if (explanation) explanation.textContent = block.explanation || 'Generate AI to view explanation.';

  editor.setValue(block.appliedResolution ?? block.aiResult);

  if (status) {
    status.textContent = block.actionTaken ? 'Action recorded for this conflict.' : 'Pending action.';
  }

  if (prevButton) prevButton.disabled = nextState.currentIndex === 0;
  if (nextButton) nextButton.disabled = nextState.currentIndex === nextState.total - 1;
  if (finishButton) finishButton.disabled = !nextState.complete;
  updateSelectionArrow(nextState);
  scrollActiveLineToCenter(localPane);
  scrollActiveLineToCenter(remotePane);
}

async function refresh(): Promise<void> {
  render(await window.mergeGuiApi.getState());
}

function wireActions(): void {
  prevButton?.addEventListener('click', async () => {
    const current = assertState();
    render(await window.mergeGuiApi.navigateTo(current.currentIndex - 1));
  });

  nextButton?.addEventListener('click', async () => {
    const current = assertState();
    render(await window.mergeGuiApi.navigateTo(current.currentIndex + 1));
  });

  resolveButton?.addEventListener('click', async () => {
    const current = assertState();
    render(await window.mergeGuiApi.generateAiResolution({ conflictIndex: current.currentIndex }));
  });

  applyButton?.addEventListener('click', async () => {
    const current = assertState();
    render(
      await window.mergeGuiApi.applyResolution({
        conflictIndex: current.currentIndex,
        mode: 'apply-ai',
        editedResolution: editor.getValue(),
      })
    );
  });

  skipButton?.addEventListener('click', async () => {
    const current = assertState();
    render(await window.mergeGuiApi.applyResolution({ conflictIndex: current.currentIndex, mode: 'skip' }));
  });

  selectionArrowButton?.addEventListener('click', async () => {
    const current = assertState();
    const block = current.blocks[current.currentIndex];
    const currentSelection = block?.selectedSide;
    const nextMode =
      currentSelection === null
        ? 'use-local'
        : currentSelection === 'local'
        ? 'use-remote'
        : currentSelection === 'remote'
          ? 'accept-both'
          : 'use-local';
    render(
      await window.mergeGuiApi.applyResolution({
        conflictIndex: current.currentIndex,
        mode: nextMode,
      })
    );
  });

  finishButton?.addEventListener('click', async () => {
    await window.mergeGuiApi.finish();
  });
}

async function init(): Promise<void> {
  editor = createFallbackEditor();

  wireActions();
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
