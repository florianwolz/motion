# 04 — Brand Tokens and Packaging

## Core idea

The product should not treat a presentation template as a static file. It should treat brand identity as a live, versioned, tokenized package.

PowerPoint templates copy style into slides. This framework should keep style alive as tokens.

A title should not store:

```text
font = Brand Sans
size = 44
color = #000000
```

It should store:

```text
font = typography.title.font
size = typography.title.size
color = color.text.primary
motion = motion.titleReveal
```

The brand package decides what those mean.

## Why this matters

Corporate presentation workflows are often fragile:

```text
brand font not installed
wrong logo copied from old deck
old PowerPoint template still in circulation
random chart colors
manual font sizes
broken master slides
linked media missing
ugly inherited formatting
```

A tokenized brand package solves this structurally.

## Brand package concept

A brand package is a portable design-system bundle for presentations.

Possible extension names:

```text
.brandpack
.motionbrand
.presentation-brand
```

Package contents:

```text
tokens.json
fonts/
logos/
icons/
materials/
components/
motion-presets/
chart-themes/
ai-rules/
licenses/
manifest.json
```

A deck can depend on:

```text
shs-corporate-brandkit@3.2.1
```

Instead of copying style manually.

## Example package manifest

```json
{
  "name": "Corporate Medical Technology Brand",
  "version": "3.2.1",
  "engineCompatibility": ">=0.8.0",
  "modes": ["light", "dark", "teams", "projector", "pdf", "executive", "technical"],
  "fonts": [
    {
      "family": "Brand Sans",
      "file": "fonts/brand-sans.woff2",
      "usage": "internal",
      "subsetAllowed": true,
      "license": "licenses/brand-sans-license.json"
    }
  ],
  "components": [
    "ExecutiveSummary",
    "SectionIntro",
    "AnimatedLogoReveal",
    "KpiDashboard",
    "BeforeAfterMedicalImage"
  ]
}
```

## Token hierarchy

Use multiple levels of abstraction.

```text
Primitive tokens
  raw values
  color.orange.500
  space.4
  duration.md

Semantic tokens
  role-based values
  color.text.primary
  color.accent.emphasis
  chart.series.primary

Component tokens
  component-specific values
  titleSlide.title.color
  chart.axis.label
  glassCard.background

Scene-pattern tokens
  storytelling-level values
  scene.executiveSummary.layout
  scene.problemSolution.motion
  scene.technicalDeepDive.density
```

## Primitive tokens

Raw values:

```json
{
  "color.brand.orange.500": "#EC6602",
  "color.brand.cyan.500": "#00BEDC",
  "color.neutral.0": "#FFFFFF",
  "color.neutral.950": "#050505",
  "space.4": "16px",
  "space.8": "32px",
  "radius.lg": "24px",
  "duration.md": "420ms",
  "font.brand": "Brand Sans"
}
```

Primitive tokens should exist, but normal users should mostly work with semantic tokens.

## Semantic tokens

Semantic values describe intent.

```json
{
  "color.text.primary": "{color.neutral.950}",
  "color.text.secondary": "{color.neutral.650}",
  "color.surface.default": "{color.neutral.0}",
  "color.surface.inverted": "{color.neutral.950}",
  "color.accent.emphasis": "{color.brand.orange.500}",
  "color.accent.information": "{color.brand.cyan.500}",
  "chart.series.primary": "{color.brand.cyan.500}",
  "chart.series.warning": "{color.brand.orange.500}"
}
```

A scene should use:

```text
color.text.primary
```

not:

```text
#000000
```

## Motion tokens

Motion is part of the brand.

Example:

```json
{
  "motion.duration.fast": "180ms",
  "motion.duration.normal": "420ms",
  "motion.duration.slow": "850ms",

  "motion.ease.precise": "cubic-bezier(0.2, 0.0, 0.0, 1.0)",
  "motion.ease.premium": "cubic-bezier(0.16, 1.0, 0.3, 1.0)",

  "motion.spring.soft.mass": 1.0,
  "motion.spring.soft.stiffness": 180,
  "motion.spring.soft.damping": 24,

  "motion.stagger.default": "45ms",
  "motion.overshoot.allowed": false
}
```

Different brand personalities:

```text
Medical technology
  precise
  calm
  smooth
  minimal overshoot
  no cartoon bounce

YouTube explainer
  faster
  more elastic
  stronger anticipation
  more kinetic text

Executive board
  restrained
  slower
  high clarity
  low visual noise
```

## Material tokens

Materials define modern surface appearance.

```json
{
  "material.glass.subtle": {
    "background": "{color.surface.glass}",
    "opacity": 0.18,
    "blur": 24,
    "saturation": 1.2,
    "border": "{color.border.glass}",
    "highlight": "{color.highlight.edge}"
  },
  "material.card.default": {
    "background": "{color.surface.default}",
    "radius": "{radius.lg}",
    "shadow": "{shadow.card}"
  }
}
```

A user should set:

```text
material = material.glass.subtle
```

not manually tune blur, opacity, and border color each time.

## Chart tokens

Charts need strong token support because corporate chart formatting is often inconsistent.

```json
{
  "chart.axis.color": "{color.text.secondary}",
  "chart.gridline.color": "{color.border.subtle}",
  "chart.gridline.opacity": 0.35,
  "chart.label.font": "{typography.caption}",
  "chart.series.1": "{color.data.cyan}",
  "chart.series.2": "{color.data.orange}",
  "chart.negative": "{color.semantic.negative}",
  "chart.positive": "{color.semantic.positive}",
  "chart.highlight": "{color.accent.emphasis}",
  "chart.motion.enter": "{motion.chart.baselineGrow}",
  "chart.motion.highlight": "{motion.focus.soft}",
  "chart.motion.sort": "{motion.layout.rearrange}"
}
```

