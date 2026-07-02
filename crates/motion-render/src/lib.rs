//! motion-render — renderer abstraction, render tree, GPU resources, and draw passes.

pub mod material;
pub mod passes;
pub mod render_tree;

pub use render_tree::{RenderNode, RenderTree};
