/**
 * Authoring mode — Figma-like editor shell.
 *
 * Regions:
 *   - Canvas (custom renderer via WASM)
 *   - Layers panel
 *   - Properties inspector
 *   - Timeline / steps panel
 *   - Assets panel
 *   - Preflight / validation panel
 */

import { initEngine, createEngine, parseRenderTree, parsePreflight, parseSceneList } from "../lib/engine.js";
import type { EngineHandle } from "../lib/engine.js";
import { Canvas2DRenderer } from "../lib/renderer.js";
import { buildDemoDocumentJson } from "./demo.js";

let engine: EngineHandle | null = null;
let renderer: Canvas2DRenderer | null = null;

export async function mountEditor(container: HTMLElement): Promise<void> {
  container.innerHTML = buildShellHtml();

  const canvasEl = container.querySelector<HTMLCanvasElement>("#editor-canvas")!;
  renderer = new Canvas2DRenderer(canvasEl);

  try {
    await initEngine();
    engine = createEngine();

    // Load a demo document so the canvas is not empty.
    loadDemoDocument();

    // Wire toolbar buttons.
    wireToolbar(container);

    // Start render loop.
    startRenderLoop();
  } catch (err) {
    console.error("Failed to initialize WASM engine:", err);
    showEngineError(container, err);
  }
}

// ─── Demo document ─────────────────────────────────────────────────────────

function loadDemoDocument(): void {
  if (!engine) return;
  engine.loadDocument(buildDemoDocumentJson());
  refreshSceneList();
}

// ─── Render loop ────────────────────────────────────────────────────────────

