use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::OnceLock;

use crate::{
    command::ApplyTemplateCommand,
    document::Document,
    node::{
        ChartColumn, ChartDataSource, ChartKind, ChartNode, ChartRow, ChartValueType,
        ComponentInstanceNode, DiagramNode, Node, NodeId, NodeKind, ShapeKind, ShapeNode,
        StyleValue, TextNode,
    },
    scene::{PresentationCommand, SceneId, Step},
    tokens::TokenRef,
};

/// Version of the checked-in template contract shape.
///
/// Increment when contract-required fields or semantics change in a way that
/// requires producer/consumer coordination.
pub const TEMPLATE_SCHEMA_VERSION: &str = "1.0.0";
/// Engine compatibility range for the checked-in template contracts.
///
/// This follows semver-style range intent and is emitted with each definition
/// so loaders can reject incompatible template payloads.
pub const TEMPLATE_ENGINE_COMPATIBILITY: &str = ">=0.1.0";
const TEMPLATE_INSTANCE_BASE_X: f32 = 88.0;
const TEMPLATE_INSTANCE_BASE_Y: f32 = 120.0;
const TEMPLATE_INSTANCE_OFFSET_X: f32 = 32.0;
const TEMPLATE_INSTANCE_OFFSET_Y: f32 = 20.0;
const TEMPLATE_INSTANCE_MAX_OFFSET_X: f32 = 320.0;
const TEMPLATE_INSTANCE_MAX_OFFSET_Y: f32 = 200.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplatePreview {
    pub title: String,
    pub subtitle: String,
    pub thumbnail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateContract {
    pub id: String,
    pub version: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub category: String,
    #[serde(rename = "requiredInputs")]
    pub required_inputs: Vec<String>,
    #[serde(rename = "optionalInputs")]
    pub optional_inputs: Vec<String>,
    #[serde(rename = "semanticSlots")]
    pub semantic_slots: Vec<String>,
    #[serde(rename = "defaultSteps")]
    pub default_steps: Vec<String>,
    #[serde(rename = "tokenBindings")]
    pub token_bindings: Vec<String>,
    #[serde(rename = "modeBehavior")]
    pub mode_behavior: Value,
    pub preview: TemplatePreview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateDefinition {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "engineCompatibility")]
    pub engine_compatibility: String,
    pub contract: TemplateContract,
}

pub fn catalog() -> Vec<TemplateDefinition> {
    static CATALOG: OnceLock<Vec<TemplateDefinition>> = OnceLock::new();
    CATALOG
        .get_or_init(|| {
            [
                include_str!("../../../templates/components/TitleReveal/component.json"),
                include_str!("../../../templates/components/SectionIntro/component.json"),
                include_str!("../../../templates/components/ExecutiveSummary/component.json"),
                include_str!("../../../templates/components/BeforeAfter/component.json"),
                include_str!("../../../templates/components/KpiHighlight/component.json"),
                include_str!("../../../templates/components/AnnotatedChart/component.json"),
                include_str!("../../../templates/components/SimpleArchitectureDiagram/component.json"),
            ]
            .into_iter()
            .map(|raw| {
                let contract: TemplateContract =
                    serde_json::from_str(raw).expect("checked-in template contracts must be valid JSON");
                TemplateDefinition {
                    schema_version: TEMPLATE_SCHEMA_VERSION.to_string(),
                    engine_compatibility: TEMPLATE_ENGINE_COMPATIBILITY.to_string(),
                    contract,
                }
            })
            .collect()
        })
        .clone()
}

pub fn find_template(template_id: &str) -> Option<TemplateDefinition> {
    catalog()
        .into_iter()
        .find(|definition| definition.contract.id == template_id)
}

pub fn validate_template_contract(template_id: &str, properties: &Value) -> Result<TemplateDefinition, String> {
    let template = find_template(template_id)
        .ok_or_else(|| format!("unknown template id: {template_id}"))?;
    let props = properties
        .as_object()
        .ok_or_else(|| "template properties must be a JSON object".to_string())?;

    for key in &template.contract.required_inputs {
        if !props.contains_key(key) {
            return Err(format!(
                "template {} missing required input: {}",
                template.contract.id, key
            ));
        }
    }

    Ok(template)
}

