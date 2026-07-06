# 02 — Functional Specification

## Product modes

The application should support at least four major modes.

### 1. Authoring mode

A Figma-like browser UI for creating and editing presentations.

Core UI regions:

```text
Canvas
Layers panel
Properties inspector
Timeline / steps panel
Assets panel
Component library
Templates panel
Presenter notes
AI assistant panel
Preflight / validation panel
```

### 2. Presentation mode

Full-screen browser runtime for live presenting.

Requirements:

- opens from a URL or local/offline bundle;
- supports keyboard arrows, space, clicker input, and touch;
- works when shared in Teams/Zoom;
- supports reduced-performance fallback modes;
- preloads assets before starting;
- can use a separate presenter view.

### 3. Presenter view

Presenter window/tab with:

```text
current scene
next scene / next step
speaker notes
timer
progress indicator
upcoming builds
warning indicators
jump/search controls
```

Possible implementation options:

- two synced browser tabs;
- local BroadcastChannel for same-machine communication;
- WebSocket/WebRTC later for remote presenter devices.

### 4. Brand Studio

A dedicated area for brand package creation and management.

Brand Studio manages:

```text
design tokens
fonts
logos
icons
materials
chart styles
motion presets
camera rules
animated components
AI rules
accessibility modes
export modes
```

## Core authoring concepts

### Deck

A deck is the top-level document. It contains scenes, brand references, assets, notes, components, and export metadata.

### Scene

A scene is a presentation canvas state or sequence. It is similar to a slide, but more powerful. It may contain a continuous animated timeline and camera movement.

### Step

A step is a semantic presentation advance. It may trigger multiple animated state changes.

Example:

```text
Step 4: Focus on the bottleneck
- dim all other diagram nodes
- zoom camera slightly
- highlight bottleneck node
- reveal callout text
- update presenter notes
```

### Build

A build is a sub-animation within a scene. It controls progressive disclosure.

### Timeline

A timeline controls explicit timing. Users should not have to edit it for simple presentations, but it must be available for advanced choreography.

### Camera

The camera controls framing, zoom, pan, parallax, and possibly depth of field. Moving the camera should be a primary alternative to changing slides.

### Semantic node

A scene object with meaning, not just geometry.

Examples:

```text
Text
Shape
Image
Video
Chart
Equation
Diagram
Timeline
Pipeline
Architecture
Network
Callout
Comparison
```

## Scene graph features

Every object should eventually expose:

```text
position
rotation
scale
opacity
blur
clip
mask
material
shadow
children
constraints
layout behavior
semantic state
animation state
```

Objects should be nestable into groups and components.

## Animation features

### Property animation

Every relevant property should be animatable:

```text
transform
opacity
color
stroke width
blur
clip path
mask
material parameters
chart data
layout state
camera state
text content
```

### Animation presets

Users should not be forced to build animations from scratch. Provide high-quality presets:

```text
FadeIn
FadeOut
SlideIn
ScaleIn
PopIn
Draw
Grow
Morph
Focus
Highlight
Collapse
Expand
Ripple
Pulse
Float
Orbit
CameraZoom
CameraPan
StaggeredReveal
KineticTextReveal
```

### Motion-design principles

Presets should embody classic animation principles:

```text
staging
anticipation
slow-in / slow-out
arcs
follow-through
overlapping action
secondary action
timing
appeal
controlled exaggeration
```

For corporate/professional modes, playful effects should be controlled by tokens.

### Physics-inspired animation

Support animation primitives such as:

```text
spring to target
inertial follow
overshoot with damping
elastic scale
smooth pursuit
settle
```

Not for physical simulation realism, but for polished motion.

## Layout features

Support modern auto-layout behavior:

```text
flex layout
grid layout
constraints
alignment
smart distribution
spacing tokens
auto-resize text frames
responsive scene layout
safe areas
```

Layouts should animate smoothly when content changes.

Example:

```text
1 item centered
→ add second item
→ two-item comparison layout
→ add third item
→ three-card grid
```

## Storytelling primitives

Provide semantic storytelling commands/components:

```text
Focus(object)
Compare(left, right)
BeforeAfter(before, after)
BuildUp(items)
Reveal(object)
Transform(from, to)
Follow(object)
Callout(target)
DimOthers(target)
ZoomTo(target)
ExplainProcess(steps)
HighlightDifference(a, b)
ShowCausalChain(nodes)
```

These should compile into motion, layout, visual emphasis, and camera behavior.

## Text and typography features

Text is central to presentation quality.

Support:

```text
rich text spans
font family tokens
font size tokens
line-height tokens
character/word/line animation
typewriter reveal
blur-in reveal
kinetic typography
text morphing
bullet-to-diagram conversion
LaTeX/math rendering
font fallback chains
font bundling/subsetting
```