function startRenderLoop(): void {
  function frame(ts: number) {
    if (!engine || !renderer) return;

    const canvas = document.querySelector<HTMLCanvasElement>("#editor-canvas");
    if (!canvas) return;

    const w = canvas.clientWidth || 960;
    const h = canvas.clientHeight || 540;
    const dpr = window.devicePixelRatio ?? 1;
    engine.setViewport(w, h, dpr);

    const treeJson = engine.render(ts);
    const tree = parseRenderTree(treeJson);
    if (tree) renderer.draw(tree);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ─── Toolbar actions ────────────────────────────────────────────────────────

function wireToolbar(container: HTMLElement): void {
  container.querySelector("#btn-undo")?.addEventListener("click", () => engine?.undo());
  container.querySelector("#btn-redo")?.addEventListener("click", () => engine?.redo());
  container.querySelector("#btn-preflight")?.addEventListener("click", () => showPreflight(container));
  container.querySelector("#btn-present")?.addEventListener("click", () => {
    window.open("/present", "_blank");
  });
}

function showPreflight(container: HTMLElement): void {
  if (!engine) return;
  const report = parsePreflight(engine.runPreflight());
  const el = container.querySelector("#preflight-panel");
  if (!el) return;
  const icon = report.status === "ready" ? "✅" : report.status === "warning" ? "⚠️" : "❌";
  el.innerHTML = `
    <strong>${icon} Preflight ${report.status}</strong>
    <ul>
      ${report.checks
        .map(
          (c) =>
            `<li class="${c.passed ? "ok" : c.severity}">${c.passed ? "✓" : "✗"} ${c.message}</li>`
        )
        .join("")}
    </ul>
  `;
  (el as HTMLElement).style.display = "block";
}

function refreshSceneList(): void {
  if (!engine) return;
  const scenes = parseSceneList(engine.listScenes());
  const el = document.querySelector("#scene-list");
  if (!el) return;
  el.innerHTML = scenes
    .map(
      (s, i) =>
        `<li class="scene-item" data-id="${s.id}" data-idx="${i}">
          ${s.name} <span class="step-count">(${s.step_count} steps)</span>
        </li>`
    )
    .join("");
  el.querySelectorAll(".scene-item").forEach((item) => {
    item.addEventListener("click", () => {
      engine?.jumpToScene((item as HTMLElement).dataset.id ?? "");
    });
  });
}

// ─── Error display ──────────────────────────────────────────────────────────

function showEngineError(container: HTMLElement, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const banner = container.querySelector<HTMLElement>("#engine-error");
  if (banner) {
    banner.textContent = `⚠ Engine unavailable: ${msg}`;
    banner.style.display = "block";
  }
}

// ─── Shell HTML ─────────────────────────────────────────────────────────────

function buildShellHtml(): string {
  return `
    <div class="editor-shell">
      <header class="editor-toolbar">
        <span class="editor-logo">Motion</span>
        <div class="toolbar-actions">
          <button id="btn-undo" title="Undo (Ctrl+Z)">↩ Undo</button>
          <button id="btn-redo" title="Redo (Ctrl+Shift+Z)">↪ Redo</button>
          <button id="btn-preflight" title="Run preflight checks">🔍 Preflight</button>
          <button id="btn-present" title="Open presentation mode">▶ Present</button>
        </div>
        <div id="engine-error" class="engine-error" style="display:none"></div>
      </header>
      <main class="editor-main">
        <aside class="editor-layers">
          <h3>Scenes</h3>
          <ul id="scene-list"></ul>
        </aside>
        <section class="editor-canvas-wrap" id="canvas-container">
          <canvas id="editor-canvas"></canvas>
        </section>
        <aside class="editor-inspector">
          <h3>Inspector</h3>
          <div id="preflight-panel" class="preflight-panel" style="display:none"></div>
          <p class="inspector-hint">Select a node to inspect its properties.</p>
        </aside>
      </main>
      <footer class="editor-timeline">
        <span>Steps / Timeline</span>
      </footer>
    </div>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #0d0d0f; color: #e0e0e0; font-family: system-ui, sans-serif; font-size: 13px; }
      .editor-shell { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
      .editor-toolbar { display: flex; align-items: center; gap: 12px; padding: 6px 12px; background: #1a1a1e; border-bottom: 1px solid #2a2a2e; flex-shrink: 0; }
      .editor-logo { font-weight: 700; font-size: 15px; color: #EC6602; margin-right: 8px; }
      .toolbar-actions { display: flex; gap: 6px; }
      .toolbar-actions button { padding: 4px 10px; background: #2a2a2e; border: 1px solid #3a3a3e; border-radius: 4px; color: #e0e0e0; cursor: pointer; font-size: 12px; }
      .toolbar-actions button:hover { background: #3a3a3e; }
      .engine-error { flex: 1; text-align: right; color: #ff6b6b; font-size: 12px; }
      .editor-main { display: flex; flex: 1; overflow: hidden; }
      .editor-layers { width: 200px; background: #161618; border-right: 1px solid #2a2a2e; padding: 10px; overflow-y: auto; flex-shrink: 0; }
      .editor-layers h3, .editor-inspector h3 { font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 8px; letter-spacing: 0.5px; }
      .scene-item { padding: 6px 8px; border-radius: 4px; cursor: pointer; list-style: none; }
      .scene-item:hover { background: #2a2a2e; }
      .step-count { color: #666; font-size: 11px; }
      .editor-canvas-wrap { flex: 1; background: #111113; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; }
      #editor-canvas { max-width: 100%; max-height: 100%; object-fit: contain; display: block; border: 1px solid #2a2a2e; }
      .editor-inspector { width: 240px; background: #161618; border-left: 1px solid #2a2a2e; padding: 10px; overflow-y: auto; flex-shrink: 0; }
      .inspector-hint { color: #555; font-size: 11px; margin-top: 4px; }
      .preflight-panel { background: #1a1a1e; border: 1px solid #2a2a2e; border-radius: 6px; padding: 10px; margin-bottom: 12px; font-size: 12px; }
      .preflight-panel ul { list-style: none; margin-top: 6px; }
      .preflight-panel li { padding: 2px 0; }
      .preflight-panel li.error { color: #ff6b6b; }
      .preflight-panel li.warning { color: #ffd93d; }
      .preflight-panel li.ok { color: #6bcb77; }
      .editor-timeline { padding: 6px 12px; background: #1a1a1e; border-top: 1px solid #2a2a2e; font-size: 11px; color: #555; flex-shrink: 0; }
    </style>
  `;
}

