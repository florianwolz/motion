/**
 * Presentation mode — full-screen browser runtime.
 *
 * Opened from a URL or local/offline bundle.
 * Supports keyboard/clicker navigation, presenter view (BroadcastChannel),
 * asset preloading, and preflight checks.
 */

export function mountPresenter(container: HTMLElement): void {
  // TODO: initialize MotionEngine WASM module, load document, run preflight
  container.innerHTML = `
    <div class="presenter-shell">
      <canvas id="presentation-canvas"></canvas>
    </div>
  `;

  document.addEventListener("keydown", handleKeyDown);
}

function handleKeyDown(event: KeyboardEvent): void {
  // TODO: dispatch NavigationCommand to MotionEngine
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
    case " ":
      // engine.nextStep();
      break;
    case "ArrowLeft":
    case "ArrowUp":
      // engine.previousStep();
      break;
    case "Escape":
      document.exitFullscreen().catch(() => undefined);
      break;
    case "b":
    case "B":
      // engine.blackScreen();
      break;
  }
}