## Chart features

The chart system should be native, semantic, tokenized, and animated.

Initial chart types:

```text
bar chart
line chart
scatter plot
area chart
histogram
heatmap
waterfall chart
timeline chart
```

Later chart types:

```text
box plot
violin plot
radar chart
sankey diagram
chord diagram
network graph
treemap
sunburst
streamgraph
ridgeline plot
parallel coordinates
candlestick chart
gantt chart
funnel chart
bubble chart
matrix visualization
```

Every chart should support:

```text
enter
exit
morph
filter
sort
highlight
dim
zoom
pan
annotate
replay
change data
compare states
```

Chart platform requirements:

```text
unified table + typed-series data model
shared transform pipeline (sort/filter/group/pivot/calculate)
shared chart grammar (axes/marks/legend/tooltips/annotations)
shared interaction layer (hover/focus/select/zoom-pan/filter-sort/drill)
shared animation grammar (enter/update/exit, identity-preserving transitions)
```

Chart animations should be semantically correct:

```text
bar grows from baseline
line draws over x-axis
scatter points enter according to data order or cluster
sorted bars rearrange while preserving identity
filtered data fades/reflows
highlighted data uses semantic accent token
```

Quality gates for chart releases:

```text
deterministic rendering
accessibility defaults (contrast + colorblind-safe palettes + keyboard navigation)
export-safe fallback behavior
```

## Scientific and technical graphics

For technical presenters, support:

```text
coordinate systems
axes
vectors
fields
equations
matrices
probability distributions
signal plots
FFTs
medical images
DICOM import later
image before/after scrubber
volumes later
neural network diagrams
architecture diagrams
```

This is where the product can exceed normal business presentation tools.

## Modern materials and effects

Support a tokenized material system:

```text
glass
liquid glass
frosted glass
acrylic
paper
matte card
plastic
metal
glow
neon
shadowed surface
```

Effects should include:

```text
blur
backdrop blur
refraction approximation
edge highlight
shadow
ambient occlusion style shading
gradient meshes
noise overlays
masks
clipping
blend modes
particles
soft glow
```

All effects must degrade gracefully in fallback modes.

## Templates and components

Templates should be animated and semantic, not static slide masters.

Template categories:

```text
title reveal
agenda build-up
section divider
problem framing
insight reveal
before/after comparison
timeline
roadmap
system architecture
process flow
data story
scientific derivation
executive summary
KPI dashboard
quote reveal
product hero
conclusion / decision slide
appendix detail
```

Components should be reusable, parameterized, token-aware, and brand-approved.

Example component:

```text
ExecutiveSummary
- title
- three key points
- optional KPI row
- tokenized layout
- tokenized motion
- tokenized typography
```

## Import features

Adoption requires importing existing materials.

Prioritized imports:

```text
images
SVGs
videos
CSV/JSON data
Markdown notes
LaTeX equations
PowerPoint as static scene import
PDF as static scene import
Excel later
Figma import later
```

PowerPoint import does not need to be perfect initially. Even a static import plus AI-assisted upgrade path would be useful.

## Export features

Live browser presentation is the main path, but exports are essential for safety.

Support:

```text
PDF export
PNG export
MP4 export
static PowerPoint fallback later
offline web bundle
asset package export
speaker notes export
transcript export
```

The live version is the premium version. The fallback versions make the product safe in real organizations.

## Preflight checks

Before presenting, run a presentation readiness check:

```text
brand font loaded
font subset complete
logos available
images/videos cached
all assets checksummed
WebGPU available or fallback selected
offline cache ready
presenter view connected
remote control connected
no missing media
no broken data links
no raw unapproved colors
no contrast violations
no overly small text for Teams/projector mode
```

The user should see a simple state:

```text
Presentation Ready
```

with details expandable.

## Presentation delivery features

### Basic controls

```text
next step
previous step
jump to scene
black screen
pause animation
restart scene
show pointer / laser
```

### Remote control

Phone remote:

```text
scan QR code
control next/previous
see notes
timer
jump to section
```

### Q&A navigation

During Q&A, the presenter should be able to search or jump:

```text
show backup slide about validation
jump to architecture detail
open appendix chart
search deck for detector MTF
```

Long term, the deck becomes a navigable content graph, not only a linear sequence.

## Accessibility

Support:

```text
high contrast mode
reduced motion mode
colorblind-safe chart palettes
font size warnings
caption/subtitle support
screen-reader text metadata
reading order
transcript export
PDF accessibility metadata later
```

## Collaboration direction

Not required for MVP, but the architecture should prepare for:

```text
comments
version history
branching
review mode
shared brand packages
team libraries
real-time collaboration
approval workflows
```

The command-based document model is important for this.