Chart behavior can be brand-governed:

```text
bars grow from baseline
labels fade after bars
highlighted series gets accent color
non-highlighted series dims
sorts preserve bar identity
```

## Layout tokens

Layout tokens make corporate presentation rules explicit.

```json
{
  "layout.margin.slide": "64px",
  "layout.grid.columns": 12,
  "layout.grid.gutter": "24px",
  "layout.title.y": "72px",
  "layout.footer.visible": true,
  "layout.safeArea.top": "48px",
  "layout.density.executive": "spacious",
  "layout.density.technical": "compact"
}
```

Mode examples:

```text
executive mode
  large margins
  low density
  fewer words

technical mode
  denser layout
  more labels
  more diagrams

Teams mode
  thicker lines
  larger text
  stronger contrast
```

## Camera tokens

Camera behavior should also be part of the brand.

```json
{
  "camera.zoom.sectionIntro": 1.12,
  "camera.pan.maxDistance": "120px",
  "camera.motion.default": "{motion.ease.premium}",
  "camera.depthOfField.enabled": false,
  "camera.parallax.strength": 0.08
}
```

For corporate technical presentation, likely defaults:

```text
gentle camera
precise focus
minimal spinning
no aggressive zooms
clean transitions
```

## AI tokens and constraints

The brand package should constrain AI generation.

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

This makes AI output brand-compliant and predictable.

## Modes

Modes are a superpower.

Possible mode axes:

```text
Theme
  light
  dark
  high contrast

Medium
  live presentation
  Teams screen share
  projector
  PDF export
  video export

Audience
  executive
  technical
  scientific
  sales

Density
  spacious
  normal
  dense

Brand context
  corporate
  product line
  conference
  internal workshop
```

Example mode combination:

```text
light + Teams + executive
```

Effects:

```text
larger text
higher contrast
calmer motion
thicker chart lines
less transparency
```

## Bundled fonts

Bundled fonts are essential.

The deck should not ask:

```text
Does this presenting computer have our brand font installed?
```

It should say:

```text
This deck contains the approved brand font subset needed for rendering.
```

Implementation features:

```text
WOFF2 font bundles
font subsetting per deck
font fallback chains
font checksum validation
font licensing metadata
offline cache
```

Important distinction:

```text
Brand package contains official font family.
Deck export may contain only required glyph subset.
```

Benefits:

```text
consistent rendering
smaller exported decks
faster loading
fewer missing font issues
less licensing risk if managed correctly
```

## Asset packaging

Presentations should bundle or reference assets through a manifest.

```text
Presentation
├── document.scenegraph
├── brandkit
│   ├── design tokens
│   ├── fonts
│   ├── logos
│   ├── materials
│   ├── chart styles
│   ├── motion presets
│   └── AI rules
├── assets
│   ├── images
│   ├── videos
│   ├── icons
│   ├── scientific data
│   └── generated backgrounds
├── components
│   ├── animated title reveal
│   ├── section divider
│   ├── executive summary
│   ├── KPI chart
│   └── product hero
└── runtime manifest
    ├── required engine version
    ├── required renderer features
    ├── fallback modes
    └── asset checksums
```

## Animated brand components

A brand package should include animated components, not only logos and colors.

Examples:

```text
AnimatedLogoReveal
SectionTransition
DataPointPulse
LiquidGlassCard
ProductHeroSweep
TimelineBuild
ArchitectureReveal
MedicalImageBeforeAfter
KPIHighlight
CalloutMarker
```

These should be:

```text
parameterized
token-aware
mode-aware
editable
resolution-independent
approved by brand team
```

A normal user inserts an official component instead of manually animating random shapes.

## Versioning

Brand packages should be versioned.

Example:

```text
This deck uses CorporateBrand@3.2.1
Update available: 3.3.0
```

The app can show:

```text
Changes:
- accent orange changed
- title font size increased
- chart gridlines reduced
- logo safe area updated
- section transition changed
```

Actions:

```text
Preview update
Apply update
Keep old version
Apply except chart colors
```

This is far better than sending around new PowerPoint templates and hoping people use them.

## Token linting

A brand compliance checker should report issues:

```text
22 issues found:

- 5 objects use raw colors instead of tokens
- 3 charts use non-approved series colors
- 2 scenes exceed text density rule
- 4 animations are too fast for executive mode
- 1 logo violates safe area
- 7 font sizes are not on the typography scale
```

Possible action:

```text
Fix automatically
```

## Preflight checks

Before presenting:

```text
brand font loaded
font subset complete
logo assets available
all videos cached
WebGPU available or fallback selected
offline cache ready
presenter view connected
no raw unapproved colors
no missing media
no broken data links
contrast sufficient
text size acceptable for selected mode
```

## Product idea: Brand Studio

Create a dedicated area:

```text
Brand Studio
  Colors
  Typography
  Motion
  Materials
  Charts
  Layout
  Components
  AI Rules
  Accessibility
  Export Modes
```

Brand/design teams define the official visual and motion system there. Normal users consume approved templates and components.

## Core statement

> The renderer makes it beautiful.  
> The browser makes it frictionless.  
> The brand package makes it scalable.  
> The token system makes it maintainable.  
> Bundled fonts and assets make it reliable.
