# 03 — Architecture Plan

## Architecture thesis

The product should use the browser for distribution and product UX, while the core graphics, layout, timeline, animation, charts, and rendering logic live in Rust.

A compact formulation:

> Rust is the engine.  
> The browser is the operating system.  
> The web app is the product shell.

## High-level architecture

```text
┌──────────────────────────────────────────────┐
│ Web Product Layer                             │
│ React/Svelte/Vue, panels, assets, accounts    │
└──────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────┐
│ Editor Interaction Layer                      │
│ selection, snapping, handles, shortcuts, undo  │
└──────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────┐
│ Rust/WASM Core                                │
│ scene graph, layout, animation, charts, text   │
└──────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────┐
│ Renderer                                      │
│ WebGPU first, WebGL2/canvas fallback           │
└──────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────┐
│ Browser Runtime                               │
│ edit mode, present mode, presenter view        │
└──────────────────────────────────────────────┘
```

## Layer responsibilities

### Web product layer

Responsible for:

```text
project dashboard
menus
toolbars
properties panels
asset browser
template browser
AI chat panel
authentication later
cloud storage later
collaboration UI later
```

This layer should be implemented in TypeScript using a standard web framework.

Candidates:

```text
SvelteKit
React/Next.js
Vue/Nuxt
```

The renderer/editor core should remain framework-independent.

### Rust/WASM core

Responsible for deterministic and performance-sensitive logic:

```text
document model
scene graph
command system
undo/redo
selection model
hit testing
snapping
layout evaluation
timeline evaluation
animation interpolation
semantic transitions
chart geometry
morphing
text shaping coordination
asset preprocessing
preflight checks
export preparation
```

### Renderer

Responsible for drawing the resolved scene efficiently.

Primary path:

```text
Rust → WASM → WebGPU
```

Fallback paths:

```text
Rust → WASM → WebGL2
Canvas/SVG/static fallback
Native wgpu renderer later
```

## Render tier strategy

The product must always present, even if effects degrade.

```text
Tier 1: WebGPU
  full effects
  liquid glass
  blur pipelines
  particles
  shadows
  gradient meshes
  compute-assisted features where useful

Tier 2: WebGL2
  reduced effects
  simplified glass
  fewer post-processing passes
  still smooth enough for presentation

Tier 3: Canvas/SVG/PDF/static fallback
  reduced motion or static presentation
  safe for hostile corporate machines
```

User-facing promise:

> It always presents. On good machines it looks cinematic.

## Recommended package split

```text
motion-core
  Rust library
  document model, scene graph, tokens, commands, layout, animation

motion-render
  Rust library
  renderer abstraction, render tree, GPU resources, draw passes

motion-wasm
  Rust crate
  wasm-bindgen bindings, browser API boundary

motion-ui
  TypeScript web app
  editor shell, panels, inspector, template browser, AI panel

motion-server
  Rust or Node service later
  auth, storage, collaboration, package registry

motion-cli
  Rust command-line tool
  validation, export, testing, package build

motion-templates
  shared templates, brand packages, components
```

## Document model

The document model is the core product asset.

A possible structure:

```rust
struct Document {
    id: DocumentId,
    metadata: DocumentMetadata,
    brand: BrandBinding,
    assets: AssetStore,
    components: ComponentLibrary,
    scenes: Vec<Scene>,
    notes: PresenterNotes,
    timelines: Vec<Timeline>,
    export_settings: ExportSettings,
}
```

### Scene

```rust
struct Scene {
    id: SceneId,
    name: String,
    root: NodeId,
    camera: CameraNode,
    steps: Vec<Step>,
    local_timeline: Option<TimelineId>,
    notes: Option<String>,
}
```

### Node

```rust
enum NodeKind {
    Frame(FrameNode),
    Group(GroupNode),
    Text(TextNode),
    Shape(ShapeNode),
    Image(ImageNode),
    Video(VideoNode),
    Chart(ChartNode),
    Equation(EquationNode),
    Diagram(DiagramNode),
    Camera(CameraNode),
    Effect(EffectNode),
    ComponentInstance(ComponentInstanceNode),
}

struct Node {
    id: NodeId,
    name: String,
    parent: Option<NodeId>,
    children: Vec<NodeId>,
    transform: Transform,
    style: NodeStyle,
    layout: LayoutProperties,
    animation: AnimationProperties,
    semantic: SemanticProperties,
    kind: NodeKind,
}
```

### Style values

Node properties should preserve token references.

