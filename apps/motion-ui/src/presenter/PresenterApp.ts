/**
 * Presentation mode — full-screen browser runtime.
 *
 * Supports:
 *   - Keyboard / clicker navigation (Arrow, Space, Enter, PageUp/PageDown, B, Escape, F)
 *   - Click / tap advance with Shift+click to go back
 *   - Canvas render loop via WASM engine
 *   - Preflight check before starting
 *   - BroadcastChannel for presenter-view sync (same machine)
 *   - Black screen toggle
 *   - Compiled deck bundle loading (.motiondeck)
 *   - Asset preload pipeline (fonts, images)
 *   - Reduced mode (simplified rendering for weak machines)
 */

import { initEngine, createEngine, parseRenderTree, parsePreflight, parsePosition, parseBundleManifest } from "../lib/engine.js";
import { isSupportedSavedDocument } from "../lib/documentState.js";
import type { EngineHandle } from "../lib/engine.js";
import { Canvas2DRenderer } from "../lib/renderer.js";
import {
  PRESENTER_CHANNEL_NAME,
  PRESENTER_STATE_STORAGE_KEY,
  isAdvanceKey,
  isRetreatKey,
} from "./runtime.js";

let engine: EngineHandle | null = null;
let renderer: Canvas2DRenderer | null = null;
let isBlackScreen = false;
let isReducedMode = false;
let presenterViewConnected = false;

/** BroadcastChannel for syncing presenter state with a second window/tab. */
let presenterChannel: BroadcastChannel | null = null;

export async function mountPresenter(container: HTMLElement): Promise<void> {
  container.innerHTML = buildPresenterHtml();

  const canvasEl = container.querySelector<HTMLCanvasElement>("#presentation-canvas")!;
  renderer = new Canvas2DRenderer(canvasEl);

  try {
    await initEngine();
    engine = createEngine();

    // Load document: prefer URL param bundle, then localStorage, then demo.
    await loadDocumentForPresenter();

    // Preload bundled assets before starting the presentation.
    await preloadAssets();

    // Run preflight.
    runPreflight(container);

    // Open presenter sync channel and open notes window.
    try {
      presenterChannel = new BroadcastChannel(PRESENTER_CHANNEL_NAME);
      wirePresenterChannel(container);
    } catch {
      // BroadcastChannel not available (e.g., some private browsing modes).
    }

    // Wire keyboard navigation.
    document.addEventListener("keydown", handleKeyDown);
    wireCanvasNavigation(container);

    // Start render loop.
    startRenderLoop(container);
    publishPresenterState();
  } catch (err) {
    console.error("Presenter init failed:", err);
    showOverlay(container, "❌ Engine failed to load", true);
  }
}

// ─── Document loading ────────────────────────────────────────────────────────

async function loadDocumentForPresenter(): Promise<void> {
  if (!engine) return;

  // 1. Try loading a compiled deck bundle from URL param (?bundle=<url>).
  const bundleUrl = new URLSearchParams(window.location.search).get("bundle");
  if (bundleUrl) {
    try {
      const resp = await fetch(bundleUrl);
      if (resp.ok) {
        const bundleJson = await resp.text();
        engine.loadDeckBundle(bundleJson);
        return;
      }
    } catch (e) {
      console.warn("Failed to fetch bundle from URL:", e);
    }
  }

  // 2. Try loading a bundle stored in localStorage (set by the editor's
  //    "Compile & Open" workflow).
  const storedBundle = localStorage.getItem("motion-compiled-bundle");
  if (storedBundle) {
    try {
      engine.loadDeckBundle(storedBundle);
      return;
    } catch {
      // Fall through.
    }
  }

  // 3. Try loading a raw document from localStorage (legacy editor path).
  const stored = localStorage.getItem("motion-current-doc");
  if (stored && isSupportedSavedDocument(stored)) {
    try {
      engine.loadDocument(stored);
      return;
    } catch {
      // Fall through to demo.
    }
  }

  // 4. Fall back to the demo document.
  const { buildDemoDocumentJson } = await import("../editor/demo.js");
  engine.loadDocument(buildDemoDocumentJson());
}

// ─── Asset preloading ─────────────────────────────────────────────────────────

/**
 * Preload fonts and images bundled in the document so the first frame is
 * immediately usable.  Blocks until all critical assets are ready or time out.
 */