pub fn apply_template(document: &mut Document, command: &ApplyTemplateCommand) -> Result<NodeId, String> {
    let template = validate_template_contract(&command.template_id, &command.properties)?;
    let scene = document
        .scene(command.scene_id)
        .ok_or_else(|| format!("scene not found: {:?}", command.scene_id))?
        .clone();

    if let Some(instance_node_id) = command.instance_node_id {
        return update_template_instance(document, scene.id, instance_node_id, &template, &command.properties);
    }

    let root = document
        .node(scene.root)
        .ok_or_else(|| format!("scene root not found for {:?}", scene.id))?
        .clone();

    let mut instance = Node::new(
        format!("{} instance", template.contract.display_name),
        NodeKind::ComponentInstance(ComponentInstanceNode {
            component_id: template.contract.id.clone(),
            properties: command.properties.clone(),
        }),
    );
    instance.parent = Some(scene.root);
    instance.semantic.role = Some("template_instance".to_string());
    instance.semantic.label = Some(template.contract.id.clone());
    instance.transform.x = TEMPLATE_INSTANCE_BASE_X
        + (root.children.len() as f32 * TEMPLATE_INSTANCE_OFFSET_X).min(TEMPLATE_INSTANCE_MAX_OFFSET_X);
    instance.transform.y = TEMPLATE_INSTANCE_BASE_Y
        + (root.children.len() as f32 * TEMPLATE_INSTANCE_OFFSET_Y).min(TEMPLATE_INSTANCE_MAX_OFFSET_Y);
    instance.transform.width = 1200.0;
    instance.transform.height = 700.0;

    let instance_id = instance.id;
    document.insert_node(instance);

    if let Some(scene_root) = document.node_mut(scene.root) {
        scene_root.children.push(instance_id);
    }

    let child_ids = build_template_children(document, instance_id, &template, &command.properties);
    if let Some(instance_node) = document.node_mut(instance_id) {
        instance_node.children = child_ids.clone();
    }

    append_template_steps(document, scene.id, &template, &child_ids);

    Ok(instance_id)
}

fn update_template_instance(
    document: &mut Document,
    scene_id: SceneId,
    instance_node_id: NodeId,
    template: &TemplateDefinition,
    properties: &Value,
) -> Result<NodeId, String> {
    let has_template_steps = document
        .scene(scene_id)
        .map(|scene| {
            scene
                .steps
                .iter()
                .any(|step| step.name.contains(&template.contract.display_name))
        })
        .unwrap_or(false);
    let child_ids = {
        let node = document
            .node_mut(instance_node_id)
            .ok_or_else(|| format!("template instance node not found: {:?}", instance_node_id))?;

        let component = match &mut node.data {
            NodeKind::ComponentInstance(component) => component,
            _ => return Err("target node is not a component instance".to_string()),
        };

        if component.component_id != template.contract.id {
            return Err(format!(
                "template instance {} does not match requested template {}",
                component.component_id, template.contract.id
            ));
        }

        component.properties = properties.clone();
        node.children.clone()
    };

    for child_id in &child_ids {
        re_resolve_template_slot(document, *child_id, properties);
    }

    if !has_template_steps {
        append_template_steps(document, scene_id, template, &child_ids);
    }

    Ok(instance_node_id)
}

pub fn re_resolve_template_instances(document: &mut Document) {
    let instances: Vec<(NodeId, Value)> = document
        .nodes
        .iter()
        .filter_map(|(id, node)| match &node.data {
            NodeKind::ComponentInstance(component) => Some((*id, component.properties.clone())),
            _ => None,
        })
        .collect();

    for (instance_id, properties) in instances {
        let children = document
            .node(instance_id)
            .map(|node| node.children.clone())
            .unwrap_or_default();
        for child_id in children {
            re_resolve_template_slot(document, child_id, &properties);
        }
    }
}

