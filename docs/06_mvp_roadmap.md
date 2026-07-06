# 06 — MVP Roadmap

## MVP goal

Build the smallest version that proves the core product magic:

> A user can create a short professional motion-graphic presentation in the browser, present it live in Teams/Zoom by sharing a browser window, and get consistent rendering through a Rust/WASM engine with bundled brand assets.

The MVP should not try to replicate all of Figma, After Effects, PowerPoint, and Manim.

## MVP demo target

A convincing demo should be a 5-minute technical/executive presentation with:

```text
browser-based editor
Rust/WASM scene engine
custom canvas renderer
text, shapes, images
one polished animated chart type
semantic presentation steps
simple camera movement
brand package with tokens and bundled font
animated section/title component
fullscreen presentation mode
basic presenter notes
preflight check
PDF/static export fallback
```

## Guiding constraint

Every feature must serve this spine:

```text
Live animated presentations
+ professional motion quality
+ easy browser-based presenting
+ brand consistency
```

## Milestone 0 — Technical spike

Purpose: prove the rendering/runtime stack.

Scope:

```text
Rust core compiled to WASM
browser canvas integration
basic WebGPU or WebGL2 renderer
simple scene graph
rectangles, circles, text placeholder, image
transform animation
fullscreen presentation mode
keyboard navigation
```

Success criteria:

```text
runs in browser
renders 60 FPS for simple scenes
can advance between steps
can share browser window in Teams/Zoom manually
```

## Milestone 1 — Document model and commands

Purpose: establish the architectural foundation.

Scope:

```text
Document
Scene
Node
Step
AssetStore
Command system
Undo/redo
JSON serialization
TokenRef support placeholder
```

Minimum node types:

```text
Frame
Group
Text
Shape
Image
```

Minimum commands:

```text
CreateNode
DeleteNode
MoveNode
SetProperty
AddStep
SetStepCommand
```

Success criteria:

```text
document can be saved/loaded
all edits go through commands
undo/redo works
steps can alter scene state
```

## Milestone 2 — Figma-like basic editor

Purpose: make authoring possible.

Scope:

```text
web UI shell
canvas viewport
selection
move/scale handles
layers panel
properties inspector
asset import
basic snapping
keyboard shortcuts
```

Do not overbuild advanced vector editing.

Success criteria:

```text
user can create a simple scene visually
user can position text/shapes/images
user can define presentation steps
user can preview motion
```

## Milestone 3 — Tokenized brand package v0

Purpose: prove brand consistency and bundled fonts/assets.

Scope:

```text
tokens.json
font bundle support
basic color tokens
typography tokens
spacing tokens
motion duration/easing tokens
one logo/icon asset
brand package manifest
```

Features:

```text
nodes can reference tokens
runtime resolves tokens
font is loaded from package, not system install
raw color override warning
```

Success criteria:

```text
presentation renders correctly on a machine without installed brand font
switching token values updates the deck
preflight validates bundled font/assets
```

## Milestone 4 — Motion grammar v0

Purpose: make the product feel unlike PowerPoint.

Scope:

```text
FadeIn
SlideIn
ScaleIn
PopIn
Draw
Focus
DimOthers
CameraFocus
StaggeredReveal
```

Also:

```text
easing presets
simple spring preset
staggering
step-level transition presets
```

Success criteria:

```text
animated scenes feel polished with minimal manual timeline work
focus/highlight primitives work semantically
camera movement can replace slide transition
```

## Milestone 5 — Chart system v0

Purpose: prove Manim/explainer-like data storytelling.

Scope:

```text
Chart Platform v1 foundations:
- unified chart data model (table + typed series + transforms)
- shared chart grammar (axes, marks, legend, tooltip, annotations)
- shared interactions (hover/focus/select, zoom/pan, filter, sort, drill)
- shared animation grammar (enter/update/exit with identity-preserving transitions)

Storytelling Core:
- bar
- line
- area
- scatter
- waterfall
- histogram
- heatmap
- timeline

Semantic storytelling commands:
- highlight series/category
- dim/focus narrative state
- sort/filter/update data with identity preservation
- annotation/callout
```

Success criteria:

```text
charts look better than normal PowerPoint charts
bars grow from baseline and line/area can draw progressively
highlight/dim/focus works semantically
sort/filter/update preserve object identity
chart style and motion resolve from brand tokens
quality gates pass: deterministic rendering, accessibility defaults, export-safe fallback
```

## Chart expansion roadmap after v0

```text
Business & KPI Pack:
combo, stacked bar/area, lollipop, pareto, funnel, bullet, waffle, table/matrix, KPI cards, gantt/sparkline

Hierarchy & Flow Pack:
sankey, treemap, sunburst, chord, alluvial, force/network, radial tree, dendrogram

Statistical & Engineering Pack:
box/violin/ridgeline/density/parallel coordinates/hexbin/contour/error bars
then engineering/finance specializations (candlestick/OHLC, wind rose, ternary, etc.)

Cross-pack cinematic capabilities:
shared elements, camera-aware chart framing, guided reveal sequences, documentary-style presets

Parity targets:
D3 transition expressiveness + composability
Plotly interaction ergonomics + breadth
Seaborn statistical defaults + aesthetics
```

