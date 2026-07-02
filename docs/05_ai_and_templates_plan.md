# 05 — AI and Templates Plan

## Core philosophy

AI should not generate arbitrary flat slide images.

AI should generate, edit, critique, and compose structured presentation objects:

```text
scenes
semantic nodes
charts
story patterns
camera moves
motion presets
speaker notes
brand-compliant components
```

The output must remain editable, tokenized, inspectable, and brand-governed.

## Bad AI pattern

```text
User: Generate me a slide.
AI: Produces a pretty but uneditable image.
```

Problems:

```text
not editable
not deterministic
not brand-compliant
numbers may be unreliable
charts are not data-backed
cannot update with new tokens
cannot export cleanly
cannot be reused as components
```

## Good AI pattern

```text
User: Create a 5-minute executive update from these notes.
AI:
  creates a storyboard
  selects templates
  creates semantic scenes
  adds data-backed charts
  applies brand tokens
  proposes motion choreography
  writes speaker notes
  runs critique/preflight
```

The generated deck remains a normal document.

## AI roles

### 1. Story editor

The AI helps shape the argument.

Input:

```text
Audience: executives
Goal: get support for productionization
Time: 7 minutes
Topic: AI-based detector sorting
```

Output:

```text
1. The hidden cost of detector variation
2. Why classical correction is not enough
3. The AI sorting idea
4. Evidence that it works
5. Deployment path
6. Decision needed
```

Then it creates a storyboard:

```text
Scene 1: Show many detectors as tiles
Scene 2: Highlight variation
Scene 3: Morph variation into quality risk
Scene 4: Introduce AI model
Scene 5: Show before/after sorting chart
Scene 6: End with decision slide
```

### 2. Scene composer

The AI composes scenes from semantic components.

Example internal output:

```text
Create Scene: Problem Framing
- Title: "Detector variation is invisible until it becomes image quality risk"
- Background: tokenized subtle technical grid
- Main visual: detector tile field
- Motion: staggered reveal → variation highlight → dim others
- Callout: "Small manufacturing differences accumulate into visible artifacts"
- Notes: explain in non-technical language first
```

### 3. Motion director

The AI adjusts timing, emphasis, camera motion, and transition style.

User commands:

```text
Make this feel more premium.
Make this transition calmer.
Make this chart reveal more like an explainer video.
Make this section feel more urgent.
Make this suitable for executives.
```

AI changes:

```text
timing
easing curves
staggering
camera motion
animation order
emphasis
color contrast
amount of movement
```

Interpretation examples:

```text
More executive
  slower motion
  less bounce
  larger whitespace
  fewer objects
  stronger hierarchy
  restrained color

More YouTube explainer
  faster cuts
  kinetic text
  more morphing
  stronger anticipation
  more icons
```

### 4. Design critic

The AI reviews the deck and identifies problems.

Possible feedback:

```text
This scene has too much text.
This chart has no clear takeaway.
This animation competes with the speaker.
This transition is too slow.
This section lacks a visual anchor.
The audience may not understand what changed here.
This claim needs evidence.
This color contrast is too weak.
This object uses a raw color instead of a token.
```

Suggested fixes:

```text
Convert this bullet list into a 3-step process diagram.
Turn this table into a highlighted ranking chart.
Split this scene into two builds.
Move this detail to speaker notes.
Use executive-summary template.
Apply Teams mode contrast correction.
```

### 5. Chart assistant

AI helps choose the right visualization and narrative.

User input:

```text
CSV/Excel data
rough question
presentation audience
```

AI output:

```text
recommended chart type
main trend
outliers
comparison points
annotations
animated reveal sequence
speaker note explanation
```

Example chart reveal:

```text
1. Axes appear
2. Baseline appears
3. Main trend draws
4. Inflection point is marked
5. Comparison series fades in
6. Takeaway appears as text
```

### 6. Rehearsal coach

AI helps with timing and delivery.

Features:

```text
estimate speaking time
compare actual rehearsal time to target
identify sections too long
suggest cuts
rewrite speaker notes conversationally
generate likely audience questions
prepare backup answers
```

Example:

```text
You rehearsed this in 12:40.
Target was 10:00.
Suggested cuts:
- shorten intro by 45 seconds
- merge scenes 4 and 5
- move technical detail to appendix
```

### 7. Q&A assistant

During or before Q&A, AI can help navigate.

Examples:

```text
Find the slide about detector MTF.
Show backup slide about validation.
Jump to the architecture diagram.
Where do we explain uncertainty?
```

Long term, this turns the deck into a searchable content graph.

## AI must be brand-bound

AI generation should resolve through brand tokens and approved components.