fn build_template_children(
    document: &mut Document,
    parent: NodeId,
    template: &TemplateDefinition,
    properties: &Value,
) -> Vec<NodeId> {
    let mut children = Vec::new();

    let title = create_text_node(
        format!("{} Title", template.contract.display_name),
        parent,
        slot_text(properties, "title", &template.contract.preview.title),
        "title",
        0.0,
        0.0,
        1020.0,
        108.0,
        "typography.display.size",
        "color.text.primary",
    );
    let title_id = title.id;
    document.insert_node(title);
    children.push(title_id);

    let subtitle = create_text_node(
        format!("{} Subtitle", template.contract.display_name),
        parent,
        slot_text(properties, "subtitle", &template.contract.preview.subtitle),
        "subtitle",
        0.0,
        118.0,
        1120.0,
        76.0,
        "typography.body.size",
        "color.text.secondary",
    );
    let subtitle_id = subtitle.id;
    document.insert_node(subtitle);
    children.push(subtitle_id);

    match template.contract.id.as_str() {
        "AnnotatedChart" => {
            let mut chart = Node::new(format!("{} Chart", template.contract.display_name), NodeKind::Chart(ChartNode {
                kind: ChartKind::Line,
                data_source: ChartDataSource::Inline {
                    table: crate::node::ChartTable {
                        columns: vec![
                            ChartColumn {
                                key: "x".into(),
                                label: Some("Quarter".into()),
                                data_type: ChartValueType::String,
                                role: Some("x".into()),
                                format: None,
                            },
                            ChartColumn {
                                key: "y".into(),
                                label: Some("Value".into()),
                                data_type: ChartValueType::Number,
                                role: Some("y".into()),
                                format: None,
                            },
                        ],
                        rows: vec![
                            ChartRow { values: vec![json!("Q1"), json!(42)], datum_id: Some("q1".into()) },
                            ChartRow { values: vec![json!("Q2"), json!(49)], datum_id: Some("q2".into()) },
                            ChartRow { values: vec![json!("Q3"), json!(66)], datum_id: Some("q3".into()) },
                            ChartRow { values: vec![json!("Q4"), json!(72)], datum_id: Some("q4".into()) },
                        ],
                    },
                },
                ..ChartNode::default()
            }));
            chart.parent = Some(parent);
            chart.transform.x = 0.0;
            chart.transform.y = 220.0;
            chart.transform.width = 1080.0;
            chart.transform.height = 360.0;
            chart.semantic.role = Some("template_slot:chart".to_string());
            chart.style.fill = Some(StyleValue::token("color.surface.panel"));
            chart.style.stroke = Some(StyleValue::token("color.chart.best"));
            let chart_id = chart.id;
            document.insert_node(chart);
            children.push(chart_id);
        }
        "SimpleArchitectureDiagram" => {
            let mut diagram = Node::new(
                format!("{} Diagram", template.contract.display_name),
                NodeKind::Diagram(DiagramNode {
                    diagram_type: "pipeline".to_string(),
                    definition: json!({
                        "nodes": [
                            slot_text(properties, "systemA", "Input"),
                            slot_text(properties, "systemB", "Engine"),
                            slot_text(properties, "systemC", "Presenter")
                        ],
                        "flowLabel": slot_text(properties, "flowLabel", "Tokenized motion flow")
                    }),
                }),
            );
            diagram.parent = Some(parent);
            diagram.transform.x = 0.0;
            diagram.transform.y = 220.0;
            diagram.transform.width = 1080.0;
            diagram.transform.height = 360.0;
            diagram.semantic.role = Some("template_slot:diagram".to_string());
            diagram.style.fill = Some(StyleValue::token("color.surface.card"));
            let diagram_id = diagram.id;
            document.insert_node(diagram);
            children.push(diagram_id);
        }
        _ => {
            let mut visual = Node::new(
                format!("{} Visual", template.contract.display_name),
                NodeKind::Shape(ShapeNode {
                    kind: ShapeKind::RoundedRectangle { corner_radius: 20.0 },
                }),
            );
            visual.parent = Some(parent);
            visual.transform.x = 0.0;
            visual.transform.y = 220.0;
            visual.transform.width = 1080.0;
            visual.transform.height = 360.0;
            visual.style.fill = Some(StyleValue::token("color.surface.card"));
            visual.style.stroke = Some(StyleValue::token("color.brand.alt"));
            visual.style.stroke_width = Some(StyleValue::literal(1.0));
            visual.semantic.role = Some("template_slot:visual".to_string());
            let visual_id = visual.id;
            document.insert_node(visual);
            children.push(visual_id);
        }
    }

    let callout = create_text_node(
        format!("{} Callout", template.contract.display_name),
        parent,
        slot_text(properties, "annotation", &format!("{} takeaway", template.contract.display_name)),
        "annotation",
        0.0,
        604.0,
        1120.0,
        88.0,
        "typography.caption.size",
        "color.brand",
    );
    let callout_id = callout.id;
    document.insert_node(callout);
    children.push(callout_id);

    children
}

fn create_text_node(
    name: String,
    parent: NodeId,
    content: String,
    slot: &str,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    size_token: &str,
    color_token: &str,
) -> Node {
    let mut node = Node::new(
        name,
        NodeKind::Text(TextNode {
            content,
            font_family: StyleValue::token("typography.body.font"),
            font_size: StyleValue::token(size_token),
            color: StyleValue::token(color_token),
            line_height: None,
            font_weight: None,
        }),
    );
    node.parent = Some(parent);
    node.transform.x = x;
    node.transform.y = y;
    node.transform.width = width;
    node.transform.height = height;
    node.semantic.role = Some(format!("template_slot:{slot}"));
    node.animation.enter_preset = Some(StyleValue::token("motion.reveal.precise"));
    node
}