## Milestone 6 — Presentation runtime v0

Purpose: make it usable in real meetings.

Scope:

```text
fullscreen presentation mode
keyboard/clicker navigation
basic presenter notes
presenter view in second tab
asset preloading
preflight panel
reduced mode toggle
black screen
restart scene
```

Success criteria:

```text
can present a 5-minute deck live from browser
works by screen-sharing browser window
preflight gives confidence before starting
```

## Milestone 7 — Templates/components v0

Purpose: reduce blank-canvas problem.

Scope:

```text
TitleReveal
SectionIntro
ExecutiveSummary
BeforeAfter
KpiHighlight
AnnotatedChart
SimpleArchitectureDiagram
```

Each template should be:

```text
tokenized
animated
parameterized
usable from UI
```

Success criteria:

```text
user can build a polished short deck mostly from templates
components adapt when tokens change
```

Acceptance checklist for milestone completion:

```text
all 7 templates are insertable from the editor template browser
each inserted template is animated, tokenized, and parameterized
template instances update when token values change
short polished demo deck can be assembled primarily from templates without manual scene construction
```

## Milestone 8 — Export fallback v0

Purpose: make the product safe.

Scope:

```text
static PDF export
PNG export
possibly offline web bundle
```

PDF can initially render final states of scenes/steps.

Success criteria:

```text
user can send a static fallback
presentation is not trapped in the live runtime
```

## Milestone 9 — AI assistant v0

Purpose: validate AI usefulness without overcommitting.

Scope:

```text
storyboard from rough notes
template recommendations
speaker note generation
critique mode for text density and missing takeaway
basic chart explanation from provided data
```

Do not initially let AI mutate arbitrary document state without validation.

Success criteria:

```text
AI helps create a better structure
AI produces usable speaker notes
AI flags obvious design/story problems
```

## MVP feature cut line

Include:

```text
browser editor
custom renderer
semantic steps
basic motion presets
basic brand package
bundled fonts
basic charts
presentation mode
preflight
static export
```

Exclude for MVP:

```text
real-time collaboration
full Figma vector editing
full After Effects timeline complexity
advanced video editor
3D engine
plugin marketplace
PowerPoint round-trip editing
perfect PDF/vector export
advanced AI deck generation
```

## Validation demos

### Demo 1 — Corporate technical update

Topic example:

```text
AI-based gridline suppression improves image quality without changing acquisition workflow.
```

Scenes:

```text
Title reveal
Problem: grid artifacts visible in X-ray image
Before/after medical image comparison
Explanation: periodic pattern near Nyquist
Chart: quality metric improvement
Architecture: algorithm pipeline
Decision ask
```

Validates:

```text
medical/technical storytelling
image before/after
animated chart
camera/focus
brand consistency
Teams-safe presentation
```

### Demo 2 — Executive KPI update

Scenes:

```text
Executive summary
KPI dashboard
Waterfall or bar chart
Risk matrix
Roadmap
Decision slide
```

Validates:

```text
corporate usefulness
chart quality
templates
brand tokens
low-friction presentation
```

### Demo 3 — Explainer/education scene

Scenes:

```text
Concept intro
Equation reveal
Diagram morph
Line chart draw
Conclusion
```

Validates:

```text
Manim-like use case
scientific graphics direction
motion grammar
```

## Technical risks and mitigation

### Risk: Scope explosion

Mitigation:

```text
one killer demo first
few semantic objects
few excellent templates
avoid generic design-tool completeness
```

### Risk: Text rendering complexity

Mitigation:

```text
start constrained
bundle WOFF2 fonts
support basic rich text first
add complex shaping later
```

### Risk: WebGPU/corporate compatibility

Mitigation:

```text
WebGL2 fallback
reduced mode
preflight diagnostics
static export
```

### Risk: Brand font licensing

Mitigation:

```text
license metadata
font subsetting
admin-controlled package build
clear export constraints
```

### Risk: AI creates unreliable content

Mitigation:

```text
AI operates on structure
AI cannot invent chart data
AI suggestions reviewed before applying
brand package constrains output
```

## Post-MVP roadmap

### v0.2 — Better authoring

```text
improved timeline editor
component editing
constraints/autolayout
more chart types
better text animation
SVG import
Markdown import
basic collaboration comments
```

### v0.3 — Brand Studio

```text
brand package editor
motion tokens UI
chart style editor
font subsetting UI
component library management
brand compliance linter
package versioning
```

### v0.4 — AI scene generation

```text
structured scene generation
scene variants
AI motion director
AI chart assistant
AI deck critique
Q&A slide search
```

### v0.5 — Export and delivery

```text
MP4 export
offline bundle
presenter phone remote
improved PDF export
PowerPoint static fallback
presentation analytics optional
```

### v1.0 — Team product

```text
cloud projects
team libraries
brand registry
comments/review workflows
real-time collaboration
permissions
enterprise deployment model
```

## Implementation strategy

Recommended order:

```text
1. Engine spike
2. Document/command model
3. Browser editor shell
4. Brand tokens/fonts
5. Motion presets
6. One excellent chart
7. Presentation mode/preflight
8. Templates
9. Export fallback
10. AI assistant
```

Do not start with AI or collaboration. They become powerful only after the document model, token system, and semantic components exist.
