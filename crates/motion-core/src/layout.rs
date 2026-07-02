//! Layout evaluation — flex/grid layout and constraint resolution.

use serde::{Deserialize, Serialize};

use crate::node::NodeId;

/// A computed bounding box after layout resolution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// Result of evaluating the layout tree for a set of nodes.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LayoutResult {
    pub boxes: Vec<(NodeId, LayoutBox)>,
}

/// Placeholder for the layout engine.  
/// A full implementation will evaluate flex/grid rules and constraints.
pub struct LayoutEngine;

impl LayoutEngine {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LayoutEngine {
    fn default() -> Self {
        Self::new()
    }
}