async function preloadAssets(): Promise<void> {
  if (!engine) return;

  const docJson = engine.serializeDocument();
  let doc: { assets?: { assets?: Array<{ kind: string; uri: string; name?: string }> } };
  try {
    doc = JSON.parse(docJson);
  } catch {
    return;
  }

  const assets = doc.assets?.assets ?? [];
  const preloadTasks: Promise<void>[] = [];

  for (const asset of assets) {
    // Only data-URI assets are preloaded here.  HTTP/HTTPS assets (e.g. from
    // an external CDN) will be loaded lazily by the canvas renderer the first
    // time they are drawn; preloading them here would require CORS preflight
    // and is deferred to a future phase of the runtime loader.
    if (asset.kind === "font" && asset.uri.startsWith("data:font/") && asset.name) {
      preloadTasks.push(preloadFont(asset.name, asset.uri));
    } else if (asset.kind === "image" && asset.uri.startsWith("data:image/")) {
      preloadTasks.push(preloadImage(asset.uri));
    }
  }

  if (preloadTasks.length > 0) {
    // Use a generous timeout — assets in data URIs load quickly.
    await Promise.race([
      Promise.allSettled(preloadTasks),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
}

function preloadFont(family: string, uri: string): Promise<void> {
  return new Promise((resolve) => {
    const font = new FontFace(family, `url(${uri})`);
    font.load().then((loaded) => {
      document.fonts.add(loaded);
      resolve();
    }).catch(() => resolve());
  });
}

function preloadImage(uri: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = uri;
  });
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
    const dpr = isReducedMode ? 1 : (window.devicePixelRatio ?? 1);
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
  if (isAdvanceKey(event.key)) {
    event.preventDefault();
    engine.nextStep();
    publishPresenterState();
    return;
  }
  if (isRetreatKey(event.key)) {
    event.preventDefault();
    engine.previousStep();
    publishPresenterState();
    return;
  }
  switch (event.key) {
    case "r":
    case "R":
      engine.restartScene();
      publishPresenterState();
      break;
    case "b":
    case "B":
      isBlackScreen = !isBlackScreen;
      publishPresenterState();
      break;
    case "p":
    case "P":
      // Toggle reduced / performance mode.
      isReducedMode = !isReducedMode;
      break;
    case "n":
    case "N":
      // Open / focus the presenter notes window.
      openPresenterView();
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

function wireCanvasNavigation(container: HTMLElement): void {
  const canvas = container.querySelector<HTMLCanvasElement>("#presentation-canvas");
  if (!canvas) return;
  canvas.addEventListener("click", (event) => {
    if (!engine) return;
    if (event.shiftKey) {
      engine.previousStep();
    } else {
      engine.nextStep();
    }
    publishPresenterState();
  });
}

function openPresenterView(): void {
  const url = new URL("/presenter-view", window.location.href).href;
  window.open(url, "motion-presenter-view", "width=800,height=600,menubar=no,toolbar=no,location=no");
}

function wirePresenterChannel(container: HTMLElement): void {
  presenterChannel?.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as { type?: string };
    if (message.type === "presenter_view_ready") {
      presenterViewConnected = true;
      updatePresenterViewIndicator(container);
      return;
    }
    if (message.type === "presenter_state_request") {
      publishPresenterState();
    }
  });
  updatePresenterViewIndicator(container);
}

function publishPresenterState(): void {
  if (!engine) return;
  const state = engine.getPresenterState();
  try {
    localStorage.setItem(PRESENTER_STATE_STORAGE_KEY, state);
  } catch {
    // Ignore storage failures in restricted browsing modes.
  }
  if (!presenterChannel) return;
  presenterChannel.postMessage({ type: "presenter_state", state });
}

function updatePositionIndicator(container: HTMLElement): void {
  if (!engine) return;
  const pos = parsePosition(engine.getPosition());
  const el = container.querySelector<HTMLElement>("#position-indicator");
  if (el) {
    const step = pos.step_idx !== null ? `Step ${pos.step_idx + 1}` : "Intro";
    el.textContent = `Scene ${pos.scene_idx + 1} — ${step}`;
  }
  const rmEl = container.querySelector<HTMLElement>("#reduced-indicator");
  if (rmEl) {
    rmEl.textContent = isReducedMode ? "⚡ Reduced" : "";
  }
}

function updatePresenterViewIndicator(container: HTMLElement): void {
  const el = container.querySelector<HTMLElement>("#presenter-view-indicator");
  if (!el) return;

  const manifest = engine ? parseBundleManifest(engine.getBundleManifest()) : null;
  if (presenterViewConnected) {
    el.textContent = "📝 Notes connected";
  } else if (manifest?.has_notes) {
    el.textContent = "📝 Press N to open presenter notes";
  } else {
    el.textContent = "";
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
      <div id="reduced-indicator" class="reduced-indicator"></div>
      <div id="presenter-view-indicator" class="presenter-view-indicator"></div>
      <div class="presenter-hints">
        <span>← → Navigate</span>
        <span>Enter / PgDn Next</span>
        <span>Shift+Click Back</span>
        <span>B Black screen</span>
        <span>F Fullscreen</span>
        <span>R Restart scene</span>
        <span>N Notes view</span>
        <span>P Reduced mode</span>
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
      .reduced-indicator {
        position: absolute; bottom: 16px; right: 160px;
        font-family: system-ui, sans-serif; font-size: 11px;
        color: rgba(255,200,0,0.6); pointer-events: none; z-index: 10;
      }
      .presenter-view-indicator {
        position: absolute; top: 16px; right: 20px;
        font-family: system-ui, sans-serif; font-size: 11px;
        color: rgba(255,255,255,0.55); pointer-events: none; z-index: 10;
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
