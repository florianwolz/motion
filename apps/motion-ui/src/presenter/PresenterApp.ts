/**
 * Presentation mode — full-screen browser runtime.
 *
 * Supports:
 *   - Keyboard / clicker navigation (Arrow, Space, B, Escape, F)
 *   - Canvas render loop via WASM engine
 *   - Preflight check before starting
 *   - BroadcastChannel for presenter-view sync (same machine)
 *   - Black screen toggle
 */

import { initEngine, createEngine, parseRenderTree, parsePreflight, parsePosition } from "../lib/engine.js";
import { isSupportedSavedDocument } from "../lib/documentState.js";
import type { EngineHandle } from "../lib/engine.js";
import { Canvas2DRenderer } from "../lib/renderer.js";
import { loadDefaultBrandPackage } from "../lib/defaultBrand.js";

let engine: EngineHandle | null = null;
let renderer: Canvas2DRenderer | null = null;
let isBlackScreen = false;

/** BroadcastChannel for syncing presenter state with a second window/tab. */
let presenterChannel: BroadcastChannel | null = null;

export async function mountPresenter(container: HTMLElement): Promise<void> {
  container.innerHTML = buildPresenterHtml();

  const canvasEl = container.querySelector<HTMLCanvasElement>("#presentation-canvas")!;
  renderer = new Canvas2DRenderer(canvasEl);

  try {
    await initEngine();
    engine = createEngine();

    // Load document: prefer URL param, then localStorage, then demo.
    await loadDocumentForPresenter();

    // Run preflight.
    runPreflight(container);

    // Open presenter sync channel.
    try {
      presenterChannel = new BroadcastChannel("motion-presenter");
    } catch {
      // BroadcastChannel not available (e.g., some private browsing modes).
    }

    // Wire keyboard navigation.
    document.addEventListener("keydown", handleKeyDown);

    // Start render loop.
    startRenderLoop(container);
  } catch (err) {
    console.error("Presenter init failed:", err);
    showOverlay(container, "❌ Engine failed to load", true);
  }
}

// ─── Document loading ────────────────────────────────────────────────────────

async function loadDocumentForPresenter(): Promise<void> {
  if (!engine) return;

  // Check for a stored document from the editor.
  const stored = localStorage.getItem("motion-current-doc");
  if (stored && isSupportedSavedDocument(stored)) {
    try {
      engine.loadDocument(stored);
      return;
    } catch {
      // Fall through to demo.
    }
  }

  // Fall back to the same demo document structure used by the editor.
  // In production this would be loaded from a URL parameter or IndexedDB.
  const { buildDemoDocumentJson } = await import("../editor/demo.js");
  engine.loadDocument(buildDemoDocumentJson());
  await loadDefaultBrandPackage(engine);
}

// ─── Preflight ────────────────────────────────────────────────────────────────

function runPreflight(container: HTMLElement): void {
  if (!engine) return;
  const report = parsePreflight(engine.runPreflight());
  const overlay = container.querySelector<HTMLElement>("#preflight-overlay");
  if (!overlay) return;

  if (report.status === "ready") {
    // Auto-dismiss preflight after 1.5 s when all checks pass.
    overlay.innerHTML = `<div class="preflight-ready">✅ Ready to present</div>`;
    setTimeout(() => { overlay.style.display = "none"; }, 1500);
  } else {
    const icon = report.status === "warning" ? "⚠️" : "❌";
    overlay.innerHTML = `
      <div class="preflight-report">
        <h2>${icon} Preflight ${report.status}</h2>
        <ul>
          ${report.checks
            .filter((c) => !c.passed)
            .map((c) => `<li class="${c.severity}">✗ ${c.message}</li>`)
            .join("")}
        </ul>
        <button id="btn-dismiss-preflight">Continue anyway →</button>
      </div>
    `;
    overlay.querySelector("#btn-dismiss-preflight")?.addEventListener("click", () => {
      overlay.style.display = "none";
    });
  }
}

// ─── Render loop ─────────────────────────────────────────────────────────────

