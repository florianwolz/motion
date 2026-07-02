/**
 * Demo document builder — shared between the editor and presenter.
 *
 * Produces a JSON string matching the Rust `Document` serialization format,
 * ready to be passed to `engine.loadDocument()`.
 */

type DemoNode = {
  id: string;
  name: string;
  parent: string | null;
  children: string[];
  transform: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    scale_x: number;
    scale_y: number;
  };
  style: {
    opacity: number;
    fill: { path: string } | null;
    stroke: null;
    stroke_width: null;
    blur_radius: null;
    material: null;
  };
  layout: {
    layout_mode: string;
    padding: null;
    gap: null;
    align_items: null;
    justify_content: null;
  };
  animation: {
    enter_preset: string | null;
    exit_preset: null;
    stagger_delay: null;
  };
  semantic: {
    role: null;
    label: null;
  };
  visible: boolean;
  locked: boolean;
  data: Record<string, unknown>;
};

export function buildDemoDocumentJson(): string {
  const sceneNodes: Record<string, DemoNode> = {};
  const scenes = [
    buildTitleRevealScene(sceneNodes),
    buildBeforeAfterScene(sceneNodes),
    buildExecutiveKpiScene(sceneNodes),
    buildArchitectureScene(sceneNodes),
  ];

  const timestamp = new Date().toISOString();
  const document = {
    id: crypto.randomUUID(),
    metadata: {
      title: "Motion Acceptance Demo",
      author: null,
      description: "Multi-scene demo deck used to exercise branded motion acceptance criteria.",
      schema_version: "0.1.0",
      created_at: timestamp,
      updated_at: timestamp,
    },
    tokens: {
      tokens: {
        "color.text.primary": "#F7F8FA",
        "color.text.secondary": "#B8C0CC",
        "color.background": "#05070D",
        "color.surface.card": "#111827",
        "color.surface.panel": "#0F172A",
        "color.surface.muted": "#132033",
        "color.surface.highlight": "#1D4ED8",
        "color.brand": "#EC6602",
        "color.brand.alt": "#00BEDC",
        "color.chart.positive": "#00BEDC",
        "color.chart.warning": "#EC6602",
        "color.chart.neutral": "#7C8DA6",
        "color.chart.best": "#3DDC97",
        "typography.display.font": "Lato, system-ui, sans-serif",
        "typography.display.size": 64,
        "typography.title.font": "Lato, system-ui, sans-serif",
        "typography.title.size": 36,
        "typography.body.font": "Lato, system-ui, sans-serif",
        "typography.body.size": 20,
        "typography.caption.font": "Lato, system-ui, sans-serif",
        "typography.caption.size": 16,
        "motion.duration.normal": "420ms",
        "spacing.md": 16,
      },
      modes: { theme: "dark", medium: "live", audience: "executive" },
    },
    brand: null,
    assets: { assets: [] },
    export_settings: {
      pdf_enabled: true,
      png_enabled: true,
      mp4_enabled: false,
      offline_bundle_enabled: false,
    },
    scenes,
    nodes: sceneNodes,
  };

  return JSON.stringify(document);
}

