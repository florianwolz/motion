/**
 * gpu/glyph-atlas.ts — Rasterises text glyphs onto an OffscreenCanvas and
 * maintains a GPU texture atlas for the WebGPU text pass.
 *
 * Glyphs are rasterised in white on a transparent background.  The atlas
 * alpha channel is used as a coverage mask in the fragment shader; the
 * actual text colour is supplied per-vertex.
 */

/** One glyph's location within the atlas texture. */
export interface GlyphEntry {
  /** UV coordinates in [0,1]×[0,1] atlas space. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Glyph advance width in CSS pixels (for horizontal layout). */
  advance: number;
  /** Glyph bounding box size in CSS pixels. */
  w: number;
  h: number;
  /** Bearing from the baseline in CSS pixels (positive = up). */
  bearingY: number;
}

const ATLAS_SIZE = 2048;
const GLYPH_PADDING = 2; // pixels of padding around each glyph

export class GlyphAtlas {
  private readonly canvas: OffscreenCanvas;
  private readonly ctx: OffscreenCanvasRenderingContext2D;
  private texture: GPUTexture | null = null;
  private readonly entries = new Map<string, GlyphEntry>();
  /** Whether the CPU atlas has been modified since the last GPU upload. */
  private dirty = true;

  private cursorX = GLYPH_PADDING;
  private cursorY = GLYPH_PADDING;
  private rowHeight = 0;

  constructor() {
    this.canvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE);
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Failed to create OffscreenCanvas 2D context");
    this.ctx = ctx;
    this.ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  }

  /**
   * Return (or lazily rasterise) the atlas entry for a given character,
   * font-family, and font-size.  Returns `null` when the atlas is full.
   */
  getGlyph(char: string, fontFamily: string, fontSize: number): GlyphEntry | null {
    const key = `${char}\x00${fontFamily}\x00${fontSize}`;
    const cached = this.entries.get(key);
    if (cached) return cached;

    const { ctx } = this;
    const fontStr = `${fontSize}px ${fontFamily}, sans-serif`;
    ctx.font = fontStr;

    const metrics = ctx.measureText(char);
    const glyphW = Math.ceil(metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) + 1;
    const glyphH = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + 1;
    const slotW = glyphW + GLYPH_PADDING * 2;
    const slotH = glyphH + GLYPH_PADDING * 2;

    // Row-advance packing
    if (this.cursorX + slotW > ATLAS_SIZE) {
      this.cursorX = GLYPH_PADDING;
      this.cursorY += this.rowHeight + GLYPH_PADDING;
      this.rowHeight = 0;
    }
    if (this.cursorY + slotH > ATLAS_SIZE) {
      // Atlas is full — reset and re-render (rare, but safe for presentations)
      console.warn("[motion] Glyph atlas full; resetting.");
      ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
      this.entries.clear();
      this.cursorX = GLYPH_PADDING;
      this.cursorY = GLYPH_PADDING;
      this.rowHeight = 0;
    }

    const slotX = this.cursorX;
    const slotY = this.cursorY;

    // Rasterise white glyph onto transparent background
    ctx.clearRect(slotX, slotY, slotW, slotH);
    ctx.fillStyle = "white";
    ctx.font = fontStr;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(
      char,
      slotX + GLYPH_PADDING + metrics.actualBoundingBoxLeft,
      slotY + GLYPH_PADDING + metrics.actualBoundingBoxAscent,
    );

    this.cursorX += slotW;
    this.rowHeight = Math.max(this.rowHeight, slotH);
    this.dirty = true;

    const entry: GlyphEntry = {
      u0: slotX / ATLAS_SIZE,
      v0: slotY / ATLAS_SIZE,
      u1: (slotX + slotW) / ATLAS_SIZE,
      v1: (slotY + slotH) / ATLAS_SIZE,
      advance: metrics.width,
      w: slotW,
      h: slotH,
      bearingY: metrics.actualBoundingBoxAscent,
    };
    this.entries.set(key, entry);
    return entry;
  }

  /**
   * Ensure the GPU atlas texture is up to date.
   * Call once per frame before issuing text draw calls.
   */
  syncTexture(device: GPUDevice, queue: GPUQueue): GPUTexture {
    if (!this.texture) {
      this.texture = device.createTexture({
        size: [ATLAS_SIZE, ATLAS_SIZE],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.dirty = true;
    }

    if (this.dirty) {
      // Upload the entire OffscreenCanvas to the GPU texture
      queue.copyExternalImageToTexture(
        { source: this.canvas, flipY: false },
        { texture: this.texture },
        [ATLAS_SIZE, ATLAS_SIZE],
      );
      this.dirty = false;
    }

    return this.texture;
  }

  /** Release the GPU texture. */
  destroy(): void {
    this.texture?.destroy();
    this.texture = null;
  }
}