function startRenderLoop(container: HTMLElement): void {
  function frame(ts: number) {
    if (!engine || !renderer) return;

    const canvas = container.querySelector<HTMLCanvasElement>("#presentation-canvas");
    if (!canvas) return;

    if (isBlackScreen) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      }
      requestAnimationFrame(frame);
      return;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio ?? 1;
    engine.setViewport(w, h, dpr);

    const treeJson = engine.render(ts);
    const tree = parseRenderTree(treeJson);
    if (tree) renderer.draw(tree);

    updatePositionIndicator(container);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ─── Navigation ──────────────────────────────────────────────────────────────

function handleKeyDown(event: KeyboardEvent): void {
  if (!engine) return;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
    case " ":
      event.preventDefault();
      engine.nextStep();
      broadcastPosition();
      break;
    case "ArrowLeft":
    case "ArrowUp":
      event.preventDefault();
      engine.previousStep();
      broadcastPosition();
      break;
    case "r":
    case "R":
      engine.restartScene();
      broadcastPosition();
      break;
    case "b":
    case "B":
      isBlackScreen = !isBlackScreen;
      break;
    case "f":
    case "F":
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => undefined);
      } else {
        document.exitFullscreen().catch(() => undefined);
      }
      break;
    case "Escape":
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined);
      }
      break;
  }
}

function broadcastPosition(): void {
  if (!engine || !presenterChannel) return;
  presenterChannel.postMessage({ type: "position", position: engine.getPosition() });
}

function updatePositionIndicator(container: HTMLElement): void {
  if (!engine) return;
  const pos = parsePosition(engine.getPosition());
  const el = container.querySelector<HTMLElement>("#position-indicator");
  if (el) {
    const step = pos.step_idx !== null ? `Step ${pos.step_idx + 1}` : "Intro";
    el.textContent = `Scene ${pos.scene_idx + 1} — ${step}`;
  }
}

// ─── Overlay helper ───────────────────────────────────────────────────────────

function showOverlay(container: HTMLElement, message: string, isError: boolean): void {
  const overlay = container.querySelector<HTMLElement>("#preflight-overlay");
  if (overlay) {
    overlay.innerHTML = `<div class="${isError ? "preflight-error" : "preflight-ready"}">${message}</div>`;
    overlay.style.display = "flex";
  }
}

// ─── Shell HTML ───────────────────────────────────────────────────────────────

function buildPresenterHtml(): string {
  return `
    <div class="presenter-shell">
      <canvas id="presentation-canvas"></canvas>
      <div id="preflight-overlay" class="preflight-overlay">
        <div class="preflight-ready">🔍 Running preflight…</div>
      </div>
      <div id="position-indicator" class="position-indicator"></div>
      <div class="presenter-hints">
        <span>← → Navigate</span>
        <span>B Black screen</span>
        <span>F Fullscreen</span>
        <span>R Restart scene</span>
      </div>
    </div>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #000; overflow: hidden; }
      .presenter-shell { position: relative; width: 100vw; height: 100vh; }
      #presentation-canvas { width: 100vw; height: 100vh; display: block; }
      .preflight-overlay {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.85);
        z-index: 100;
        font-family: system-ui, sans-serif;
        color: #e0e0e0;
      }
      .preflight-ready { font-size: 24px; font-weight: 500; }
      .preflight-error { font-size: 20px; color: #ff6b6b; }
      .preflight-report { max-width: 480px; text-align: center; }
      .preflight-report h2 { font-size: 22px; margin-bottom: 16px; }
      .preflight-report ul { list-style: none; margin-bottom: 20px; font-size: 14px; }
      .preflight-report li.error { color: #ff6b6b; }
      .preflight-report li.warning { color: #ffd93d; }
      .preflight-report button { padding: 10px 24px; background: #EC6602; border: none; border-radius: 6px; color: #fff; font-size: 15px; cursor: pointer; }
      .position-indicator {
        position: absolute; bottom: 16px; right: 20px;
        font-family: system-ui, sans-serif; font-size: 12px;
        color: rgba(255,255,255,0.35); pointer-events: none; z-index: 10;
      }
      .presenter-hints {
        position: absolute; bottom: 16px; left: 20px;
        display: flex; gap: 16px;
        font-family: system-ui, sans-serif; font-size: 11px;
        color: rgba(255,255,255,0.2); pointer-events: none; z-index: 10;
      }
    </style>
  `;
}
