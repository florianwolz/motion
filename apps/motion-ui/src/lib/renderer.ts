/**
 * Canvas2DRenderer — draws a RenderTree onto an HTML5 2D canvas.
 *
 * This is the Tier-3 renderer (Canvas fallback).  It is used for the MVP
 * because it requires no GPU capability detection and works everywhere.
 * The WebGPU (Tier-1) and WebGL2 (Tier-2) paths will be added later.
 *
 * The renderer consumes the JSON `RenderTree` produced by the WASM engine's
 * `render()` method and issues Canvas 2D draw calls accordingly.
 */

// ─── Types mirroring motion-render RenderTree JSON ────────────────────────────

export interface RenderTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale_x: number;
  scale_y: number;
}

export interface RgbaColor {
  r: number; // 0.0–1.0
  g: number;
  b: number;
  a: number;
}

export type ShapeKind =
  | { type: "rectangle" }
  | { type: "ellipse" }
  | { type: "rounded_rectangle"; corner_radius: number }
  | { type: "line" };

export type RenderContent =
  | { type: "frame" }
  | { type: "group" }
  | {
      type: "shape";
      kind: ShapeKind;
      fill: RgbaColor | null;
      stroke: RgbaColor | null;
      stroke_width: number;
    }
  | {
      type: "text";
      content: string;
      color: RgbaColor;
      font_family: string;
      font_size: number;
      line_height: number;
    }
  | { type: "image"; uri: string }
  | { type: "video"; uri: string };

export type ResolvedMaterial =
  | { type: "solid"; color: RgbaColor }
  | { type: "gradient"; kind: unknown; stops: Array<{ offset: number; color: RgbaColor }> }
  | { type: "glass"; tint: RgbaColor; opacity: number; blur_radius: number }
  | { type: "matte_card"; background: RgbaColor; corner_radius: number; shadow_color: RgbaColor; shadow_blur: number; shadow_offset_y: number }
  | { type: "glow"; color: RgbaColor; radius: number; intensity: number };

export interface RenderNode {
  id: string;
  transform: RenderTransform;
  opacity: number;
  visible: boolean;
  children: string[];
  content: RenderContent;
  material: ResolvedMaterial | null;
  blur_radius: number;
  clip: boolean;
}

export interface RenderTree {
  nodes: RenderNode[];
  roots: string[];
  viewport_width: number;
  viewport_height: number;
  device_pixel_ratio: number;
}

// ─── Image cache ──────────────────────────────────────────────────────────────

const imageCache = new Map<string, HTMLImageElement>();