function buildTitleRevealScene(nodes: Record<string, DemoNode>) {
  const rootId = crypto.randomUUID();
  const accentId = crypto.randomUUID();
  const eyebrowId = crypto.randomUUID();
  const titleId = crypto.randomUUID();
  const subtitleId = crypto.randomUUID();
  const chipAId = crypto.randomUUID();
  const chipBId = crypto.randomUUID();
  const chipCId = crypto.randomUUID();
  const chipATextId = crypto.randomUUID();
  const chipBTextId = crypto.randomUUID();
  const chipCTextId = crypto.randomUUID();

  nodes[rootId] = makeFrameNode(rootId, "Title Root", null, 0, 0, 1920, 1080, "color.background", [
    accentId,
    eyebrowId,
    titleId,
    subtitleId,
    chipAId,
    chipBId,
    chipCId,
  ]);
  nodes[accentId] = makeShapeNode(accentId, "Accent Bar", rootId, 132, 188, 12, 176, "color.brand");
  nodes[eyebrowId] = makeTextNode(
    eyebrowId,
    "Eyebrow",
    rootId,
    176,
    192,
    "Q3 acceptance demo",
    "color.brand.alt",
    "typography.caption.font",
    "typography.caption.size",
    { visible: false, enterPreset: "slide_in", width: 420, height: 40 },
  );
  nodes[titleId] = makeTextNode(
    titleId,
    "Title",
    rootId,
    176,
    256,
    "Motion turns milestone claims into testable product slices",
    "color.text.primary",
    "typography.display.font",
    "typography.display.size",
    { width: 1360, height: 160 },
  );
  nodes[subtitleId] = makeTextNode(
    subtitleId,
    "Subtitle",
    rootId,
    176,
    430,
    "Bundled brand assets, richer scenes, and semantic builds in one browser-native deck.",
    "color.text.secondary",
    "typography.body.font",
    "typography.body.size",
    { visible: false, enterPreset: "slide_in", width: 1240, height: 90 },
  );
  addChip(nodes, chipAId, chipATextId, rootId, 176, 612, 290, 96, "Branded font bundle", "color.surface.card");
  addChip(nodes, chipBId, chipBTextId, rootId, 494, 612, 290, 96, "Animated acceptance scenes", "color.surface.panel");
  addChip(nodes, chipCId, chipCTextId, rootId, 812, 612, 290, 96, "Semantic presenter steps", "color.surface.highlight");

  return {
    id: crypto.randomUUID(),
    name: "Title Reveal",
    root: rootId,
    camera: { x: 0, y: 0, zoom: 1.0, rotation: 0 },
    steps: [
      {
        id: crypto.randomUUID(),
        name: "Reveal demo framing",
        commands: [
          { type: "reveal", target: eyebrowId },
          { type: "reveal", target: subtitleId },
        ],
        transition: { preset: null, duration_policy: "auto" },
        notes: "Set the expectation: this deck exists to verify milestone claims with concrete artifacts.",
      },
      {
        id: crypto.randomUUID(),
        name: "Stagger proof points",
        commands: [
          { type: "staggered_reveal", targets: [chipAId, chipBId, chipCId], stagger_ms: 90 },
        ],
        transition: { preset: null, duration_policy: "auto" },
        notes: "Introduce the three acceptance areas covered by the richer demo.",
      },
      {
        id: crypto.randomUUID(),
        name: "Focus on product quality",
        commands: [{ type: "focus", target: chipCId }],
        transition: { preset: null, duration_policy: "auto" },
        notes: "Emphasize repeatable motion behavior instead of placeholder pages.",
      },
    ],
    notes: "Opening scene for the acceptance walkthrough.",
  };
}