fn append_template_steps(
    document: &mut Document,
    scene_id: SceneId,
    template: &TemplateDefinition,
    child_ids: &[NodeId],
) {
    let Some(scene) = document.scene_mut(scene_id) else {
        return;
    };

    if child_ids.is_empty() {
        return;
    }

    let reveal_target = child_ids[0];
    let stagger_targets = child_ids.iter().skip(1).copied().collect::<Vec<_>>();

    let mut reveal_step = Step::new(format!("{} · reveal", template.contract.display_name));
    reveal_step.commands = vec![PresentationCommand::Reveal { target: reveal_target }];
    reveal_step.transition.preset = Some(TokenRef::new("motion.reveal.precise"));
    scene.steps.push(reveal_step);

    if !stagger_targets.is_empty() {
        let mut stagger_step = Step::new(format!("{} · build", template.contract.display_name));
        stagger_step.commands = vec![PresentationCommand::StaggeredReveal {
            targets: stagger_targets,
            stagger_ms: Some(90),
        }];
        stagger_step.transition.preset = Some(TokenRef::new("motion.reveal.precise"));
        scene.steps.push(stagger_step);
    }
}

fn re_resolve_template_slot(document: &mut Document, node_id: NodeId, properties: &Value) {
    let Some(node) = document.node_mut(node_id) else {
        return;
    };
    let Some(role) = node.semantic.role.clone() else {
        return;
    };
    let Some(slot) = role.strip_prefix("template_slot:") else {
        return;
    };

    if let NodeKind::Text(text) = &mut node.data {
        let fallback = text.content.clone();
        text.content = slot_text(properties, slot, &fallback);
    }
}

fn slot_text(properties: &Value, key: &str, fallback: &str) -> String {
    properties
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| fallback.to_string())
}

pub fn default_component_payloads() -> Vec<(String, Value)> {
    catalog()
        .into_iter()
        .map(|template| {
            (
                template.contract.id.clone(),
                serde_json::to_value(template).expect("template definitions should serialize"),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        document::Document,
        node::{FrameNode, NodeKind},
        scene::Scene,
    };

    fn make_doc() -> (Document, SceneId) {
        let mut document = Document::new("Template test");
        let root = Node::new("Root", NodeKind::Frame(FrameNode { clip_content: false, corner_radius: None }));
        let root_id = root.id;
        document.insert_node(root);
        let scene = Scene::new("Scene", root_id);
        let scene_id = scene.id;
        document.scenes.push(scene);
        (document, scene_id)
    }

    #[test]
    fn validates_required_inputs() {
        let err = validate_template_contract("TitleReveal", &json!({})).unwrap_err();
        assert!(err.contains("missing required input"));
    }

    #[test]
    fn apply_template_creates_component_instance_and_steps() {
        let (mut document, scene_id) = make_doc();
        let command = ApplyTemplateCommand {
            scene_id,
            template_id: "TitleReveal".to_string(),
            properties: json!({"title": "Milestone 7"}),
            instance_node_id: None,
        };

        let instance_id = apply_template(&mut document, &command).unwrap();
        let instance = document.node(instance_id).unwrap();
        assert!(matches!(instance.data, NodeKind::ComponentInstance(_)));
        assert!(!instance.children.is_empty());
        assert!(!document.scenes[0].steps.is_empty());
    }

    #[test]
    fn token_re_resolve_updates_slot_text() {
        let (mut document, scene_id) = make_doc();
        let command = ApplyTemplateCommand {
            scene_id,
            template_id: "TitleReveal".to_string(),
            properties: json!({"title": "Before token change", "subtitle": "Old subtitle"}),
            instance_node_id: None,
        };

        let instance_id = apply_template(&mut document, &command).unwrap();
        let update = ApplyTemplateCommand {
            scene_id,
            template_id: "TitleReveal".to_string(),
            properties: json!({"title": "After token change", "subtitle": "New subtitle"}),
            instance_node_id: Some(instance_id),
        };

        apply_template(&mut document, &update).unwrap();
        let child_ids = document.node(instance_id).unwrap().children.clone();
        let title_text = child_ids
            .iter()
            .filter_map(|id| document.node(*id))
            .find_map(|node| match &node.data {
                NodeKind::Text(text) if node.semantic.role.as_deref() == Some("template_slot:title") => {
                    Some(text.content.clone())
                }
                _ => None,
            })
            .unwrap();

        assert_eq!(title_text, "After token change");
    }

    #[test]
    fn component_instance_roundtrips_in_document_json() {
        let (mut document, scene_id) = make_doc();
        let command = ApplyTemplateCommand {
            scene_id,
            template_id: "ExecutiveSummary".to_string(),
            properties: json!({
                "headline": "Ship with confidence",
                "pointA": "Template contracts validated",
                "pointB": "Engine apply command wired",
                "pointC": "UI insertion available"
            }),
            instance_node_id: None,
        };
        let instance_id = apply_template(&mut document, &command).unwrap();
        let serialized = serde_json::to_string(&document).unwrap();
        let restored: Document = serde_json::from_str(&serialized).unwrap();
        let restored_instance = restored.node(instance_id).unwrap();
        assert!(matches!(restored_instance.data, NodeKind::ComponentInstance(_)));
    }
}