```rust
enum StyleValue<T> {
    Literal(T),
    Token(TokenRef),
}

struct TokenRef {
    path: String,
}
```

Example:

```rust
struct TextNode {
    content: String,
    color: StyleValue<Color>,
    font_family: StyleValue<FontFamily>,
    font_size: StyleValue<f32>,
    line_height: StyleValue<f32>,
    motion_preset: StyleValue<MotionPreset>,
}
```

Editor model:

```text
semantic, tokenized, editable
```

Render model:

```text
resolved, numeric, fast
```

## Semantic steps

A step is not just a slide advance. It is a semantic diff.

```rust
struct Step {
    id: StepId,
    name: String,
    commands: Vec<PresentationCommand>,
    transition: TransitionSpec,
    duration_policy: DurationPolicy,
    notes: Option<String>,
}
```

Example commands:

```rust
enum PresentationCommand {
    Focus { target: NodeId },
    Highlight { target: NodeId, style: HighlightStyle },
    DimOthers { target: NodeId },
    SetProperty { node: NodeId, property: PropertyPath, value: Value },
    ReplaceText { node: NodeId, new_text: String },
    ChartSetData { chart: NodeId, data: DataRef },
    ChartHighlightSeries { chart: NodeId, series: String },
    CameraFocus { target: NodeId, framing: CameraFraming },
    Reveal { target: NodeId },
    Hide { target: NodeId },
    Morph { from: NodeId, to: NodeId },
}
```

The engine compiles semantic commands into animated property transitions.

## Command system

All document changes should flow through commands.

```rust
enum Command {
    CreateNode(CreateNodeCommand),
    DeleteNode(DeleteNodeCommand),
    MoveNode(MoveNodeCommand),
    SetProperty(SetPropertyCommand),
    GroupNodes(GroupNodesCommand),
    UngroupNodes(UngroupNodesCommand),
    AddKeyframe(AddKeyframeCommand),
    SetData(SetDataCommand),
    ApplyTemplate(ApplyTemplateCommand),
    GenerateSceneFromPrompt(AiGeneratedSceneCommand),
}
```

Pipeline:

```text
command → validation → document patch → undo log → render invalidation
```

Benefits:

```text
undo/redo
version history
collaboration later
AI edits
review diffs
audit trail
replayable document changes
```

## Runtime state machine

Presentation runtime should be deterministic.

```rust
enum RuntimeState {
    Loading,
    Preflight,
    Ready,
    Presenting,
    Paused,
    FallbackMode,
    Error,
}
```

Presentation navigation:

```rust
enum NavigationCommand {
    NextStep,
    PreviousStep,
    JumpToScene(SceneId),
    JumpToStep(StepId),
    RestartCurrentScene,
    Pause,
    Resume,
    BlackScreen,
}
```

## Token resolution pipeline

```text
Document with token refs
+ Brand package
+ Active modes
+ Local overrides
        │
        ▼
Resolved style tree
        │
        ▼
Layout tree
        │
        ▼
Render tree
        │
        ▼
GPU draw commands
```

Example active modes:

```text
light + live + Teams + executive
```

The same semantic deck can resolve differently depending on mode.

## Render pipeline

A retained rendering architecture is preferred.

```text
document model
→ resolved scene
→ layout tree
→ render tree
→ GPU resources
→ draw commands
```

### Dirty invalidation

Avoid full rebuilds when possible.

Examples:

```text
text changed
  → re-shape text, update glyph buffers

chart data changed
  → rebuild chart geometry

camera moved
  → reuse geometry, update view transform

material changed
  → update uniforms / pipeline selection

layout changed
  → recompute affected subtree
```

## Effects pipeline

For modern visual quality, support offscreen passes:

```text
shape pass
text pass
image/video pass
shadow pass
blur pass
mask pass
glass/refraction approximation pass
particle pass
composite pass
color grading pass
```

Material examples:

```rust
enum Material {
    Solid(Color),
    Gradient(GradientSpec),
    Glass(GlassMaterial),
    MatteCard(CardMaterial),
    Glow(GlowMaterial),
}
```

Glass material:

```rust
struct GlassMaterial {
    tint: StyleValue<Color>,
    opacity: StyleValue<f32>,
    blur_radius: StyleValue<f32>,
    saturation: StyleValue<f32>,
    edge_highlight: StyleValue<Color>,
    noise_strength: StyleValue<f32>,
}
```

## Text architecture

Text is a major subsystem.

Requirements:

