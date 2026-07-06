//! Preflight validation — checks run before a live presentation.

use serde::{Deserialize, Serialize};

use crate::{
    brand::verify_asset_hash,
    document::{AssetKind, Document},
    node::{Node, NodeKind, StyleValue},
    templates::{catalog as template_catalog, TEMPLATE_SCHEMA_VERSION},
};

/// Overall preflight result status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreflightStatus {
    Ready,
    Warning,
    Error,
}

/// Severity of an individual check result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckSeverity {
    Info,
    Warning,
    Error,
}

/// Category of a preflight check.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckCategory {
    Assets,
    Fonts,
    Renderer,
    Brand,
    Accessibility,
    DataLinks,
    PresenterView,
    Cache,
}

/// Result of a single preflight check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflightCheck {
    pub id: String,
    pub category: CheckCategory,
    pub severity: CheckSeverity,
    pub passed: bool,
    pub message: String,
    pub details: Option<String>,
}

/// A suggested fix for a failed check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixSuggestion {
    pub check_id: String,
    pub description: String,
    pub auto_fixable: bool,
}

/// The full preflight report returned before presenting.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflightReport {
    pub status: PreflightStatus,
    pub checks: Vec<PreflightCheck>,
    pub suggestions: Vec<FixSuggestion>,
}

impl PreflightReport {
    /// Create an empty report defaulting to `Ready`.
    pub fn new() -> Self {
        Self {
            status: PreflightStatus::Ready,
            checks: Vec::new(),
            suggestions: Vec::new(),
        }
    }

    /// Recalculate the overall status from individual check results.
    pub fn recalculate_status(&mut self) {
        let has_error = self
            .checks
            .iter()
            .any(|c| !c.passed && c.severity == CheckSeverity::Error);
        let has_warning = self
            .checks
            .iter()
            .any(|c| !c.passed && c.severity == CheckSeverity::Warning);
        self.status = if has_error {
            PreflightStatus::Error
        } else if has_warning {
            PreflightStatus::Warning
        } else {
            PreflightStatus::Ready
        };
    }
}

impl Default for PreflightReport {
    fn default() -> Self {
        Self::new()
    }
}

