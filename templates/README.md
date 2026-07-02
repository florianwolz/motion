# Templates

This directory contains brand packages and reusable animated components.

## Structure

```
templates/
├── brands/
│   └── <brand-name>/
│       ├── manifest.json       # brand package manifest
│       ├── tokens.json         # design, motion, chart, layout tokens
│       ├── fonts/              # WOFF2 font bundles
│       ├── logos/              # logo assets
│       ├── icons/              # icon set
│       └── licenses/           # font and asset license metadata
└── components/
    └── <component-name>/
        ├── component.json      # component definition
        └── preview.png         # optional preview thumbnail
```

## Brand packages

A brand package is a portable, versioned design-system bundle that a
presentation references at runtime.  It provides fonts, colors, motion curves,
chart styles, and animated components, ensuring consistent rendering on any
machine without manually installed fonts.

See `brands/example-brand/` for a development/testing example.

## Components

Reusable animated scene components that are tokenized, mode-aware, and
parameterized.  They can be referenced from any deck that depends on a
compatible brand package.

Initial target components for the MVP:

- `TitleReveal`
- `SectionIntro`
- `ExecutiveSummary`
- `BeforeAfter`
- `KpiHighlight`
- `AnnotatedChart`
- `SimpleArchitectureDiagram`
