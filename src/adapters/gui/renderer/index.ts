type MonacoEditor = {
  getValue: () => string;
  setValue: (value: string) => void;
};

interface GuiConflictBlock {
  ours: string;
  theirs: string;
  aiResult: string;
  explanation: string;
  appliedResolution: string | null;
  actionTaken: boolean;
}

interface GuiSessionState {
  mergedPath: string;
  total: number;
  currentIndex: number;
  complete: boolean;
  blocks: GuiConflictBlock[];
}

const progress = document.getElementById('progress');
const localInput = document.getElementById('local-content') as HTMLTextAreaElement | null;
const remoteInput = document.getElementById('remote-content') as HTMLTextAreaElement | null;
const explanation = document.getElementById('explanation');
const status = document.getElementById('status');
const prevButton = document.getElementById('prev-btn') as HTMLButtonElement | null;
const nextButton = document.getElementById('next-btn') as HTMLButtonElement | null;
const resolveButton = document.getElementById('resolve-btn') as HTMLButtonElement | null;
const applyButton = document.getElementById('apply-btn') as HTMLButtonElement | null;
const skipButton = document.getElementById('skip-btn') as HTMLButtonElement | null;
const localButton = document.getElementById('use-local-btn') as HTMLButtonElement | null;
const remoteButton = document.getElementById('use-remote-btn') as HTMLButtonElement | null;
const finishButton = document.getElementById('finish-btn') as HTMLButtonElement | null;
const editorContainer = document.getElementById('editor');

if (!editorContainer) {
  throw new Error('editor container not found');
}
const editorRoot = editorContainer;

let editor: MonacoEditor;
let state: GuiSessionState | null = null;

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
    if (localInput) localInput.value = '';
    if (remoteInput) remoteInput.value = '';
    if (explanation) explanation.textContent = 'Open a file that still contains Git conflict markers.';
    editor.setValue('');
    return;
  }

  const block = nextState.blocks[nextState.currentIndex];
  if (progress) {
    progress.textContent = `Conflict ${nextState.currentIndex + 1} of ${nextState.total} • ${mergedPathLabel}`;
  }

  if (localInput) localInput.value = block.ours;
  if (remoteInput) remoteInput.value = block.theirs;
  if (explanation) explanation.textContent = block.explanation || 'Generate AI to view explanation.';

  editor.setValue(block.appliedResolution ?? block.aiResult);

  if (status) {
    status.textContent = block.actionTaken ? 'Action recorded for this conflict.' : 'Pending action.';
  }

  if (prevButton) prevButton.disabled = nextState.currentIndex === 0;
  if (nextButton) nextButton.disabled = nextState.currentIndex === nextState.total - 1;
  if (finishButton) finishButton.disabled = !nextState.complete;
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

  localButton?.addEventListener('click', async () => {
    const current = assertState();
    render(await window.mergeGuiApi.applyResolution({ conflictIndex: current.currentIndex, mode: 'use-local' }));
  });

  remoteButton?.addEventListener('click', async () => {
    const current = assertState();
    render(await window.mergeGuiApi.applyResolution({ conflictIndex: current.currentIndex, mode: 'use-remote' }));
  });

  finishButton?.addEventListener('click', async () => {
    await window.mergeGuiApi.finish();
  });
}

async function init(): Promise<void> {
  editor = createFallbackEditor();

  wireActions();
  await refresh();
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