function buildBeforeAfterScene(nodes: Record<string, DemoNode>) {
  const rootId = crypto.randomUUID();
  const titleId = crypto.randomUUID();
  const subtitleId = crypto.randomUUID();
  const beforeFrameId = crypto.randomUUID();
  const afterFrameId = crypto.randomUUID();
  const beforeLabelId = crypto.randomUUID();
  const afterLabelId = crypto.randomUUID();
  const beforeCaptionId = crypto.randomUUID();
  const afterCaptionId = crypto.randomUUID();
  const insightId = crypto.randomUUID();

  nodes[rootId] = makeFrameNode(rootId, "Before After Root", null, 0, 0, 1920, 1080, "color.background", [
    titleId,
    subtitleId,
    beforeFrameId,
    afterFrameId,
    insightId,
  ]);
  nodes[titleId] = makeTextNode(
    titleId,
    "Scene Title",
    rootId,
    120,
    96,
    "Technical before / after comparison",
    "color.text.primary",
    "typography.title.font",
    "typography.title.size",
    { width: 900, height: 70 },
  );
  nodes[subtitleId] = makeTextNode(
    subtitleId,
    "Scene Subtitle",
    rootId,
    120,
    154,
    "A placeholder title page is not enough; we need scenes that explain change with motion.",
    "color.text.secondary",
    "typography.body.font",
    "typography.body.size",
    { visible: false, enterPreset: "slide_in", width: 1180, height: 70 },
  );
  addComparisonCard(
    nodes,
    beforeFrameId,
    beforeLabelId,
    beforeCaptionId,
    rootId,
    120,
    274,
    "Before",
    "Static hand-off\nunclear focal point\nno motion cue",
    "color.surface.card",
  );
  addComparisonCard(
    nodes,
    afterFrameId,
    afterLabelId,
    afterCaptionId,
    rootId,
    1030,
    274,
    "After",
    "Animated guidance\nsemantic emphasis\nbrand-safe framing",
    "color.surface.highlight",
  );
  nodes[insightId] = makeTextNode(
    insightId,
    "Insight",
    rootId,
    120,
    872,
    "Insight: the acceptance deck now demonstrates progressive disclosure instead of describing it abstractly.",
    "color.brand.alt",
    "typography.body.font",
    "typography.body.size",
    { visible: false, enterPreset: "slide_in", width: 1460, height: 60 },
  );

  return {
    id: crypto.randomUUID(),
    name: "Technical Before / After",
    root: rootId,
    camera: { x: 0, y: 0, zoom: 1.0, rotation: 0 },
    steps: [
      {
        id: crypto.randomUUID(),
        name: "Reveal problem framing",
        commands: [{ type: "reveal", target: subtitleId }],
        transition: { preset: null, duration_policy: "auto" },
        notes: "Frame the gap between milestone language and what the product currently shows.",
      },
      {
        id: crypto.randomUUID(),
        name: "Stagger comparison panes",
        commands: [{ type: "staggered_reveal", targets: [beforeFrameId, afterFrameId], stagger_ms: 120 }],
        transition: { preset: null, duration_policy: "auto" },
        notes: "Bring in both states as a serious explanatory scene.",
      },
      {
        id: crypto.randomUUID(),
        name: "Zoom into improved state",
        commands: [{ type: "camera_focus", target: afterFrameId, zoom: 1.12 }],
        transition: { preset: null, duration_policy: "auto" },
        notes: "Let the presenter anchor on the improved, animated side.",
      },
      {
        id: crypto.randomUUID(),
        name: "Reveal takeaway",
        commands: [{ type: "reveal", target: insightId }],
        transition: { preset: null, duration_policy: "auto" },
        notes: "State the acceptance takeaway explicitly.",
      },
    ],
    notes: "Before/after storytelling scene.",
  };
}

