/**
 * Canvas2DRenderer — draws a RenderTree onto an HTML5 2D canvas.
 *
 * This is the Tier-3 renderer (Canvas fallback).  It is used for the MVP
 * because it requires no GPU capability detection and works everywhere.
 * The WebGPU (Tier-1) and WebGL2 (Tier-2) paths will be added later.
 *
 * The renderer consumes the JSON `RenderTree` produced by the WASM engine's
 * `render()` method and issues Canvas 2D draw calls accordingly.
 *
 * Nodes are drawn in draw-pass order (shape → image/video → text → shadow →
 * blur → mask → glass → particles → composite → color-grade) so that effects
 * are correctly layered even in the Canvas fallback path.
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
  | { type: "video"; uri: string }
  | {
      type: "chart";
      kind: ChartKind;
      bars: ResolvedBar[];
      lines: ResolvedLineSeries[];
      title: string | null;
      subtitle: string | null;
      highlighted_series: string[];
    };

/** Chart type — mirrors the Rust render_tree::ChartKind enum. */
export type ChartKind =
  | "bar" | "line" | "area" | "scatter" | "histogram"
  | "waterfall" | "heatmap" | "timeline" | "combo"
  | "stacked_bar" | "stacked_area" | "lollipop" | "pareto"
  | "funnel" | "bullet" | "waffle" | "table" | "matrix"
  | "kpi_card" | "gantt" | "sparkline" | "sankey" | "treemap"
  | "sunburst" | "chord" | "alluvial" | "network" | "radial_tree"
  | "dendrogram" | "box" | "violin" | "ridgeline" | "density"
  | "parallel_coordinates" | "hexbin" | "contour" | "error_bar"
  | "candlestick" | "ohlc" | "wind_rose" | "ternary";

/** A single resolved bar ready for Canvas2D rendering. */
export interface ResolvedBar {
  label: string;
  value_norm: number;  // 0–1
  value: number;
  color: RgbaColor;
  series_id: string;
}

/** A resolved line/area series. */
export interface ResolvedLineSeries {
  series_id: string;
  label: string;
  points: [number, number][];  // normalised [x, y] in [0,1]×[0,1]
  color: RgbaColor;
  filled: boolean;
}

export type ResolvedMaterial =
  | { type: "solid"; color: RgbaColor }
  | { type: "gradient"; kind: unknown; stops: Array<{ offset: number; color: RgbaColor }> }
  | { type: "glass"; tint: RgbaColor; opacity: number; blur_radius: number }
  | { type: "matte_card"; background: RgbaColor; corner_radius: number; shadow_color: RgbaColor; shadow_blur: number; shadow_offset_y: number }
  | { type: "glow"; color: RgbaColor; radius: number; intensity: number };

/**
 * Draw pass assigned to each node by the Rust render-tree builder.
 * Matches the `DrawPass` enum in `motion-render/src/passes.rs`.
 * Lower numeric rank = drawn first (back of stack).
 */
export type DrawPass =
  | "shape"
  | "image_video"
  | "text"
  | "shadow"
  | "blur"
  | "mask"
  | "glass"
  | "particles"
  | "composite"
  | "color_grade";

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
  /** Render pass assigned by the Rust engine. Used to order draw calls correctly. */
  draw_pass: DrawPass;
}

export interface RenderTree {
  nodes: RenderNode[];
  roots: string[];
  viewport_width: number;
  viewport_height: number;
  device_pixel_ratio: number;
}

// ─── Render tier detection ────────────────────────────────────────────────────

/**
 * The three render tiers described in the architecture plan.
 * Mirrors `RenderTier` in `motion-render/src/passes.rs`.
 */
export type RenderTier = "web_gpu" | "web_gl2" | "canvas";

/**
 * Detect the best render tier available in the current browser.
 *
 * - `web_gpu`  — WebGPU is available (Tier 1, full effects).
 * - `web_gl2`  — WebGL2 is available (Tier 2, reduced effects).
 * - `canvas`   — Canvas 2D fallback (Tier 3, minimal effects).
 */
export function detectRenderTier(): RenderTier {
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    return "web_gpu";
  }
  if (typeof document !== "undefined") {
    const probe = document.createElement("canvas");
    if (probe.getContext("webgl2")) return "web_gl2";
  }
  return "canvas";
}

