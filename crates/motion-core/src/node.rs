//! Scene graph node types.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::tokens::TokenRef;

/// Unique identifier for a node in the scene graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub Uuid);

impl NodeId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for NodeId {
    fn default() -> Self {
        Self::new()
    }
}

/// A style value that may be a raw literal or a token reference.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StyleValue<T> {
    Literal(T),
    Token(TokenRef),
}

impl<T: Clone> StyleValue<T> {
    pub fn literal(val: T) -> Self {
        Self::Literal(val)
    }

    pub fn token(path: impl Into<String>) -> Self {
        Self::Token(TokenRef { path: path.into() })
    }
}

/// A 2D affine transform.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transform {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub rotation: f32,
    pub scale_x: f32,
    pub scale_y: f32,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        }
    }
}

/// RGBA color in the range 0.0–1.0.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Color {
    pub const WHITE: Self = Self { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
    pub const BLACK: Self = Self { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    pub const TRANSPARENT: Self = Self { r: 0.0, g: 0.0, b: 0.0, a: 0.0 };
}

impl Default for Color {
    fn default() -> Self {
        Self::BLACK
    }
}

/// Visual styling shared across node types.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NodeStyle {
    pub opacity: StyleValue<f32>,
    pub fill: Option<StyleValue<Color>>,
    pub stroke: Option<StyleValue<Color>>,
    pub stroke_width: Option<StyleValue<f32>>,
    pub blur_radius: Option<StyleValue<f32>>,
    pub material: Option<StyleValue<String>>,
}

impl Default for StyleValue<f32> {
    fn default() -> Self {
        Self::Literal(1.0)
    }
}

/// Auto-layout properties for a node.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LayoutProperties {
    pub layout_mode: LayoutMode,
    pub padding: Option<f32>,
    pub gap: Option<StyleValue<f32>>,
    pub align_items: Option<String>,
    pub justify_content: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayoutMode {
    #[default]
    None,
    Flex,
    Grid,
}

/// Animation properties for a node.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AnimationProperties {
    /// Default enter preset (token ref or preset name).
    pub enter_preset: Option<StyleValue<String>>,
    /// Default exit preset.
    pub exit_preset: Option<StyleValue<String>>,
    /// Stagger delay relative to siblings.
    pub stagger_delay: Option<StyleValue<f32>>,
}

/// Semantic metadata for a node.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SemanticProperties {
    /// Semantic role, e.g. "title", "chart", "callout".
    pub role: Option<String>,
    /// Human-readable label for accessibility and AI guidance.
    pub label: Option<String>,
}

// --- Concrete node types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameNode {
    pub clip_content: bool,
    pub corner_radius: Option<StyleValue<f32>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GroupNode {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextNode {
    pub content: String,
    pub color: StyleValue<Color>,
    pub font_family: StyleValue<String>,
    pub font_size: StyleValue<f32>,
    pub line_height: Option<StyleValue<f32>>,
    pub font_weight: Option<u32>,
}

impl Default for TextNode {
    fn default() -> Self {
        Self {
            content: String::new(),
            color: StyleValue::Token(TokenRef { path: "color.text.primary".to_string() }),
            font_family: StyleValue::Token(TokenRef { path: "typography.body.font".to_string() }),
            font_size: StyleValue::Token(TokenRef { path: "typography.body.size".to_string() }),
            line_height: None,
            font_weight: None,
        }
    }
}

/// Basic shape kinds.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShapeKind {
    Rectangle,
    Ellipse,
    RoundedRectangle { corner_radius: f32 },
    Line,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeNode {
    pub kind: ShapeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageNode {
    pub asset_id: crate::document::AssetId,
    pub fit: ImageFit,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImageFit {
    #[default]
    Contain,
    Cover,
    Fill,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoNode {
    pub asset_id: crate::document::AssetId,
    pub autoplay: bool,
    pub loop_: bool,
    pub muted: bool,
}

/// Chart type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChartKind {
    Bar,
    Line,
    Area,
    Scatter,
    Histogram,
    Waterfall,
    Heatmap,
    Timeline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartNode {
    pub kind: ChartKind,
    /// Reference to a data asset or inline JSON data.
    pub data: serde_json::Value,
    pub title: Option<StyleValue<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EquationNode {
    pub latex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagramNode {
    pub diagram_type: String,
    pub definition: serde_json::Value,
}

/// An instance of a reusable component from the component library.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentInstanceNode {
    pub component_id: String,
    pub properties: serde_json::Value,
}

/// Discriminated union of all concrete node types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NodeKind {
    Frame(FrameNode),
    Group(GroupNode),
    Text(TextNode),
    Shape(ShapeNode),
    Image(ImageNode),
    Video(VideoNode),
    Chart(ChartNode),
    Equation(EquationNode),
    Diagram(DiagramNode),
    ComponentInstance(ComponentInstanceNode),
}

/// A node in the scene graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub name: String,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub transform: Transform,
    pub style: NodeStyle,
    pub layout: LayoutProperties,
    pub animation: AnimationProperties,
    pub semantic: SemanticProperties,
    pub visible: bool,
    pub locked: bool,
    pub data: NodeKind,
}

impl Node {
    pub fn new(name: impl Into<String>, data: NodeKind) -> Self {
        Self {
            id: NodeId::new(),
            name: name.into(),
            parent: None,
            children: Vec::new(),
            transform: Transform::default(),
            style: NodeStyle::default(),
            layout: LayoutProperties::default(),
            animation: AnimationProperties::default(),
            semantic: SemanticProperties::default(),
            visible: true,
            locked: false,
            data,
        }
    }
}
