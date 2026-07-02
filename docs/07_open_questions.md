# 07 — Open Questions

This file lists important product and engineering questions to resolve before or during implementation.

## Product scope

### What is the first killer use case?

Possible first use cases:

```text
corporate executive updates
technical deep dives
scientific explainers
AI/product concept pitches
medical imaging demonstrations
```

Recommendation: pick one primary demo and optimize ruthlessly for it.

### Is the first user a coder, designer, or presenter?

Possible starting points:

```text
coder-first framework with browser preview
designer-first Figma-like editor
presenter-first template-based app
```

Recommendation: start with enough code/config to move fast, but validate with a browser-presentable demo early.

### How much manual timeline editing should be exposed?

Options:

```text
simple step-based authoring only
advanced timeline panel later
full keyframe editor early
```

Recommendation: semantic steps first, advanced timeline later.

## Naming and positioning

### Is this a framework, product, or platform?

Possible framing:

```text
Rust framework for motion presentations
browser-native presentation app
motion-graphics presentation platform
brand-governed presentation system
```

Recommendation: build the engine like a framework, but position the product around live professional presentations.

### What should the product be called?

Placeholder options:

```text
MotionDeck
SceneDeck
LiveMotion
Deckflow
Frameflow
Narrative Engine
Kinetic Deck
```

No final name is needed yet.

## Rendering architecture

### WebGPU direct or wgpu?

Options:

```text
raw WebGPU bindings
wgpu abstraction
custom WebGL2 first
Canvas/SVG first
```

Recommendation: strongly consider `wgpu` for Rust-native and web portability, but spike early to check WASM/browser constraints.

### How much should be vector vs raster?

Questions:

```text
Should shapes render as GPU tessellated vectors?
Should text be glyph atlas based?
Should SVGs be preprocessed?
Should charts become geometry buffers?
How should PDF export preserve vector quality?
```

Recommendation: real-time renderer can rasterize/composite efficiently; export can become more vector-aware later.

### How advanced should Liquid Glass be initially?

Possible levels:

```text
simple translucent card + blur
backdrop blur + edge highlight
refraction approximation
complex physically inspired shader
```

Recommendation: start with beautiful simplified glass that degrades well.

## Text and fonts

### Which text shaping stack?

Questions:

```text
Use browser text measurement?
Use Rust text shaping?
Use glyph atlas from day one?
How to support complex scripts?
How to support math?
```

Recommendation: constrain MVP text, but design for deterministic font loading and glyph rendering.

### How to handle font licensing?

Questions:

```text
Can full fonts be bundled?
Can subset fonts be exported?
How to store license metadata?
Who is allowed to create brand packages?
```

Recommendation: make license metadata part of brand package manifest early.

## Document model

### JSON, RON, binary, or hybrid?

Options:

```text
JSON for interoperability
RON for Rust ergonomics
binary for performance
hybrid: JSON manifest + binary assets
```

Recommendation: start with human-readable JSON for document and token format; optimize later.

### How strict should the schema be?

Questions:

```text
How to migrate old documents?
How to handle plugin/component versions?
How to validate AI-generated patches?
```

Recommendation: version all document schemas early.

### How to represent semantic diffs?

Question:

```text
Are presentation steps stored as final states, commands, or both?
```

Possible approach:

```text
store semantic commands for editability
cache resolved states for playback/performance
```

## Token system

### How many token domains in v0?

Possible v0:

```text
color
typography
spacing
motion
chart
```

Later:

```text
materials
camera
effects
AI rules
accessibility modes
```

Recommendation: include extension points from day one, but only implement a few domains in MVP.

### How to handle raw overrides?

Options:

```text
forbid raw values
allow but warn
allow freely
```

Recommendation: allow raw overrides with visible lint warnings.

### How should modes compose?

Mode axes can conflict:

```text
dark + PDF
Teams + executive
projector + dense technical
```

Need deterministic precedence rules.

Possible precedence:

```text
base tokens
→ theme mode
→ medium mode
→ audience mode
→ deck overrides
→ object overrides
```

## Brand packages

### Are brand packages embedded or referenced?

Options:

```text
embed full package in deck
reference package by version
embed resolved subset
hybrid: reference + local frozen snapshot
```

Recommendation: use hybrid.

A deck can reference:

```text
CorporateBrand@3.2.1
```

but also contain a frozen subset for reliable playback/export.

### How are brand package updates applied?

Questions:

```text
Can updates break decks?
Can users preview changes?
Can users keep old versions?
Can admins force updates?
```

Recommendation: versioned packages with previewable migration.

## AI

### What should AI be allowed to modify?

Options:

```text
suggest only
create draft scenes
apply changes after user approval
fully autonomous deck creation
```

Recommendation: suggestion and draft mode first; structured patches with validation later.

### How to prevent AI from producing random off-brand visuals?

Answer:

```text
AI must compose from approved components, templates, and tokens.
```

### How to prevent invented data?

Rules:

```text
charts must bind to source data
AI can summarize visible trends but cannot invent values
claims should be traceable to user-provided content
```

## Templates and components

### How expressive should components be?

Options:

```text
static layout components
animated declarative components
scriptable components
compiled plugin components
```

Recommendation: declarative animated components first. Sandboxed scripting later.

### How should components adapt to modes?

Questions:

```text
Can one component render differently in Teams mode?
Can it simplify for PDF?
Can it use different motion in executive mode?
```

Recommendation: components should resolve through tokens and active modes.

## Presentation delivery

### How robust must offline mode be?

Options:

```text
online-only MVP
service-worker cached projects
downloadable offline bundle
native desktop wrapper later
```

Recommendation: support offline bundle soon after MVP because corporate presentation reliability matters.

### How should presenter view sync?

Options:

```text
same-browser BroadcastChannel
local WebSocket
cloud sync
WebRTC
```

Recommendation: BroadcastChannel first for same-machine two-tab presenter view.

### Should there be a phone remote in MVP?

Probably not required for MVP, but design presentation navigation API so it can be added cleanly.

## Export

### What level of PDF quality is required first?

Options:

```text
raster screenshots per scene
hybrid vector/raster
full vector export
```

Recommendation: raster/static PDF fallback first. Full vector later.

### How to export animated presentations to video?

Options:

```text
browser MediaRecorder
server-side renderer
native CLI renderer
headless browser capture
```

Recommendation: defer MP4 until renderer is stable.

## Collaboration

### When to implement real-time collaboration?

Recommendation: not before the command/document model is stable and single-user editing works well.

### Command log, OT, or CRDT?

Open. The command architecture should avoid random mutation, so either approach remains possible.

## MVP decision checklist

Before building, decide:

```text
primary demo use case
working product name
web framework for shell
renderer spike path
initial document format
initial token domains
initial chart type
initial brand package example
presentation delivery baseline
export fallback baseline
```

## Highest leverage next step

Build a tiny vertical slice:

```text
one browser page
one Rust/WASM scene engine
one brand package with bundled font
one title scene
one image scene
one animated chart scene
one fullscreen present button
one preflight checklist
```

This vertical slice will reveal most hard problems early without drowning in product scope.
