/**
 * Presenter notes view — a dedicated second-tab/window UI for the presenter.
 *
 * Shows:
 *   - Current scene name + step indicator
 *   - Step notes (for the speaker)
 *   - Scene notes
 *   - "Next up" label (next step or next scene)
 *   - Elapsed timer
 *   - Progress bar
 *
 * Receives state via BroadcastChannel("motion-presenter") from the main
 * presenter window.  Falls back to polling localStorage if BroadcastChannel
 * is unavailable.
 */

import { parsePresenterState } from "../lib/engine.js";
import type { PresenterState } from "../lib/engine.js";
import {
  PRESENTER_CHANNEL_NAME,
  PRESENTER_STATE_STORAGE_KEY,
  readStoredPresenterState,
} from "./runtime.js";

let timerStart: number | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let lastState: PresenterState | null = null;
let statePollInterval: ReturnType<typeof setInterval> | null = null;

export function mountPresenterView(container: HTMLElement): void {
  container.innerHTML = buildViewHtml();
  wireTimerControls(container);
  startTimer(container);
  subscribeToPresenterChannel(container);
  // Show a placeholder until first update arrives.
  renderState(container, makeEmptyState());
}

// ─── BroadcastChannel subscription ────────────────────────────────────────────

function subscribeToPresenterChannel(container: HTMLElement): void {
  try {
    const channel = new BroadcastChannel(PRESENTER_CHANNEL_NAME);
    channel.addEventListener("message", (event: MessageEvent) => {
      const msg = event.data as { type: string; state?: string };
      if (msg.type === "presenter_state" && msg.state) {
        const state = parsePresenterState(msg.state);
        lastState = state;
        renderState(container, state);
      }
    });
    channel.postMessage({ type: "presenter_view_ready" });
    channel.postMessage({ type: "presenter_state_request" });
  } catch {
    // BroadcastChannel unavailable — nothing to do.
  }
  startStoragePolling(container);
}

function startStoragePolling(container: HTMLElement): void {
  const refreshFromStorage = () => {
    const state = readStoredPresenterState(localStorage.getItem(PRESENTER_STATE_STORAGE_KEY));
    if (!state) return;
    if (JSON.stringify(lastState) === JSON.stringify(state)) return;
    lastState = state;
    renderState(container, state);
  };
  refreshFromStorage();
  if (statePollInterval) clearInterval(statePollInterval);
  statePollInterval = setInterval(refreshFromStorage, 500);
}

// ─── State rendering ──────────────────────────────────────────────────────────

function renderState(container: HTMLElement, state: PresenterState): void {
  const sceneEl = container.querySelector<HTMLElement>("#pv-scene-name");
  const posEl = container.querySelector<HTMLElement>("#pv-position");
  const progressEl = container.querySelector<HTMLElement>("#pv-progress-fill");
  const stepNotesEl = container.querySelector<HTMLElement>("#pv-step-notes");
  const sceneNotesEl = container.querySelector<HTMLElement>("#pv-scene-notes");
  const nextEl = container.querySelector<HTMLElement>("#pv-next-label");

  if (sceneEl) sceneEl.textContent = state.scene_name || "Untitled";

  // Position string: "Scene 2 / 5  ·  Step 3 / 8"
  const scenePos = `Scene ${state.scene_idx + 1} / ${state.scene_count || "?"}`;
  const stepPos = state.step_idx !== null
    ? `Step ${state.step_idx + 1} / ${state.step_count || "?"}`
    : "Intro";
  if (posEl) posEl.textContent = `${scenePos}  ·  ${stepPos}`;

  // Progress bar: steps within scene.
  if (progressEl) {
    const pct = state.step_count > 0 && state.step_idx !== null
      ? ((state.step_idx + 1) / state.step_count) * 100
      : 0;
    (progressEl as HTMLElement).style.width = `${pct}%`;
  }

  // Notes.
  if (stepNotesEl) {
    if (state.step_notes) {
      stepNotesEl.textContent = state.step_notes;
      stepNotesEl.style.display = "";
    } else {
      stepNotesEl.textContent = "—";
      stepNotesEl.style.display = "";
    }
  }
  if (sceneNotesEl) {
    if (state.scene_notes) {
      sceneNotesEl.textContent = state.scene_notes;
      const section = sceneNotesEl.closest<HTMLElement>(".pv-section");
      if (section) section.style.display = "";
    } else {
      const section = sceneNotesEl.closest<HTMLElement>(".pv-section");
      if (section) section.style.display = "none";
    }
  }

  // Next up.
  if (nextEl) nextEl.textContent = state.next_label || "End of presentation";
}

