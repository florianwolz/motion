/**
 * Authoring mode — Figma-like editor shell.
 *
 * Regions:
 *   - Canvas (custom renderer via WASM)
 *   - Layers panel
 *   - Properties inspector
 *   - Timeline / steps panel
 *   - Assets panel
 *   - Templates panel
 *   - AI assistant panel
 *   - Preflight / validation panel
 */

export function mountEditor(container: HTMLElement): void {
  // TODO: initialize MotionEngine WASM module, mount editor UI components
  container.innerHTML = `
    <div class="editor-shell">
      <header class="editor-toolbar">Motion Editor</header>
      <main class="editor-main">
        <aside class="editor-layers">Layers</aside>
        <section class="editor-canvas" id="canvas-container">Canvas</section>
        <aside class="editor-inspector">Inspector</aside>
      </main>
      <footer class="editor-timeline">Timeline / Steps</footer>
    </div>
  `;
}
