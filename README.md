# Motion

> I design like Figma. I present like PowerPoint. It moves like After Effects. It explains like Manim. It scales like a design system.

A browser-native motion-graphic presentation system where companies define their visual and motion language, users build semantic animated scenes, and AI acts as storyboarder, designer, motion director, chart assistant, and rehearsal coach — while presenting remains as easy as sharing a browser window in Teams or Zoom.

## Repository structure

```
motion/
├── crates/
│   ├── motion-core/      # document model, scene graph, tokens, commands, layout, animation
│   ├── motion-render/    # renderer abstraction, render tree, materials, draw passes
│   ├── motion-wasm/      # wasm-bindgen bindings and browser API boundary
│   └── motion-cli/       # CLI tool: validate, export, build-brand
├── apps/
│   └── motion-ui/        # TypeScript editor/presenter web app (Vite)
├── templates/
│   ├── brands/           # versioned brand packages (tokens, fonts, components)
│   └── components/       # reusable animated scene components
└── docs/                 # product vision, architecture, and roadmap
```

## Architecture

```
Web Product Layer (motion-ui)
         │
         ▼
Rust/WASM Core (motion-core + motion-wasm)
         │
         ▼
Renderer (motion-render → WebGPU / WebGL2 / Canvas)
         │
         ▼
Browser Runtime (editor mode, present mode, presenter view)
```

See [docs/03_architecture_plan.md](docs/03_architecture_plan.md) for the full architecture plan.

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (stable, with `wasm32-unknown-unknown` target)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- [Node.js](https://nodejs.org/) ≥ 20

### Build the Rust workspace

```sh
cargo build
```

### Build the WASM package

```sh
wasm-pack build crates/motion-wasm --target web
```

### Run the UI dev server

```sh
cd apps/motion-ui
npm install
npm run dev
```

### CLI

```sh
cargo run -p motion-cli -- --help
```

## Documentation

The full product and architecture documentation lives in [`docs/`](docs/README.md).