pub fn run_document_preflight(document: &Document) -> PreflightReport {
    let mut report = PreflightReport::new();

    report.checks.push(PreflightCheck {
        id: "scenes.non_empty".into(),
        category: CheckCategory::Assets,
        severity: CheckSeverity::Error,
        passed: !document.scenes.is_empty(),
        message: if document.scenes.is_empty() {
            "Presentation has no scenes".into()
        } else {
            format!("{} scene(s) found", document.scenes.len())
        },
        details: None,
    });

    let roots_valid = document
        .scenes
        .iter()
        .all(|scene| document.nodes.contains_key(&scene.root));
    report.checks.push(PreflightCheck {
        id: "scenes.roots_valid".into(),
        category: CheckCategory::Assets,
        severity: CheckSeverity::Error,
        passed: roots_valid,
        message: if roots_valid {
            "All scene roots are valid".into()
        } else {
            "One or more scenes have a missing root node".into()
        },
        details: None,
    });

    let font_assets: Vec<_> = document
        .assets
        .assets
        .iter()
        .filter(|asset| matches!(asset.kind, AssetKind::Font))
        .collect();
    let bundled_fonts = font_assets
        .iter()
        .filter(|asset| asset.uri.starts_with("data:") && verify_asset_hash(asset))
        .count();
    let expects_brand_font = document.brand.is_some()
        || document
            .tokens
            .tokens
            .keys()
            .any(|path| path.starts_with("typography.") || path.starts_with("font."));
    let font_check_passed = if expects_brand_font {
        bundled_fonts > 0
    } else {
        true
    };
    let font_asset_label = if bundled_fonts == 1 {
        "bundled font asset"
    } else {
        "bundled font assets"
    };
    report.checks.push(PreflightCheck {
        id: "fonts.bundled".into(),
        category: CheckCategory::Fonts,
        severity: if expects_brand_font {
            CheckSeverity::Error
        } else {
            CheckSeverity::Warning
        },
        passed: font_check_passed,
        message: if bundled_fonts > 0 {
            format!("{bundled_fonts} {font_asset_label} verified")
        } else if expects_brand_font {
            "Brand typography is configured but no bundled font asset was verified".into()
        } else {
            "No bundled brand fonts configured".into()
        },
        details: None,
    });
    if !font_check_passed {
        report.suggestions.push(FixSuggestion {
            check_id: "fonts.bundled".into(),
            description: "Bundle the brand WOFF2 font in the brand package before presenting."
                .into(),
            auto_fixable: false,
        });
    }

    let bundled_assets: Vec<_> = document
        .assets
        .assets
        .iter()
        .filter(|asset| asset.uri.starts_with("data:"))
        .collect();
    let invalid_assets: Vec<_> = bundled_assets
        .iter()
        .filter(|asset| !verify_asset_hash(asset))
        .collect();
    let asset_label = if bundled_assets.len() == 1 {
        "bundled asset"
    } else {
        "bundled assets"
    };
    report.checks.push(PreflightCheck {
        id: "assets.hashes_valid".into(),
        category: CheckCategory::Assets,
        severity: CheckSeverity::Error,
        passed: invalid_assets.is_empty(),
        message: if bundled_assets.is_empty() {
            "No bundled assets to validate".into()
        } else if invalid_assets.is_empty() {
            format!("Validated {} {} checksum(s)", bundled_assets.len(), asset_label)
        } else {
            format!(
                "{} {} failed checksum validation",
                invalid_assets.len(),
                if invalid_assets.len() == 1 {
                    "bundled asset"
                } else {
                    "bundled assets"
                }
            )
        },
        details: if invalid_assets.is_empty() {
            None
        } else {
            Some(format!(
                "Invalid assets: {}",
                invalid_assets
                    .iter()
                    .map(|asset| asset.name.clone().unwrap_or_else(|| asset.uri.clone()))
                    .take(5)
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        },
    });

    let brand_graphics: Vec<_> = document
        .assets
        .assets
        .iter()
        .filter(|asset| {
            matches!(
                asset.kind,
                AssetKind::Image | AssetKind::Svg | AssetKind::Icon
            )
        })
        .collect();
    let has_brand_graphics = document.brand.is_none() || !brand_graphics.is_empty();
    report.checks.push(PreflightCheck {
        id: "brand.graphics_present".into(),
        category: CheckCategory::Brand,
        severity: CheckSeverity::Warning,
        passed: has_brand_graphics,
        message: if brand_graphics.is_empty() {
            "No bundled logo/icon assets found".into()
        } else {
            format!(
                "{} bundled logo/icon asset(s) available",
                brand_graphics.len()
            )
        },
        details: None,
    });

    // Component payload availability is required only for branded decks.
    let brand_requires_components = document.brand.is_some();
    let expected_components: Vec<String> = if brand_requires_components {
        template_catalog()
            .into_iter()
            .map(|template| template.contract.id)
            .collect()
    } else {
        Vec::new()
    };

    let missing_components: Vec<String> = expected_components
        .into_iter()
        .filter(|component_id| !document.components.components.contains_key(component_id))
        .collect();
    report.checks.push(PreflightCheck {
        id: "components.available".into(),
        category: CheckCategory::Brand,
        severity: CheckSeverity::Warning,
        passed: missing_components.is_empty(),
        message: if missing_components.is_empty() {
            format!(
                "{} template component payload(s) available",
                document.components.components.len()
            )
        } else {
            format!(
                "Missing template component payloads: {}",
                missing_components.join(", ")
            )
        },
        details: None,
    });

    let schema_matches = document
        .components
        .schema_version
        .as_deref()
        .map(|version| version == TEMPLATE_SCHEMA_VERSION)
        .unwrap_or(true);
    report.checks.push(PreflightCheck {
        id: "components.schema_compatible".into(),
        category: CheckCategory::Brand,
        severity: CheckSeverity::Error,
        passed: schema_matches,
        message: if schema_matches {
            format!("Template schema version {TEMPLATE_SCHEMA_VERSION} is compatible")
        } else {
            format!(
                "Template schema mismatch (document={}, engine={})",
                document
                    .components
                    .schema_version
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
                TEMPLATE_SCHEMA_VERSION
            )
        },
        details: None,
    });

    let raw_color_nodes: Vec<_> = document
        .nodes
        .values()
        .filter(|node| uses_raw_color(node))
        .map(|node| node.name.clone())
        .collect();
    let raw_color_details = if raw_color_nodes.is_empty() {
        None
    } else {
        Some(format!(
            "Examples: {}",
            raw_color_nodes
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ))
    };
    report.checks.push(PreflightCheck {
        id: "brand.raw_color_overrides".into(),
        category: CheckCategory::Brand,
        severity: CheckSeverity::Warning,
        passed: raw_color_nodes.is_empty(),
        message: if raw_color_nodes.is_empty() {
            "No raw color overrides detected".into()
        } else {
            format!(
                "{} node(s) use raw color literals instead of brand tokens",
                raw_color_nodes.len()
            )
        },
        details: raw_color_details,
    });
    if !raw_color_nodes.is_empty() {
        report.suggestions.push(FixSuggestion {
            check_id: "brand.raw_color_overrides".into(),
            description: "Replace raw color literals with approved design tokens.".into(),
            auto_fixable: false,
        });
    }

    report.recalculate_status();
    report
}

fn uses_raw_color(node: &Node) -> bool {
    is_literal_color(node.style.fill.as_ref())
        || is_literal_color(node.style.stroke.as_ref())
        || matches!(&node.data, NodeKind::Text(text) if matches!(text.color, StyleValue::Literal(_)))
}

fn is_literal_color(value: Option<&StyleValue<crate::node::Color>>) -> bool {
    matches!(value, Some(StyleValue::Literal(_)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        document::{Asset, AssetId, AssetStore},
        node::{Color, FrameNode, Node, NodeKind, ShapeKind, ShapeNode, TextNode},
        scene::Scene,
        tokens::{TokenStore, TokenValue},
    };

    fn sample_document() -> Document {
        let mut document = Document::new("Demo");
        document.tokens = TokenStore::default();
        document.tokens.tokens.insert(
            "font.brand".into(),
            TokenValue::Scalar(serde_json::json!("Inter")),
        );
        document.tokens.tokens.insert(
            "typography.body.font".into(),
            TokenValue::Scalar(serde_json::json!("Inter")),
        );

        let root = Node::new(
            "Root",
            NodeKind::Frame(FrameNode {
                clip_content: false,
                corner_radius: None,
            }),
        );
        let root_id = root.id;
        document.insert_node(root);

        let mut text = Node::new("Title", NodeKind::Text(TextNode::default()));
        text.parent = Some(root_id);
        let text_id = text.id;
        document.insert_node(text);

        let mut shape = Node::new(
            "Accent",
            NodeKind::Shape(ShapeNode {
                kind: ShapeKind::Rectangle,
            }),
        );
        shape.parent = Some(root_id);
        shape.style.fill = Some(StyleValue::Literal(Color::WHITE));
        let shape_id = shape.id;
        document.insert_node(shape);

        document.node_mut(root_id).unwrap().children = vec![text_id, shape_id];
        document.scenes.push(Scene::new("Scene 1", root_id));
        document
    }

    #[test]
    fn warns_about_raw_colors_and_missing_font_bundle() {
        let report = run_document_preflight(&sample_document());
        assert_eq!(report.status, PreflightStatus::Error);
        assert!(report
            .checks
            .iter()
            .any(|check| check.id == "brand.raw_color_overrides" && !check.passed));
        assert!(report
            .checks
            .iter()
            .any(|check| check.id == "fonts.bundled" && !check.passed));
    }

    #[test]
    fn validates_bundled_font_hashes() {
        let mut document = sample_document();
        document.brand = Some(crate::document::BrandBinding {
            name: "Example".into(),
            version: "0.1.0".into(),
        });
        document.assets = AssetStore {
            assets: vec![Asset {
                id: AssetId::new(),
                kind: AssetKind::Font,
                uri: "data:font/woff2;base64,ZmFrZS1mb250".into(),
                hash: "9c47bfdc428fd054eb19c751dbedf3d47d5d04f4892ae8addec08ac9595f2101".into(),
                name: Some("Inter".into()),
            }],
        };
        document.nodes.clear();
        document.scenes.clear();

        let report = run_document_preflight(&document);
        let font_check = report
            .checks
            .iter()
            .find(|check| check.id == "fonts.bundled")
            .unwrap();
        assert!(font_check.passed);
        let asset_check = report
            .checks
            .iter()
            .find(|check| check.id == "assets.hashes_valid")
            .unwrap();
        assert!(asset_check.passed);
    }

    #[test]
    fn flags_component_schema_mismatch() {
        let mut document = sample_document();
        document.components.schema_version = Some("0.0.1".into());
        let report = run_document_preflight(&document);
        let schema_check = report
            .checks
            .iter()
            .find(|check| check.id == "components.schema_compatible")
            .unwrap();
        assert!(!schema_check.passed);
    }
}