function buildExecutiveKpiScene(nodes: Record<string, DemoNode>) {
  const rootId = crypto.randomUUID();
  const titleId = crypto.randomUUID();
  const subtitleId = crypto.randomUUID();
  const axisId = crypto.randomUUID();
  const barAId = crypto.randomUUID();
  const barBId = crypto.randomUUID();
  const barCId = crypto.randomUUID();
  const barDId = crypto.randomUUID();
  const labelAId = crypto.randomUUID();
  const labelBId = crypto.randomUUID();
  const labelCId = crypto.randomUUID();
  const labelDId = crypto.randomUUID();
  const annotationId = crypto.randomUUID();

  nodes[rootId] = makeFrameNode(rootId, "KPI Root", null, 0, 0, 1920, 1080, "color.background", [
    titleId,
    subtitleId,
    axisId,
    barAId,
    barBId,
    barCId,
    barDId,
    labelAId,
    labelBId,
    labelCId,
    labelDId,
    annotationId,
  ]);
  nodes[titleId] = makeTextNode(
    titleId,
    "Chart Title",
    rootId,
    120,
    96,
    "Executive KPI lift",
    "color.text.primary",
    "typography.title.font",
    "typography.title.size",
    { width: 620, height: 60 },
  );
  nodes[subtitleId] = makeTextNode(
    subtitleId,
    "Chart Subtitle",
    rootId,
    120,
    154,
    "Acceptance scenes should show movement, hierarchy, and a clear business takeaway.",
    "color.text.secondary",
    "typography.body.font",
    "typography.body.size",
    { width: 1100, height: 60 },
  );
  nodes[axisId] = makeShapeNode(axisId, "Chart Axis", rootId, 168, 794, 1280, 6, "color.chart.neutral");
  addBar(nodes, barAId, labelAId, rootId, 228, 560, 180, 240, "Coverage", "color.chart.neutral");
  addBar(nodes, barBId, labelBId, rootId, 482, 486, 180, 314, "Brand", "color.chart.warning");
  addBar(nodes, barCId, labelCId, rootId, 736, 420, 180, 380, "Scenes", "color.chart.positive");
  addBar(nodes, barDId, labelDId, rootId, 990, 332, 180, 468, "Presenter", "color.chart.best");
  nodes[annotationId] = makeTextNode(
    annotationId,
    "Annotation",
    rootId,
    1260,
    316,
    "+27% clearer story progression\nwhen presenters can stage animated proof points.",
    "color.brand.alt",
    "typography.body.font",
    "typography.body.size",
    { visible: false, enterPreset: "slide_in", width: 420, height: 100 },
  );

  return {
    id: crypto.randomUUID(),
    name: "Executive KPI Lift",
    root: rootId,
    camera: { x: 0, y: 0, zoom: 1.0, rotation: 0 },
    steps: [
      {
        id: crypto.randomUUID(),
        name: "Grow chart bars",
        commands: [{ type: "staggered_reveal", targets: [barAId, barBId, barCId, barDId], stagger_ms: 70 }],
        transition: { preset: null, duration_policy: "auto" },
        notes: "Demonstrate a polished chart build rather than a static slide.",
      },
      {
        id: crypto.randomUUID(),
        name: "Call out strongest gain",
        commands: [{ type: "focus", target: barDId }],
        transition: { preset: null, duration_policy: "auto" },
        notes: "Highlight the strongest proof point semantically.",
      },
      {
        id: crypto.randomUUID(),
        name: "Reveal business takeaway",
        commands: [{ type: "reveal", target: annotationId }],
        transition: { preset: null, duration_policy: "auto" },
        notes: "State the executive impact after the visual build lands.",
      },
    ],
    notes: "Branded KPI scene for executive storytelling.",
  };
}

