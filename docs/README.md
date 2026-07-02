# Motion-Graphic Presentation Framework — Documentation Pack

This documentation pack captures the product and architecture vision for a Rust/browser-based motion-graphic presentation framework.

The core idea is to build a browser-native presentation product that is:

- **as easy to present as PowerPoint**, especially in Teams/Zoom;
- **as visually polished as professional motion-graphic explainers**;
- **as programmable and semantic as Manim**, but usable through a Figma-like interface;
- **as scalable as a design system**, with tokens, brand packages, reusable animated components, and bundled assets;
- **AI-assisted**, but with AI operating on editable scene objects instead of generating unstructured pixels.

## Product thesis

A presentation should not be a static stack of slides. It should be a live, tokenized, semantic, animated scene graph that can be authored visually, presented directly in the browser, exported safely, and governed by a reusable brand system.

PowerPoint templates copy style into decks. This framework keeps style alive through tokens and brand packages.

## Files in this pack

1. [01_product_vision.md](01_product_vision.md)  
   Strategic product vision, differentiation, and guiding principles.

2. [02_functional_specification.md](02_functional_specification.md)  
   User-facing feature set, authoring workflow, presentation workflow, templates, charts, storytelling components, export, and collaboration direction.

3. [03_architecture_plan.md](03_architecture_plan.md)  
   Rust/WASM/browser/WebGPU architecture, document model, runtime, command system, package split, and rendering pipeline.

4. [04_brand_tokens_and_packaging.md](04_brand_tokens_and_packaging.md)  
   Design tokens, motion tokens, chart tokens, material tokens, modes, bundled fonts, brand packages, and preflight checks.

5. [05_ai_and_templates_plan.md](05_ai_and_templates_plan.md)  
   AI as storyboarder, designer, motion director, critic, chart assistant, and template composer.

6. [06_mvp_roadmap.md](06_mvp_roadmap.md)  
   Concrete MVP scope, milestones, risks, validation demos, and post-MVP expansion.

7. [07_open_questions.md](07_open_questions.md)  
   Important unresolved design and engineering questions to settle before implementation.

## One-sentence positioning

> A browser-native motion-graphics presentation system where companies define their visual and motion language, users build semantic animated scenes, and AI acts as storyboarder, designer, motion director, chart assistant, and rehearsal coach — while presenting remains as easy as sharing a browser window in Teams or Zoom.

## Minimal viable demo target

The first convincing demo should show a 5-minute technical/executive presentation that:

- is authored in a browser canvas;
- uses a Rust/WASM renderer;
- has text, shapes, images, and at least one beautiful animated chart;
- has semantic steps instead of only static slides;
- includes a brand kit with bundled font, colors, chart styles, and motion presets;
- can be presented full-screen from a browser window;
- runs a preflight check before presentation;
- exports at least a static PDF fallback.

## Non-goals for the first version

The first version should **not** try to be all of Figma, After Effects, PowerPoint, Manim, and a full video editor at once.

The spine must remain:

> Live animated presentations, easy to present, with professional motion-graphic quality.