function makeEmptyState(): PresenterState {
  return {
    scene_idx: 0,
    step_idx: null,
    scene_name: "Waiting for presenter…",
    scene_notes: "",
    scene_count: 0,
    step_name: "",
    step_notes: "",
    step_count: 0,
    next_label: "",
  };
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer(container: HTMLElement): void {
  timerStart = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const timerEl = container.querySelector<HTMLElement>("#pv-timer");
    if (!timerEl || timerStart === null) return;
    timerEl.textContent = formatElapsed(timerStart);
  }, 1000);
}

function wireTimerControls(container: HTMLElement): void {
  container.querySelector("#pv-btn-reset-timer")?.addEventListener("click", () => {
    timerStart = Date.now();
  });
}

function formatElapsed(start: number): string {
  const totalSec = Math.floor((Date.now() - start) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ─── Shell HTML ───────────────────────────────────────────────────────────────

function buildViewHtml(): string {
  return `
    <div class="pv-shell">
      <header class="pv-header">
        <div class="pv-title-row">
          <span id="pv-scene-name" class="pv-scene-name">—</span>
          <div class="pv-header-right">
            <span id="pv-timer" class="pv-timer">00:00</span>
            <button id="pv-btn-reset-timer" class="pv-btn-small">↺ Reset</button>
          </div>
        </div>
        <div class="pv-progress-bar">
          <div id="pv-progress-fill" class="pv-progress-fill" style="width:0%"></div>
        </div>
        <div id="pv-position" class="pv-position">—</div>
      </header>

      <main class="pv-main">
        <section class="pv-section">
          <div class="pv-section-label">Speaker notes</div>
          <div id="pv-step-notes" class="pv-notes pv-step-notes">—</div>
        </section>

        <section class="pv-section" id="pv-scene-notes-section">
          <div class="pv-section-label">Scene notes</div>
          <div id="pv-scene-notes" class="pv-notes pv-scene-notes"></div>
        </section>

        <section class="pv-section pv-next-section">
          <div class="pv-section-label">Next up</div>
          <div id="pv-next-label" class="pv-next-label">—</div>
        </section>
      </main>
    </div>

    <style>
      :root { color-scheme: dark; }
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: system-ui, -apple-system, sans-serif;
        background: #111;
        color: #e0e0e0;
        height: 100vh;
        overflow: hidden;
      }
      .pv-shell { display: flex; flex-direction: column; height: 100vh; }
      .pv-header {
        background: #1a1a1e;
        border-bottom: 1px solid #2a2a2e;
        padding: 16px 20px 12px;
        flex-shrink: 0;
      }
      .pv-title-row {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 10px;
      }
      .pv-scene-name {
        font-size: 22px; font-weight: 600; color: #f0f0f0;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        max-width: 60%;
      }
      .pv-header-right { display: flex; align-items: center; gap: 12px; }
      .pv-timer {
        font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums;
        color: #EC6602; letter-spacing: 1px;
      }
      .pv-btn-small {
        background: #2a2a2e; border: 1px solid #3a3a3e; border-radius: 4px;
        color: #9ca3af; font-size: 12px; padding: 4px 10px; cursor: pointer;
      }
      .pv-btn-small:hover { background: #333; }
      .pv-progress-bar {
        height: 4px; background: #2a2a2e; border-radius: 2px; margin-bottom: 10px;
        overflow: hidden;
      }
      .pv-progress-fill {
        height: 100%; background: #EC6602; border-radius: 2px;
        transition: width 0.3s ease;
      }
      .pv-position { font-size: 13px; color: #6b7280; }
      .pv-main {
        flex: 1; overflow-y: auto; padding: 20px;
        display: flex; flex-direction: column; gap: 20px;
      }
      .pv-section { display: flex; flex-direction: column; gap: 8px; }
      .pv-section-label {
        font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
        text-transform: uppercase; color: #6b7280;
      }
      .pv-notes {
        font-size: 17px; line-height: 1.65; color: #e0e0e0;
        white-space: pre-wrap;
      }
      .pv-step-notes { font-size: 19px; }
      .pv-next-section {
        background: #1a1a1e; border: 1px solid #2a2a2e; border-radius: 8px;
        padding: 14px 16px;
      }
      .pv-next-label {
        font-size: 16px; color: #9ca3af; font-style: italic;
      }
    </style>
  `;
}
