# 01 — Product Vision

## Core idea

The goal is to create a motion-graphic framework and application for live presentations that look like professional animated explainer videos, but can still be presented as easily as PowerPoint or Keynote.

The product should combine:

- the **live convenience** of PowerPoint/Keynote;
- the **visual polish** of professional YouTube explainers and motion graphics;
- the **semantic animation grammar** of Manim;
- the **design-system discipline** of Figma;
- the **runtime robustness** of a browser-based application;
- the **performance and determinism** of a Rust/WASM/WebGPU rendering engine.

The product is not primarily a slide editor. It is a **live motion-graphics presentation engine** with a Figma-like browser UI.

## Why this should exist

PowerPoint is optimized for static slides with occasional animations. Professional motion graphics are usually created in tools like After Effects, rendered to video, and then played back. That workflow is too slow and too rigid for normal business, research, and technical presentations.

The missing product is a live presentation system where the presenter can create scenes that feel like polished explanatory videos but remain editable, interactive, and presentable in ordinary meeting environments.

## Product statement

> I design like Figma.  
> I present like PowerPoint.  
> It moves like After Effects.  
> It explains like Manim.  
> It scales like a design system.

## Strategic differentiation

### 1. It is live, not rendered

The user should not have to render a video before presenting. Presentation mode should be a browser runtime:

```text
Open URL → Present full screen → Share browser window in Teams/Zoom → Done
```

Rendering may happen in real time using WebGPU/WebGL and a Rust/WASM engine.

### 2. It is semantic, not only visual

Objects should not be only rectangles, text boxes, and lines. They should be semantic objects:

```text
BarChart
LineChart
Timeline
ArchitectureDiagram
Equation
Pipeline
Matrix
NetworkGraph
MedicalImageComparison
Callout
DecisionTree
```

A semantic object knows how it should naturally animate. A bar chart knows that bars grow from a baseline. A text object knows that unchanged words can persist during a rewrite. A diagram knows that nodes can keep identity across layout changes.

### 3. It is motion-first

Motion should not be a decorative afterthought. Motion should be part of the communication grammar.

The engine should help answer:

```text
Where should the audience look?
What changed?
What is important?
What is the causal relation?
What should be remembered?
What decision should the audience make?
```

### 4. It is tokenized and brand-governed

PowerPoint templates copy style into decks. This framework should keep style live through tokens:

```text
color.text.primary
motion.reveal.precise
chart.series.primary
material.glass.subtle
layout.executive.spacious
typography.title.large
```

A presentation should resolve its colors, fonts, materials, chart styles, motion curves, and AI generation constraints from a versioned brand package.

### 5. It is AI-assisted, but still editable

AI should not generate flat slide images. AI should generate and modify editable scene graph objects:

```text
Title
Chart
Callout
Timeline
Camera move
Highlight
Transition
Presenter notes
```

AI acts as a storyboarder, designer, motion director, chart assistant, critic, and rehearsal coach.

## Target user groups

### Technical presenter

Examples: researchers, engineers, AI/ML developers, physicists, product architects.

Needs:

- explain complex ideas visually;
- animate equations, diagrams, charts, images, and system flows;
- present in Teams/Zoom without a fragile setup;
- export PDF/MP4 when needed;
- keep branding consistent.

### Corporate expert / product owner

Needs:

- make executive updates more convincing;
- show roadmaps, KPIs, tradeoffs, risks, and decisions;
- avoid ugly old template copies;
- reuse approved company components;
- produce polished presentations quickly.

### Brand/design team

Needs:

- define official presentation brand packages;
- enforce fonts, tokens, chart rules, logo safety, and motion style;
- ship updated brand systems without emailing new PowerPoint templates;
- provide reusable animated components.

### Educator / explainer creator

Needs:

- create Manim-like explanatory animations without writing everything in code;
- use timeline, camera, equations, diagrams, and data visuals;
- export to video if desired;
- reuse templates for conceptual storytelling.

## Core principles

### Presentation must remain frictionless

If presenting is annoying, the product loses its value.

The standard path must be:

```text
Open browser → Present → Share screen → Works
```

No OBS. No local installs. No missing fonts. No broken media links. No mandatory video render. No fragile corporate-machine assumptions.

### The browser is the runtime target

The browser should be a first-class runtime, not an afterthought. It gives easy distribution, sharing, collaboration, and Teams/Zoom compatibility.

### Rust is the engine

Rust should own deterministic, performance-critical logic:

```text
scene graph
layout
animation
timeline evaluation
chart geometry
morphing
hit testing
asset preparation
rendering abstractions
export logic
```

### The DOM is not the canvas

The DOM should be used for product UI: panels, menus, inspector, comments, file browser. The actual presentation canvas should be a custom renderer.

### The deck is a portable visual system

A presentation should bundle or reference a brand package, fonts, assets, tokens, components, and runtime requirements. It should not depend on the presenting machine having the right fonts installed.

### Good defaults matter more than maximum freedom

The product should guide users toward professional results. Raw overrides should exist, but the preferred workflow should use tokens, templates, and semantic components.

## Product metaphor

The product is best understood as:

```text
Content graph
+ Brand system
+ Motion grammar
+ Live browser runtime
+ AI director
```

Not:

```text
Slides + transitions
```

## The long-term product vision

A company could define a brand package once:

```text
colors
fonts
layout system
materials
chart styles
motion language
camera behavior
animated components
AI constraints
export modes
```

Then normal users create presentations from approved templates and components. The AI helps with structure, story, animation, chart selection, and critique. The renderer guarantees consistent output, bundled fonts, and preflight validation. Presentations can be run live in the browser, exported to PDF/MP4, or shared as interactive URLs.

That would replace the broken chain:

```text
corporate brand PDF
+ PowerPoint template
+ manually installed fonts
+ old slides copied around
+ random chart formatting
+ broken animations
```

with:

```text
versioned brand package
+ tokenized semantic deck
+ bundled fonts/assets
+ reusable animated components
+ deterministic browser runtime
+ preflight validation
```