function loadImage(uri: string): HTMLImageElement | null {
  if (!uri) return null;
  if (imageCache.has(uri)) return imageCache.get(uri)!;
  const img = new Image();
  img.src = uri;
  img.onload = () => imageCache.set(uri, img);
  imageCache.set(uri, img);
  return img;
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function toCssColor(c: RgbaColor): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgba(${r},${g},${b},${c.a.toFixed(3)})`;
}

// ─── Canvas2DRenderer ─────────────────────────────────────────────────────────

export class Canvas2DRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D rendering context");
    this.ctx = ctx;
  }

  /** Resize the canvas backing store to match its CSS size × device pixel ratio. */
  resize(cssWidth: number, cssHeight: number, dpr = window.devicePixelRatio ?? 1): void {
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.scale(dpr, dpr);
  }

  /** Draw a complete render tree. */
  draw(tree: RenderTree): void {
    const { ctx } = this;
    const cssW = tree.viewport_width;
    const cssH = tree.viewport_height;

    // Resize if the viewport changed.
    if (this.canvas.width !== Math.round(cssW * tree.device_pixel_ratio)) {
      this.resize(cssW, cssH, tree.device_pixel_ratio);
    }

    ctx.clearRect(0, 0, cssW, cssH);

    // Build a lookup map for O(1) node access.
    const nodeMap = new Map<string, RenderNode>(tree.nodes.map((n) => [n.id, n]));

    for (const rootId of tree.roots) {
      const root = nodeMap.get(rootId);
      if (root) this.drawNode(root, nodeMap, cssW, cssH);
    }
  }

  private drawNode(
    node: RenderNode,
    nodeMap: Map<string, RenderNode>,
    vpW: number,
    vpH: number
  ): void {
    if (!node.visible || node.opacity <= 0) return;

    const { ctx } = this;
    const t = node.transform;

    ctx.save();

    // Apply global alpha.
    ctx.globalAlpha = node.opacity;

    // Apply transform: translate to (x, y), apply rotation and scale.
    ctx.translate(t.x + t.width / 2, t.y + t.height / 2);
    if (t.rotation !== 0) ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.scale(t.scale_x, t.scale_y);
    ctx.translate(-t.width / 2, -t.height / 2);

    // Apply blur.
    if (node.blur_radius > 0) {
      ctx.filter = `blur(${node.blur_radius}px)`;
    }

    // Clip to bounding box if requested.
    if (node.clip) {
      ctx.beginPath();
      ctx.rect(0, 0, t.width, t.height);
      ctx.clip();
    }

    this.drawContent(node, vpW, vpH);

    // Reset filter before drawing children.
    ctx.filter = "none";

    // Recurse into children.
    for (const childId of node.children) {
      const child = nodeMap.get(childId);
      if (child) this.drawNode(child, nodeMap, vpW, vpH);
    }

    ctx.restore();
  }

  private drawContent(node: RenderNode, _vpW: number, _vpH: number): void {
    const { ctx } = this;
    const t = node.transform;
    const c = node.content;

    switch (c.type) {
      case "frame":
      case "group":
        // Frame/Group: optionally draw a background from material.
        if (node.material) {
          this.applyMaterial(node.material, t.width, t.height);
          ctx.fillRect(0, 0, t.width, t.height);
        }
        break;

      case "shape":
        this.drawShape(c, t.width, t.height, node.material);
        break;

      case "text":
        this.drawText(c, t.width, t.height);
        break;

      case "image":
        this.drawImage(c, t.width, t.height);
        break;

      case "video":
        // Video: draw a placeholder rectangle for MVP.
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, t.width, t.height);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("▶ Video", t.width / 2, t.height / 2);
        break;
    }
  }

  private drawShape(
    c: Extract<RenderContent, { type: "shape" }>,
    w: number,
    h: number,
    material: ResolvedMaterial | null
  ): void {
    const { ctx } = this;

    // Build path.
    const kind = c.kind;
    ctx.beginPath();
    switch (kind.type) {
      case "rectangle":
        ctx.rect(0, 0, w, h);
        break;
      case "ellipse":
        ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        break;
      case "rounded_rectangle":
        ctx.roundRect(0, 0, w, h, kind.corner_radius);
        break;
      case "line":
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        break;
    }

    // Fill.
    const fillColor = c.fill ?? (material ? this.materialToColor(material) : null);
    if (fillColor && kind.type !== "line") {
      if (material && (material.type === "gradient")) {
        this.applyMaterial(material, w, h);
      } else {
        ctx.fillStyle = toCssColor(fillColor);
      }
      ctx.fill();
    } else if (material) {
      this.applyMaterial(material, w, h);
      if (kind.type !== "line") ctx.fill();
    }

    // Stroke.
    if (c.stroke && c.stroke_width > 0) {
      ctx.strokeStyle = toCssColor(c.stroke);
      ctx.lineWidth = c.stroke_width;
      ctx.stroke();
    }
  }

  private drawText(
    c: Extract<RenderContent, { type: "text" }>,
    w: number,
    h: number
  ): void {
    const { ctx } = this;
    const lineHeightPx = c.font_size * c.line_height;

    ctx.fillStyle = toCssColor(c.color);
    ctx.font = `${c.font_size}px ${c.font_family}, sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    // Simple word-wrap.
    const words = c.content.split(" ");
    let line = "";
    let y = 0;

    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > w && line) {
        ctx.fillText(line, 0, y);
        line = word;
        y += lineHeightPx;
        if (y + lineHeightPx > h) break;
      } else {
        line = test;
      }
    }
    if (line && y + lineHeightPx <= h + lineHeightPx) {
      ctx.fillText(line, 0, y);
    }
  }

  private drawImage(
    c: Extract<RenderContent, { type: "image" }>,
    w: number,
    h: number
  ): void {
    const { ctx } = this;
    const img = loadImage(c.uri);
    if (img?.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 0, 0, w, h);
    } else {
      // Placeholder while loading.
      ctx.fillStyle = "#222";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⏳ Loading…", w / 2, h / 2);
    }
  }

  private applyMaterial(mat: ResolvedMaterial, w: number, h: number): void {
    const { ctx } = this;
    switch (mat.type) {
      case "solid":
        ctx.fillStyle = toCssColor(mat.color);
        break;
      case "gradient": {
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        for (const stop of mat.stops) {
          grad.addColorStop(stop.offset, toCssColor(stop.color));
        }
        ctx.fillStyle = grad;
        break;
      }
      case "glass":
        // Approximate glass with a semi-transparent frosted fill.
        ctx.fillStyle = `rgba(${Math.round(mat.tint.r * 255)},${Math.round(mat.tint.g * 255)},${Math.round(mat.tint.b * 255)},${mat.opacity})`;
        break;
      case "matte_card":
        // Draw shadow then fill.
        ctx.shadowColor = toCssColor(mat.shadow_color);
        ctx.shadowBlur = mat.shadow_blur;
        ctx.shadowOffsetY = mat.shadow_offset_y;
        ctx.fillStyle = toCssColor(mat.background);
        break;
      case "glow": {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
        const gc = mat.color;
        g.addColorStop(0, `rgba(${Math.round(gc.r * 255)},${Math.round(gc.g * 255)},${Math.round(gc.b * 255)},${mat.intensity})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        break;
      }
    }
  }

  private materialToColor(mat: ResolvedMaterial): RgbaColor | null {
    switch (mat.type) {
      case "solid": return mat.color;
      case "glass": return mat.tint;
      case "matte_card": return mat.background;
      case "glow": return mat.color;
      default: return null;
    }
  }
}