Instead of inventing styles, it should choose:

```text
component: ExecutiveSummary
chart style: ClinicalDataDefault
motion: PreciseReveal
material: GlassCardSubtle
typography: TitleLarge
accent: BrandOrange
```

This makes AI usable in corporate environments.

## AI rules in brand package

Example:

```json
{
  "ai.voice": "precise, calm, technical, premium",
  "ai.avoid": [
    "cartoonish motion",
    "excessive gradients",
    "clipart",
    "red warning circles"
  ],
  "ai.preferredLayouts": [
    "hero-stat",
    "technical-diagram",
    "before-after",
    "annotated-chart"
  ],
  "ai.maxWordsPerScene.executive": 28,
  "ai.maxWordsPerScene.technical": 70,
  "ai.chartTakeawayRequired": true
}
```

## AI output format

AI should emit structured commands or document patches, not only prose.

Example:

```json
{
  "type": "CreateScene",
  "template": "BeforeAfterComparison",
  "tokens": {
    "accent": "color.accent.emphasis",
    "motion": "motion.reveal.precise"
  },
  "nodes": [
    {
      "kind": "Title",
      "content": "Grid artifacts are structured noise"
    },
    {
      "kind": "ImageComparison",
      "before": "asset.raw_xray",
      "after": "asset.cleaned_xray"
    },
    {
      "kind": "Callout",
      "target": "grid_region",
      "content": "Periodic pattern near detector sampling limit"
    }
  ],
  "steps": [
    { "command": "Reveal", "target": "before" },
    { "command": "Focus", "target": "grid_region" },
    { "command": "Morph", "from": "before", "to": "after" },
    { "command": "Reveal", "target": "takeaway" }
  ]
}
```

The application validates this before applying it.

## Template system

Templates should be animated story patterns, not static layouts.

### Template structure

```text
Template
  metadata
  required inputs
  optional inputs
  layout rules
  semantic slots
  default steps
  motion choreography
  token bindings
  mode behavior
  AI usage hints
```

Example:

```text
ProblemSolutionTemplate
  slots:
    problem title
    evidence visual
    root cause
    solution visual
    decision ask
  steps:
    reveal problem
    show evidence
    focus root cause
    transform into solution
    end on ask
```

### Template categories

```text
Title reveal
Agenda build-up
Section divider
Executive summary
Problem framing
Problem → insight → solution
Before/after comparison
Timeline
Roadmap
System architecture
Process flow
Data story
Scientific derivation
Quote reveal
Product hero
KPI dashboard
Decision slide
Appendix detail
```

## Scene variants

AI should generate alternative versions of a scene.

User commands:

```text
Give me 5 better versions.
Make one more minimal.
Make one more cinematic.
Make one more technical.
Make one more executive.
Make one more emotional.
```

Each variant remains editable and tokenized.

## Progressive disclosure by audience

A presentation can tag content by audience depth:

```text
executive
manager
engineer
expert
appendix
```

Before presenting:

```text
Audience: executive
Time: 15 minutes
```

The system can propose a shorter path.

For expert audience:

```text
Audience: expert
Time: 45 minutes
```

It includes equations, architecture, validation details, and appendix material.

This turns a deck into a content graph rather than a fixed linear slide sequence.

## Generative image/video models

Use image/video generation carefully.

Good use cases:

```text
abstract background loops
cinematic section openers
product mood visuals
metaphorical illustrations
soft particles
liquid glass texture maps
medical-tech background motion
futuristic UI overlays
b-roll style clips
```

Bad use cases:

```text
core charts
precise diagrams
technical architecture
regulatory claims
scientific evidence
anything that must be editable and exact
```

Rule:

> Generated media is useful as atmosphere or illustration. Core meaning should stay structured and deterministic.

## AI safety and reliability requirements

For serious corporate/technical use:

```text
AI-generated claims should be marked or traceable.
Data-backed charts must preserve source data.
AI should not invent numbers.
AI-generated images/videos should carry provenance metadata.
Brand package rules should constrain AI output.
User must be able to inspect and edit all AI-created objects.
```

## MVP AI scope

Do not start with full AI deck generation.

Start with:

```text
1. AI storyboard from rough notes
2. AI scene outline with template suggestions
3. AI critique of text density and chart takeaway
4. AI rewrite of speaker notes
5. AI chart explanation from provided data
```

Then add structured scene generation after the document model stabilizes.

## Long-term vision

AI becomes the creative co-director:

```text
storyboarder
designer
motion director
chart assistant
brand compliance reviewer
rehearsal coach
Q&A navigator
```

But the foundation remains:

```text
structured scene graph
brand tokens
approved components
deterministic renderer
```