```text
font loading
font subsetting
fallback fonts
glyph atlas
rich text spans
line breaking
OpenType features
subpixel positioning
text animation by glyph/word/line
LaTeX/math rendering
consistent browser/native output
```

Possible components:

```text
fontdb for font management
cosmic-text or similar for shaping exploration
custom glyph atlas for renderer
KaTeX/MathJax bridge initially for equations, custom later if needed
```

Important architectural rule:

> The editor may temporarily rely on browser text for UI, but the presentation renderer needs deterministic text output.

## Asset system

Assets should be content-addressed.

```rust
struct Asset {
    id: AssetId,
    kind: AssetKind,
    uri: AssetUri,
    hash: ContentHash,
    metadata: AssetMetadata,
    license: Option<LicenseMetadata>,
}
```

Asset kinds:

```text
font
image
video
svg
icon
data
shader/material resource
component package
brand package
```

The runtime should validate hashes during preflight.

## Browser integration API

Expose a compact WASM boundary.

```ts
engine.loadDocument(documentBytes)
engine.loadBrandPackage(packageBytes)
engine.setViewport(width, height, scale)
engine.render(timestamp)
engine.pointerDown(x, y, modifiers)
engine.pointerMove(x, y)
engine.pointerUp(x, y)
engine.applyCommand(command)
engine.undo()
engine.redo()
engine.nextStep()
engine.previousStep()
engine.jumpToScene(sceneId)
engine.getSelection()
engine.inspect(selection)
engine.runPreflight()
```

Keep high-frequency rendering and interaction logic inside Rust where possible.

## Persistence model

### Local first

For early versions:

```text
IndexedDB for local projects/assets
local file export/import
offline cache via service worker
```

### Cloud later

```text
project storage
brand package registry
team libraries
shared assets
version history
comments
collaboration
```

## Collaboration architecture later

The command model prepares for collaboration, but real-time collaboration needs conflict handling.

Options:

```text
OT-style command transformation
CRDT-backed document state
server-authoritative command log
branch/merge workflow for deck edits
```

Do not implement this in MVP, but avoid architecture that makes it impossible.

## Export architecture

Export paths:

```text
PDF export
  render each scene/step to vector/raster hybrid or static snapshots

MP4 export
  deterministic timeline playback to frames
  encode via browser APIs or native CLI/server

PNG export
  render selected scenes/steps

Offline bundle
  document + engine + assets + brand package + manifest

PowerPoint fallback later
  static images per scene plus notes
```

## Preflight architecture

Preflight should be a formal subsystem.

Checks:

```text
asset availability
font availability
font licensing/subsetting metadata
renderer capability
fallback compatibility
missing data links
contrast
tiny text
raw token overrides
unsupported effects in current mode
video codec support
offline cache readiness
presenter view connection
```

Return structured results:

```rust
struct PreflightReport {
    status: PreflightStatus,
    checks: Vec<PreflightCheck>,
    suggested_fixes: Vec<FixSuggestion>,
}
```

## Security and licensing considerations

Important from day one:

```text
font licensing metadata
asset provenance
AI-generated asset provenance
private/internal brand packages
safe sharing permissions
sandboxed custom components/plugins
no arbitrary code execution from untrusted decks
```

Custom components should initially be declarative or compiled from trusted packages only.

## Performance targets

Initial targets:

```text
60 FPS presentation playback for normal scenes
30 FPS acceptable for heavy fallback mode
instant step navigation after preload
large deck preflight under a few seconds for normal decks
smooth editing interactions for typical scene sizes
```

Measure:

```text
frame time
GPU memory
asset load time
font load time
layout time
chart geometry build time
command latency
WASM boundary overhead
```

## Architectural risks

### Scope explosion

Risk: accidentally building Figma + After Effects + PowerPoint + Manim + video editor simultaneously.

Mitigation:

```text
MVP centered on live animated presentations
small semantic object set
few excellent templates
few excellent chart types
presentation runtime before complex editor features
```

### Text complexity

Risk: typography is harder than expected.

Mitigation:

```text
start with constrained text features
use browser/JS assist where practical
own deterministic render path before serious export promises
```

### WebGPU availability

Risk: corporate devices may have limited GPU/browser support.

Mitigation:

```text
WebGL2 fallback
static fallback
preflight diagnostics
Teams/projector/reduced mode
```

### Brand package licensing

Risk: bundled fonts may have licensing constraints.

Mitigation:

```text
license metadata
subsetting support
admin-controlled brand packages
clear export permissions
```
