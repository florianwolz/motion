/**
 * Demo document builder — shared between the editor and presenter.
 *
 * Produces a JSON string matching the Rust `Document` serialization format,
 * ready to be passed to `engine.loadDocument()`.
 */

export function buildDemoDocumentJson(): string {
  const rootId = crypto.randomUUID();
  const titleId = crypto.randomUUID();
  const subtitleId = crypto.randomUUID();
  const rectId = crypto.randomUUID();
  const sceneId = crypto.randomUUID();

  const doc = {
    id: crypto.randomUUID(),
    metadata: {
      title: "Demo Presentation",
      author: null,
      description: null,
      schema_version: "0.1.0",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    tokens: {
      tokens: {
        "color.text.primary": "#FFFFFF",
        "color.text.secondary": "#AAAAAA",
        "color.brand": "#EC6602",
        "color.background": "#0D0D0F",
        "typography.display.font": "Inter, system-ui, sans-serif",
        "typography.display.size": 48,
        "typography.body.font": "Inter, system-ui, sans-serif",
        "typography.body.size": 20,
        "motion.duration.normal": "420ms",
        "spacing.md": 16,
      },
      modes: { theme: "dark", medium: "live", audience: null },
    },
    brand: null,
    assets: { assets: [] },
    export_settings: {
      pdf_enabled: false,
      png_enabled: false,
      mp4_enabled: false,
      offline_bundle_enabled: false,
    },
    scenes: [
      {
        id: sceneId,
        name: "Title Scene",
        root: rootId,
        camera: { x: 0, y: 0, zoom: 1.0, rotation: 0 },
        steps: [
          {
            id: crypto.randomUUID(),
            name: "Reveal subtitle",
            commands: [{ type: "reveal", target: subtitleId }],
            transition: { preset: null, duration_policy: "auto" },
            notes: "Pause here for questions.",
          },
        ],
        notes: null,
      },
    ],
    nodes: {
      [rootId]: makeFrameNode(rootId, "Root", null, 0, 0, 1920, 1080, "color.background"),
      [rectId]: makeShapeNode(rectId, "Accent Bar", rootId, 120, 460, 8, 160, "color.brand"),
      [titleId]: makeTextNode(
        titleId, "Title", rootId,
        160, 440,
        "Motion", "color.text.primary", "typography.display.font", "typography.display.size",
      ),
      [subtitleId]: makeTextNode(
        subtitleId, "Subtitle", rootId,
        160, 530,
        "Live motion-graphic presentations — built in Rust.",
        "color.text.secondary", "typography.body.font", "typography.body.size",
      ),
    },
  };

  // Set root's children list.
  (doc.nodes as Record<string, unknown>)[rootId] = makeFrameNode(
    rootId, "Root", null, 0, 0, 1920, 1080, "color.background",
    [rectId, titleId, subtitleId],
  );

  return JSON.stringify(doc);
}

// ─── Node builder helpers ─────────────────────────────────────────────────────

function makeTransform(x: number, y: number, w: number, h: number) {
  return { x, y, width: w, height: h, rotation: 0, scale_x: 1, scale_y: 1 };
}

function makeFrameNode(
  id: string, name: string, parent: string | null,
  x: number, y: number, w: number, h: number, bgToken: string,
  children: string[] = [],
) {
  return {
    id,
    name,
    parent,
    children,
    transform: makeTransform(x, y, w, h),
    style: {
      opacity: 1.0,
      fill: { path: bgToken },
      stroke: null,
      stroke_width: null,
      blur_radius: null,
      material: null,
    },
    layout: { layout_mode: "none", padding: null, gap: null, align_items: null, justify_content: null },
    animation: { enter_preset: null, exit_preset: null, stagger_delay: null },
    semantic: { role: null, label: null },
    visible: true,
    locked: false,
    data: { type: "frame", clip_content: true, corner_radius: null },
  };
}

function makeShapeNode(
  id: string, name: string, parent: string | null,
  x: number, y: number, w: number, h: number, fillToken: string,
) {
  return {
    id,
    name,
    parent,
    children: [],
    transform: makeTransform(x, y, w, h),
    style: {
      opacity: 1.0,
      fill: { path: fillToken },
      stroke: null,
      stroke_width: null,
      blur_radius: null,
      material: null,
    },
    layout: { layout_mode: "none", padding: null, gap: null, align_items: null, justify_content: null },
    animation: { enter_preset: null, exit_preset: null, stagger_delay: null },
    semantic: { role: null, label: null },
    visible: true,
    locked: false,
    data: { type: "shape", kind: "rectangle" },
  };
}

function makeTextNode(
  id: string, name: string, parent: string | null,
  x: number, y: number,
  content: string, colorToken: string, fontToken: string, sizeToken: string,
) {
  return {
    id,
    name,
    parent,
    children: [],
    transform: makeTransform(x, y, 1600, 80),
    style: {
      opacity: 1.0,
      fill: null,
      stroke: null,
      stroke_width: null,
      blur_radius: null,
      material: null,
    },
    layout: { layout_mode: "none", padding: null, gap: null, align_items: null, justify_content: null },
    animation: { enter_preset: null, exit_preset: null, stagger_delay: null },
    semantic: { role: null, label: null },
    visible: true,
    locked: false,
    data: {
      type: "text",
      content,
      color: { path: colorToken },
      font_family: { path: fontToken },
      font_size: { path: sizeToken },
      line_height: null,
      font_weight: null,
    },
  };
}