function buildArchitectureScene(nodes: Record<string, DemoNode>) {
  const rootId = crypto.randomUUID();
  const titleId = crypto.randomUUID();
  const subtitleId = crypto.randomUUID();
  const cardAId = crypto.randomUUID();
  const cardBId = crypto.randomUUID();
  const cardCId = crypto.randomUUID();
  const cardDId = crypto.randomUUID();
  const cardATextId = crypto.randomUUID();
  const cardBTextId = crypto.randomUUID();
  const cardCTextId = crypto.randomUUID();
  const cardDTextId = crypto.randomUUID();
  const connectorAId = crypto.randomUUID();
  const connectorBId = crypto.randomUUID();
  const connectorCId = crypto.randomUUID();
  const askId = crypto.randomUUID();

  nodes[rootId] = makeFrameNode(rootId, "Architecture Root", null, 0, 0, 1920, 1080, "color.background", [
    titleId,
    subtitleId,
    connectorAId,
    connectorBId,
    connectorCId,
    cardAId,
    cardBId,
    cardCId,
    cardDId,
    askId,
  ]);
  nodes[titleId] = makeTextNode(
    titleId,
    "Architecture Title",
    rootId,
    120,
    96,
    "Architecture focus",
    "color.text.primary",
    "typography.title.font",
    "typography.title.size",
    { width: 520, height: 60 },
  );
  nodes[subtitleId] = makeTextNode(
    subtitleId,
    "Architecture Subtitle",
    rootId,
    120,
    154,
    "A serious scene should guide attention from source material to runtime delivery.",
    "color.text.secondary",
    "typography.body.font",
    "typography.body.size",
    { width: 1040, height: 60 },
  );
  nodes[connectorAId] = makeShapeNode(connectorAId, "Connector A", rootId, 448, 468, 120, 6, "color.chart.neutral");
  nodes[connectorBId] = makeShapeNode(connectorBId, "Connector B", rootId, 850, 468, 120, 6, "color.chart.neutral");
  nodes[connectorCId] = makeShapeNode(connectorCId, "Connector C", rootId, 1252, 468, 120, 6, "color.chart.neutral");
  addArchitectureCard(nodes, cardAId, cardATextId, rootId, 160, 352, "Inputs", "Acceptance criteria\nbrand assets\nscene specs");
  addArchitectureCard(nodes, cardBId, cardBTextId, rootId, 562, 352, "WASM Engine", "Semantic steps\ncamera state\nmotion presets");
  addArchitectureCard(nodes, cardCId, cardCTextId, rootId, 964, 352, "Renderer", "Canvas tree\nanimation frame\nfocus overlays");
  addArchitectureCard(nodes, cardDId, cardDTextId, rootId, 1366, 352, "Presenter", "Preflight\nfullscreen\nrehearsal flow");
  nodes[askId] = makeTextNode(
    askId,
    "Decision Ask",
    rootId,
    120,
    822,
    "Decision ask: keep expanding acceptance tests until every milestone claim has a visible demo and an automated check.",
    "color.brand",
    "typography.body.font",
    "typography.body.size",
    { visible: false, enterPreset: "slide_in", width: 1540, height: 70 },
  );

  return {
    id: crypto.randomUUID(),
    name: "Architecture Focus",
    root: rootId,
    camera: { x: 0, y: 0, zoom: 1.0, rotation: 0 },
    steps: [
      {
        id: crypto.randomUUID(),
        name: "Reveal pipeline",
        commands: [{ type: "staggered_reveal", targets: [cardAId, cardBId, cardCId, cardDId], stagger_ms: 80 }],
        transition: { preset: null, duration_policy: "auto" },
        notes: "Show the end-to-end chain that turns assets and specs into a presentable runtime.",
      },
      {
        id: crypto.randomUUID(),
        name: "Focus engine responsibilities",
        commands: [{ type: "focus", target: cardBId }],
        transition: { preset: null, duration_policy: "auto" },
        notes: "Point out the semantic engine layer as the center of milestone validation.",
      },
      {
        id: crypto.randomUUID(),
        name: "Zoom to presentation runtime",
        commands: [{ type: "camera_focus", target: cardDId, zoom: 1.18 }],
        transition: { preset: null, duration_policy: "auto" },
        notes: "Finish on the runtime that has to prove the branded deck actually works live.",
      },
      {
        id: crypto.randomUUID(),
        name: "Reveal decision ask",
        commands: [{ type: "reveal", target: askId }],
        transition: { preset: null, duration_policy: "auto" },
        notes: "Close with the concrete next action.",
      },
    ],
    notes: "Architecture explainer scene.",
  };
}

function addChip(
  nodes: Record<string, DemoNode>,
  frameId: string,
  textId: string,
  parent: string,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  fillToken: string,
) {
  nodes[frameId] = makeFrameNode(frameId, label, parent, x, y, width, height, fillToken, [textId], {
    visible: false,
    enterPreset: "pop_in",
  });
  nodes[textId] = makeTextNode(
    textId,
    `${label} Label`,
    frameId,
    24,
    30,
    label,
    "color.text.primary",
    "typography.body.font",
    "typography.body.size",
    { width: width - 48, height: 40 },
  );
}

function addComparisonCard(
  nodes: Record<string, DemoNode>,
  frameId: string,
  labelId: string,
  captionId: string,
  parent: string,
  x: number,
  y: number,
  label: string,
  caption: string,
  fillToken: string,
) {
  nodes[frameId] = makeFrameNode(frameId, label, parent, x, y, 770, 520, fillToken, [labelId, captionId], {
    visible: false,
    enterPreset: "slide_in",
  });
  nodes[labelId] = makeTextNode(
    labelId,
    `${label} Label`,
    frameId,
    36,
    36,
    label,
    "color.text.primary",
    "typography.title.font",
    "typography.title.size",
    { width: 240, height: 50 },
  );
  nodes[captionId] = makeTextNode(
    captionId,
    `${label} Caption`,
    frameId,
    36,
    118,
    caption,
    "color.text.secondary",
    "typography.body.font",
    "typography.body.size",
    { width: 420, height: 140 },
  );
}

