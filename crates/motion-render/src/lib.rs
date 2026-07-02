//! motion-render — renderer abstraction, render tree, GPU resources, and draw passes.

pub mod builder;
pub mod material;
pub mod passes;
pub mod render_tree;

pub use builder::RenderTreeBuilder;
pub use passes::{assign_draw_pass, DrawPass, RenderTier};
pub use render_tree::{AnimationFrame, RenderNode, RenderTree};
