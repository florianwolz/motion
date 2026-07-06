/**
 * renderer-webgl2.ts — WebGL2 Tier-2 renderer stub.
 *
 * Provides a minimal `Renderer` implementation for browsers that support
 * WebGL2 but not WebGPU.  For the MVP this delegates all drawing to the
 * same `Canvas2DRenderer` that the Tier-3 path uses.  The two-tier
 * distinction is preserved so that future work can layer WebGL2-specific
 * effects (e.g. simple GLSL-based shadows and glow) without touching the
 * fallback path.
 *
 * Limitations compared to WebGPU Tier-1:
 *   • No glass / backdrop blur
 *   • No motion blur
 *   • No compute-shader Gaussian blur
 *   • No ACES color grading
 */

import type { Renderer, RenderTree } from "./renderer.js";
import { Canvas2DRenderer } from "./renderer.js";

export class WebGl2Renderer implements Renderer {
  private readonly inner: Canvas2DRenderer;
  private readonly gl: WebGL2RenderingContext;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: true });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl    = gl;
    // Delegate all drawing to Canvas2DRenderer for MVP
    this.inner = new Canvas2DRenderer(canvas);
  }

  static create(canvas: HTMLCanvasElement): WebGl2Renderer {
    return new WebGl2Renderer(canvas);
  }

  draw(tree: RenderTree): void {
    // Clear WebGL2 color buffer first so Canvas2D renders on a transparent base
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.inner.draw(tree);
  }

  resize(width: number, height: number): void {
    this.gl.viewport(0, 0, width, height);
    this.inner.resize(width, height);
  }

  destroy(): void {
    const ext = this.gl.getExtension("WEBGL_lose_context");
    ext?.loseContext();
    this.inner.destroy();
  }
}