// ─── Draw-pass ordering ───────────────────────────────────────────────────────

/** Numeric rank for each draw pass — lower = drawn first. */
const PASS_RANK: Record<DrawPass, number> = {
  shape: 0,
  image_video: 1,
  text: 2,
  shadow: 3,
  blur: 4,
  mask: 5,
  glass: 6,
  particles: 7,
  composite: 8,
  color_grade: 9,
};

/**
 * Return the draw-order rank of a node's assigned pass.
 * Exported for unit testing.
 */
export function drawPassRank(pass: DrawPass): number {
  return PASS_RANK[pass] ?? 0;
}

// ─── Pure helper utilities ────────────────────────────────────────────────────

/**
 * Convert an RGBA color (0.0–1.0 components) to a CSS `rgba(…)` string.
 * Exported for unit testing.
 */
export function toCssColor(c: RgbaColor): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgba(${r},${g},${b},${c.a.toFixed(3)})`;
}

/**
 * Build an O(1) node-lookup map from an array of render nodes.
 * Exported for unit testing.
 */
export function buildNodeMap(nodes: RenderNode[]): Map<string, RenderNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

/**
 * Return a stable-sorted copy of the nodes array ordered by draw pass.
 * Within the same pass, original array order is preserved.
 * Exported for unit testing.
 */
export function sortNodesByPass(nodes: RenderNode[]): RenderNode[] {
  return [...nodes].sort(
    (a, b) => drawPassRank(a.draw_pass) - drawPassRank(b.draw_pass)
  );
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

  /** Draw a complete render tree, processing nodes in draw-pass order. */
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
    const nodeMap = buildNodeMap(tree.nodes);

    // Sort visible nodes by their assigned draw pass before traversing roots.
    // Within each pass, the tree's depth-first back-to-front insertion order
    // is preserved (stable sort).
    const sortedRoots = tree.roots
      .map((id) => nodeMap.get(id))
      .filter((n): n is RenderNode => n !== undefined)
      .sort((a, b) => drawPassRank(a.draw_pass) - drawPassRank(b.draw_pass));

    for (const root of sortedRoots) {
      this.drawNode(root, nodeMap, cssW, cssH);
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

    // Recurse into children, sorted by their draw pass.
    const children = node.children
      .map((id) => nodeMap.get(id))
      .filter((n): n is RenderNode => n !== undefined)
      .sort((a, b) => drawPassRank(a.draw_pass) - drawPassRank(b.draw_pass));

    for (const child of children) {
      this.drawNode(child, nodeMap, vpW, vpH);
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

      case "chart":
        this.drawChart(c, t.width, t.height);
        break;
    }
  }

  private drawChart(
    c: Extract<RenderContent, { type: "chart" }>,
    w: number,
    h: number
  ): void {
    const { ctx } = this;

    // Background.
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, w, h);

    // Title / subtitle.
    let contentTop = 0;
    if (c.title) {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = `bold ${Math.max(14, h * 0.055)}px system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(c.title, 0, 0, w);
      contentTop += h * 0.08;
    }
    if (c.subtitle) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = `${Math.max(11, h * 0.038)}px system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(c.subtitle, 0, contentTop, w);
      contentTop += h * 0.065;
    }

    const chartH = h - contentTop;
    ctx.save();
    ctx.translate(0, contentTop);

    switch (c.kind) {
      case "bar":
      case "stacked_bar":
      case "histogram":
        this.drawBarChart(c.bars, c.highlighted_series, w, chartH);
        break;
      case "line":
      case "area":
        this.drawLineChart(c.lines, c.highlighted_series, w, chartH);
        break;
      case "kpi_card":
        this.drawKpiCard(c.bars, w, chartH);
        break;
      default:
        // Generic bar fallback for unimplemented kinds.
        if (c.bars.length > 0) {
          this.drawBarChart(c.bars, c.highlighted_series, w, chartH);
        } else if (c.lines.length > 0) {
          this.drawLineChart(c.lines, c.highlighted_series, w, chartH);
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.12)";
          ctx.fillRect(0, 0, w, chartH);
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.font = `${Math.max(12, chartH * 0.07)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(`[${c.kind} chart]`, w / 2, chartH / 2);
        }
    }

    ctx.restore();
  }

  private drawBarChart(
    bars: ResolvedBar[],
    highlightedSeries: string[],
    w: number,
    h: number
  ): void {
    if (bars.length === 0) return;
    const { ctx } = this;

    const padX = w * 0.04;
    const padTop = h * 0.06;
    const padBottom = h * 0.16;
    const chartW = w - padX * 2;
    const chartH = h - padTop - padBottom;
    const barGap = chartW / bars.length;
    const barW = barGap * 0.65;
    const barOffX = (barGap - barW) / 2;

    // Axis line.
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, padTop + chartH);
    ctx.lineTo(padX + chartW, padTop + chartH);
    ctx.stroke();

    bars.forEach((bar, i) => {
      const x = padX + i * barGap + barOffX;
      const barH = bar.value_norm * chartH;
      const y = padTop + chartH - barH;

      const isHighlighted = highlightedSeries.includes(bar.series_id);
      const isDimmed = highlightedSeries.length > 0 && !isHighlighted;

      const alpha = isDimmed ? 0.25 : 1.0;
      const c = bar.color;
      ctx.fillStyle = `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},${alpha})`;
      ctx.fillRect(x, y, barW, barH);

      // Label.
      ctx.fillStyle = `rgba(255,255,255,${isDimmed ? 0.2 : 0.55})`;
      ctx.font = `${Math.max(9, barGap * 0.2)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(bar.label, x + barW / 2, padTop + chartH + 6, barGap);
    });
  }

  private drawLineChart(
    series: ResolvedLineSeries[],
    highlightedSeries: string[],
    w: number,
    h: number
  ): void {
    if (series.length === 0) return;
    const { ctx } = this;

    const padX = w * 0.04;
    const padY = h * 0.08;
    const chartW = w - padX * 2;
    const chartH = h - padY * 2;

    // Axis lines.
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, padY);
    ctx.lineTo(padX, padY + chartH);
    ctx.lineTo(padX + chartW, padY + chartH);
    ctx.stroke();

    series.forEach((s) => {
      if (s.points.length === 0) return;
      const isDimmed = highlightedSeries.length > 0 && !highlightedSeries.includes(s.series_id);
      const alpha = isDimmed ? 0.2 : 1.0;
      const c = s.color;
      const cssColor = `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},${alpha})`;

      ctx.beginPath();
      s.points.forEach(([nx, ny], idx) => {
        const px = padX + nx * chartW;
        const py = padY + (1 - ny) * chartH;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });

      if (s.filled) {
        const lastPt = s.points[s.points.length - 1];
        const firstPt = s.points[0];
        if (lastPt && firstPt) {
          ctx.lineTo(padX + lastPt[0] * chartW, padY + chartH);
          ctx.lineTo(padX + firstPt[0] * chartW, padY + chartH);
          ctx.closePath();
          ctx.fillStyle = cssColor.replace(/[\d.]+\)$/, `${alpha * 0.3})`);
          ctx.fill();
          ctx.beginPath();
          s.points.forEach(([nx, ny], idx) => {
            const px = padX + nx * chartW;
            const py = padY + (1 - ny) * chartH;
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
        }
      }

      ctx.strokeStyle = cssColor;
      ctx.lineWidth = isDimmed ? 1 : 2;
      ctx.stroke();
    });
  }

  private drawKpiCard(
    bars: ResolvedBar[],
    w: number,
    h: number
  ): void {
    if (bars.length === 0) return;
    const { ctx } = this;
    const bar = bars[0];
    if (!bar) return;
    const c = bar.color;

    // Large KPI value.
    const valueStr = bar.value >= 1000
      ? `${(bar.value / 1000).toFixed(1)}k`
      : bar.value % 1 === 0
        ? bar.value.toString()
        : bar.value.toFixed(1);

    ctx.fillStyle = `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},1)`;
    ctx.font = `bold ${Math.max(32, h * 0.45)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(valueStr, w / 2, h * 0.42);

    // Label below.
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `${Math.max(12, h * 0.13)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(bar.label, w / 2, h * 0.72);
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
    if (line && y + lineHeightPx <= h) {
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