function addBar(
  nodes: Record<string, DemoNode>,
  barId: string,
  labelId: string,
  parent: string,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  fillToken: string,
) {
  nodes[barId] = makeShapeNode(barId, label, parent, x, y, width, height, fillToken, {
    visible: false,
    enterPreset: "scale_in",
  });
  nodes[labelId] = makeTextNode(
    labelId,
    `${label} Label`,
    parent,
    x + 36,
    828,
    label,
    "color.text.secondary",
    "typography.caption.font",
    "typography.caption.size",
    { width: width, height: 32 },
  );
}

function addArchitectureCard(
  nodes: Record<string, DemoNode>,
  frameId: string,
  textId: string,
  parent: string,
  x: number,
  y: number,
  title: string,
  body: string,
) {
  nodes[frameId] = makeFrameNode(frameId, title, parent, x, y, 282, 232, "color.surface.card", [textId], {
    visible: false,
    enterPreset: "slide_in",
  });
  nodes[textId] = makeTextNode(
    textId,
    `${title} Text`,
    frameId,
    24,
    26,
    `${title}\n${body}`,
    "color.text.primary",
    "typography.body.font",
    "typography.body.size",
    { width: 234, height: 160 },
  );
}

function makeTransform(left: number, top: number, width: number, height: number) {
  return { x: left, y: top, width, height, rotation: 0, scale_x: 1, scale_y: 1 };
}

function makeFrameNode(
  id: string,
  name: string,
  parent: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
  bgToken: string,
  children: string[] = [],
  options: { visible?: boolean; enterPreset?: string | null } = {},
) {
  return {
    id,
    name,
    parent,
    children,
    transform: makeTransform(x, y, width, height),
    style: {
      opacity: 1.0,
      fill: { path: bgToken },
      stroke: null,
      stroke_width: null,
      blur_radius: null,
      material: null,
    },
    layout: { layout_mode: "none", padding: null, gap: null, align_items: null, justify_content: null },
    animation: { enter_preset: options.enterPreset ?? null, exit_preset: null, stagger_delay: null },
    semantic: { role: null, label: null },
    visible: options.visible ?? true,
    locked: false,
    data: { type: "frame", clip_content: true, corner_radius: 24 },
  };
}

function makeShapeNode(
  id: string,
  name: string,
  parent: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
  fillToken: string,
  options: { visible?: boolean; enterPreset?: string | null } = {},
) {
  return {
    id,
    name,
    parent,
    children: [],
    transform: makeTransform(x, y, width, height),
    style: {
      opacity: 1.0,
      fill: { path: fillToken },
      stroke: null,
      stroke_width: null,
      blur_radius: null,
      material: null,
    },
    layout: { layout_mode: "none", padding: null, gap: null, align_items: null, justify_content: null },
    animation: { enter_preset: options.enterPreset ?? null, exit_preset: null, stagger_delay: null },
    semantic: { role: null, label: null },
    visible: options.visible ?? true,
    locked: false,
    data: { type: "shape", kind: "rectangle" },
  };
}

function makeTextNode(
  id: string,
  name: string,
  parent: string | null,
  x: number,
  y: number,
  content: string,
  colorToken: string,
  fontToken: string,
  sizeToken: string,
  options: { visible?: boolean; enterPreset?: string | null; width?: number; height?: number } = {},
) {
  return {
    id,
    name,
    parent,
    children: [],
    transform: makeTransform(x, y, options.width ?? 1600, options.height ?? 80),
    style: {
      opacity: 1.0,
      fill: null,
      stroke: null,
      stroke_width: null,
      blur_radius: null,
      material: null,
    },
    layout: { layout_mode: "none", padding: null, gap: null, align_items: null, justify_content: null },
    animation: { enter_preset: options.enterPreset ?? null, exit_preset: null, stagger_delay: null },
    semantic: { role: null, label: null },
    visible: options.visible ?? true,
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
