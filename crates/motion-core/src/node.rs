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
    Waterfall,
    Histogram,
    Heatmap,
    Timeline,
    Combo,
    StackedBar,
    StackedArea,
    Lollipop,
    Pareto,
    Funnel,
    Bullet,
    Waffle,
    Table,
    Matrix,
    KpiCard,
    Gantt,
    Sparkline,
    Sankey,
    Treemap,
    Sunburst,
    Chord,
    Alluvial,
    Network,
    RadialTree,
    Dendrogram,
    Box,
    Violin,
    Ridgeline,
    Density,
    ParallelCoordinates,
    Hexbin,
    Contour,
    ErrorBar,
    Candlestick,
    Ohlc,
    WindRose,
    Ternary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChartValueType {
    Number,
    String,
    Boolean,
    DateTime,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartColumn {
    pub key: String,
    pub label: Option<String>,
    pub data_type: ChartValueType,
    pub role: Option<String>,
    pub format: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChartRow {
    pub values: Vec<serde_json::Value>,
    pub datum_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChartTable {
    pub columns: Vec<ChartColumn>,
    pub rows: Vec<ChartRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChartDataSource {
    Inline {
        table: ChartTable,
    },
    Asset {
        asset_id: crate::document::AssetId,
        format: Option<String>,
    },
}

impl Default for ChartDataSource {
    fn default() -> Self {
        Self::Inline {
            table: ChartTable::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChartSortDirection {
    Ascending,
    Descending,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChartFilterOperator {
    Eq,
    NotEq,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    In,
    Between,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartFilter {
    pub column: String,
    pub operator: ChartFilterOperator,
    pub value: serde_json::Value,
    pub secondary_value: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChartTransform {
    Sort {
        column: String,
        direction: ChartSortDirection,
        preserve_identity: bool,
    },
    Filter {
        filter: ChartFilter,
    },
    Limit {
        count: usize,
    },
    Group {
        by: Vec<String>,
        aggregate: String,
    },
    Pivot {
        column: String,
        value_column: String,
    },
    Calculate {
        target: String,
        expression: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartSeriesSpec {
    pub id: String,
    pub label: Option<String>,
    pub x_field: Option<String>,
    pub y_field: Option<String>,
    pub color_token: Option<TokenRef>,
    pub stack_group: Option<String>,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChartMark {
    Bar,
    Line,
    Area,
    Point,
    Rect,
    Segment,
    Label,
    Glyph,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartAxis {
    pub id: String,
    pub field: Option<String>,
    pub title: Option<String>,
    #[serde(default = "default_true")]
    pub show_grid: bool,
    #[serde(default = "default_true")]
    pub show_ticks: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChartLegendPosition {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartLegend {
    #[serde(default = "default_true")]
    pub show: bool,
    pub position: ChartLegendPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartTooltip {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub shared: bool,
    #[serde(default = "default_true")]
    pub include_tokens: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartAnnotation {
    pub id: String,
    pub text: String,
    pub target_series: Option<String>,
    pub target_datum: Option<String>,
    pub x: Option<f32>,
    pub y: Option<f32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChartGrammar {
    pub axes: Vec<ChartAxis>,
    pub marks: Vec<ChartMark>,
    pub legend: Option<ChartLegend>,
    pub tooltip: Option<ChartTooltip>,
    pub annotations: Vec<ChartAnnotation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartInteractionPolicy {
    #[serde(default = "default_true")]
    pub hover: bool,
    #[serde(default = "default_true")]
    pub focus: bool,
    #[serde(default = "default_true")]
    pub select: bool,
    #[serde(default = "default_true")]
    pub zoom_pan: bool,
    #[serde(default = "default_true")]
    pub filter: bool,
    #[serde(default = "default_true")]
    pub sort: bool,
    #[serde(default = "default_true")]
    pub drill: bool,
    #[serde(default = "default_true")]
    pub crosshair: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartAnimationPolicy {
    pub enter_preset: Option<TokenRef>,
    pub update_preset: Option<TokenRef>,
    pub exit_preset: Option<TokenRef>,
    #[serde(default = "default_true")]
    pub preserve_identity: bool,
    pub duration_ms: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartQualityGates {
    #[serde(default = "default_true")]
    pub deterministic: bool,
    #[serde(default = "default_true")]
    pub contrast_checked: bool,
    #[serde(default = "default_true")]
    pub colorblind_safe: bool,
    #[serde(default = "default_true")]
    pub keyboard_navigation: bool,
    #[serde(default = "default_true")]
    pub export_fidelity: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartParityTargets {
    #[serde(default = "default_true")]
    pub d3_transition_expressiveness: bool,
    #[serde(default = "default_true")]
    pub plotly_interactions: bool,
    #[serde(default = "default_true")]
    pub seaborn_statistical_defaults: bool,
}

impl Default for ChartValueType {
    fn default() -> Self {
        Self::Json
    }
}

impl Default for ChartSeriesSpec {
    fn default() -> Self {
        Self {
            id: "series-1".to_string(),
            label: None,
            x_field: None,
            y_field: None,
            color_token: None,
            stack_group: None,
            visible: true,
        }
    }
}

impl Default for ChartLegendPosition {
    fn default() -> Self {
        Self::Right
    }
}

impl Default for ChartLegend {
    fn default() -> Self {
        Self {
            show: true,
            position: ChartLegendPosition::Right,
        }
    }
}

impl Default for ChartTooltip {
    fn default() -> Self {
        Self {
            enabled: true,
            shared: true,
            include_tokens: true,
        }
    }
}

impl Default for ChartInteractionPolicy {
    fn default() -> Self {
        Self {
            hover: true,
            focus: true,
            select: true,
            zoom_pan: true,
            filter: true,
            sort: true,
            drill: true,
            crosshair: true,
        }
    }
}

impl Default for ChartAnimationPolicy {
    fn default() -> Self {
        Self {
            enter_preset: Some(TokenRef {
                path: "motion.chart.enter".to_string(),
            }),
            update_preset: Some(TokenRef {
                path: "motion.chart.update".to_string(),
            }),
            exit_preset: Some(TokenRef {
                path: "motion.chart.exit".to_string(),
            }),
            preserve_identity: true,
            duration_ms: None,
        }
    }
}

impl Default for ChartQualityGates {
    fn default() -> Self {
        Self {
            deterministic: true,
            contrast_checked: true,
            colorblind_safe: true,
            keyboard_navigation: true,
            export_fidelity: true,
        }
    }
}

impl Default for ChartParityTargets {
    fn default() -> Self {
        Self {
            d3_transition_expressiveness: true,
            plotly_interactions: true,
            seaborn_statistical_defaults: true,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartNode {
    pub kind: ChartKind,
    pub data_source: ChartDataSource,
    pub series: Vec<ChartSeriesSpec>,
    pub transforms: Vec<ChartTransform>,
    pub grammar: ChartGrammar,
    pub interactions: ChartInteractionPolicy,
    pub animations: ChartAnimationPolicy,
    pub quality_gates: ChartQualityGates,
    pub parity_targets: ChartParityTargets,
    pub title: Option<StyleValue<String>>,
    pub subtitle: Option<StyleValue<String>>,
}

impl Default for ChartNode {
    fn default() -> Self {
        Self {
            kind: ChartKind::Bar,
            data_source: ChartDataSource::default(),
            series: Vec::new(),
            transforms: Vec::new(),
            grammar: ChartGrammar::default(),
            interactions: ChartInteractionPolicy::default(),
            animations: ChartAnimationPolicy::default(),
            quality_gates: ChartQualityGates::default(),
            parity_targets: ChartParityTargets::default(),
            title: None,
            subtitle: None,
        }
    }
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
