//! motion — command-line tool for validation, export, testing, and package build.

use std::{fmt::Write as _, fs, path::PathBuf};

use clap::{Parser, Subcommand};
use motion_core::{
    brand::build_brand_package,
    document::Document,
    node::{Color, Node, NodeId, NodeKind, StyleValue, Transform},
    preflight::run_document_preflight,
    tokens::{parse_hex_color, TokenStore},
};

const PDF_CATALOG_OBJECT_ID: u32 = 1;
const PDF_PAGES_OBJECT_ID: u32 = PDF_CATALOG_OBJECT_ID + 1;
const PDF_FIRST_PAGE_OBJECT_ID: u32 = PDF_PAGES_OBJECT_ID + 1;
const PDF_OBJECTS_PER_SCENE: u32 = 2;

#[derive(Parser)]
#[command(
    name = "motion",
    version,
    about = "Motion presentation engine CLI",
    long_about = None
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Validate a presentation document and print a preflight report.
    Validate {
        /// Path to the document JSON file.
        #[arg(value_name = "FILE")]
        file: String,
    },
    /// Export a presentation to HTML or PDF fallback output.
    Export {
        /// Path to the document JSON file.
        #[arg(value_name = "FILE")]
        file: String,

        /// Export format: html, pdf, bundle.
        #[arg(short, long, default_value = "pdf")]
        format: String,

        /// Output path.
        #[arg(short, long)]
        output: Option<String>,
    },
    /// Build a brand package from a directory.
    BuildBrand {
        /// Path to the brand package source directory.
        #[arg(value_name = "DIR")]
        dir: String,

        /// Output path for the compiled brand package.
        #[arg(short, long)]
        output: Option<String>,
    },
}

fn main() {
    let cli = Cli::parse();

    match run(cli) {
        Ok(()) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Commands::Validate { file } => {
            let document = load_document(&file)?;
            let report = run_document_preflight(&document);
            println!("Preflight {} for {}", status_label(&report.status), file);
            for check in &report.checks {
                let state = if check.passed { "ok" } else { "fail" };
                println!("- [{}] {}: {}", state, check.id, check.message);
                if let Some(details) = &check.details {
                    println!("    {details}");
                }
            }
            Ok(())
        }
        Commands::Export {
            file,
            format,
            output,
        } => {
            let document = load_document(&file)?;
            let extension = output_extension_for(&format);
            let output_path = output.unwrap_or_else(|| format!("output.{extension}"));
            export_document(&document, &format, PathBuf::from(&output_path))?;
            println!("Exported {file} → {output_path} ({format})");
            Ok(())
        }
        Commands::BuildBrand { dir, output } => {
            let out = output.unwrap_or_else(|| "brand.motionbrand".to_string());
            let package = build_brand_package(PathBuf::from(&dir).as_path())?;
            let serialized = serde_json::to_string_pretty(&package)
                .map_err(|error| format!("failed to serialize brand package: {error}"))?;
            fs::write(&out, serialized)
                .map_err(|error| format!("failed to write {out}: {error}"))?;
            println!(
                "Built brand package {} → {} ({} token section(s), {} asset(s))",
                dir,
                out,
                package
                    .tokens
                    .as_object()
                    .map(|object| object.len())
                    .unwrap_or_default(),
                package.assets.len()
            );
            Ok(())
        }
    }
}

fn load_document(path: &str) -> Result<Document, String> {
    let contents =
        fs::read_to_string(path).map_err(|error| format!("failed to read {path}: {error}"))?;
    serde_json::from_str(&contents).map_err(|error| format!("failed to parse {path}: {error}"))
}

fn export_document(document: &Document, format: &str, output: PathBuf) -> Result<(), String> {
    match format {
        "html" | "bundle" => fs::write(&output, render_html_document(document))
            .map_err(|error| format!("failed to write {}: {error}", output.display())),
        "pdf" => fs::write(&output, render_pdf_document(document))
            .map_err(|error| format!("failed to write {}: {error}", output.display())),
        other => Err(format!("unsupported export format: {other}")),
    }
}

fn output_extension_for(format: &str) -> &str {
    match format {
        // The bundle export currently produces a self-contained static HTML fallback.
        "bundle" => "html",
        other => other,
    }
}

fn render_html_document(document: &Document) -> String {
    let mut html = String::new();
    html.push_str("<!doctype html><html><head><meta charset=\"utf-8\" /><title>");
    html.push_str(&escape_html(&document.metadata.title));
    html.push_str("</title><style>");
    html.push_str(&render_font_face_css(document));
    html.push_str(
        "body{font-family:system-ui,sans-serif;background:#0d0d0f;color:#f4f4f5;margin:0;padding:32px;}main{display:grid;gap:32px;}section{background:#151518;border:1px solid #2a2a2e;border-radius:16px;padding:20px;}h1,h2{margin:0 0 12px;} .slide{position:relative;width:1920px;height:1080px;transform:scale(.5);transform-origin:top left;background:#0d0d0f;border:1px solid #2a2a2e;overflow:hidden;} .slide-wrap{width:960px;height:540px;overflow:hidden;border-radius:12px;} .node{position:absolute;white-space:pre-wrap;} .shape{border-radius:8px;} .meta{color:#9ca3af;font-size:12px;margin-bottom:16px;}",
    );
    html.push_str("</style></head><body><main>");
    html.push_str(&format!(
        "<header><h1>{}</h1><p class=\"meta\">{} scene(s) · {} node(s)</p></header>",
        escape_html(&document.metadata.title),
        document.scenes.len(),
        document.nodes.len()
    ));

    for scene in &document.scenes {
        html.push_str("<section>");
        html.push_str(&format!(
            "<h2>{}</h2><div class=\"slide-wrap\"><div class=\"slide\">",
            escape_html(&scene.name)
        ));
        render_scene_html(document, scene.root, &Transform::default(), &mut html);
        html.push_str("</div></div></section>");
    }

    html.push_str("</main></body></html>");
    html
}

fn render_scene_html(document: &Document, node_id: NodeId, parent: &Transform, html: &mut String) {
    let Some(node) = document.node(node_id) else {
        return;
    };
    if !node.visible {
        return;
    }

    let absolute = compose_transform(parent, &node.transform);
    html.push_str(&render_node_html(document, node, &absolute));
    for child_id in &node.children {
        render_scene_html(document, *child_id, &absolute, html);
    }
}

fn render_node_html(document: &Document, node: &Node, absolute: &Transform) -> String {
    let opacity = document
        .tokens
        .resolve_f32(&node.style.opacity)
        .unwrap_or(1.0);
    let mut style = format!(
        "left:{}px;top:{}px;width:{}px;height:{}px;opacity:{};",
        absolute.x, absolute.y, absolute.width, absolute.height, opacity
    );

    match &node.data {
        NodeKind::Frame(_) | NodeKind::Group(_) => {
            if let Some(fill) = node
                .style
                .fill
                .as_ref()
                .and_then(|value| resolve_color_css(&document.tokens, value))
            {
                let _ = write!(style, "background:{};", fill);
            }
            format!("<div class=\"node\" style=\"{}\"></div>", style)
        }
        NodeKind::Shape(_) => {
            if let Some(fill) = node
                .style
                .fill
                .as_ref()
                .and_then(|value| resolve_color_css(&document.tokens, value))
            {
                let _ = write!(style, "background:{};", fill);
            }
            format!("<div class=\"node shape\" style=\"{}\"></div>", style)
        }
        NodeKind::Text(text) => {
            let color = resolve_color_css(&document.tokens, &text.color)
                .unwrap_or_else(|| "#FFFFFF".to_string());
            let font_family = document
                .tokens
                .resolve_string(&text.font_family)
                .unwrap_or("system-ui, sans-serif");
            let font_size = document.tokens.resolve_f32(&text.font_size).unwrap_or(18.0);
            let _ = write!(
                style,
                "color:{};font-family:{};font-size:{}px;",
                color,
                escape_html(font_family),
                font_size
            );
            format!(
                "<div class=\"node\" style=\"{}\">{}</div>",
                style,
                escape_html(&text.content)
            )
        }
        _ => String::new(),
    }
}

fn render_pdf_document(document: &Document) -> Vec<u8> {
    let mut objects = Vec::new();
    let font_id = PDF_FIRST_PAGE_OBJECT_ID + (document.scenes.len() as u32 * PDF_OBJECTS_PER_SCENE);

    objects.push("<< /Type /Catalog /Pages 2 0 R >>".to_string());

    let kids = (0..document.scenes.len())
        .map(|index| {
            format!(
                "{} 0 R",
                PDF_FIRST_PAGE_OBJECT_ID + (index as u32 * PDF_OBJECTS_PER_SCENE)
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    objects.push(format!(
        "<< /Type /Pages /Count {} /Kids [{}] >>",
        document.scenes.len(),
        kids
    ));

    for (index, scene) in document.scenes.iter().enumerate() {
        let page_id = PDF_FIRST_PAGE_OBJECT_ID + (index as u32 * PDF_OBJECTS_PER_SCENE);
        let content_id = page_id + 1;

        let page = format!(
            "<< /Type /Page /Parent {} 0 R /MediaBox [0 0 1280 720] /Resources << /Font << /F1 {} 0 R >> >> /Contents {} 0 R >>",
            PDF_PAGES_OBJECT_ID, font_id, content_id
        );
        objects.push(page);

        let stream = build_pdf_stream(document, scene.root, &scene.name);
        let content = format!(
            "<< /Length {} >>\nstream\n{}\nendstream",
            stream.len(),
            stream
        );
        objects.push(content);
    }

    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string());

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = vec![0usize];
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        let _ = write!(pdf, "{} 0 obj\n{}\nendobj\n", index + 1, object);
    }

    let xref_offset = pdf.len();
    let _ = write!(pdf, "xref\n0 {}\n", objects.len() + 1);
    pdf.push_str("0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        let _ = writeln!(pdf, "{offset:010} 00000 n ");
    }
    let _ = write!(
        pdf,
        "trailer\n<< /Size {} /Root {} 0 R >>\nstartxref\n{}\n%%EOF\n",
        objects.len() + 1,
        PDF_CATALOG_OBJECT_ID,
        xref_offset
    );

    pdf.into_bytes()
}

fn build_pdf_stream(document: &Document, root: NodeId, scene_name: &str) -> String {
    let mut lines = vec![scene_name.to_string()];
    collect_text_lines(document, root, &mut lines);

    let mut stream = String::from("BT\n/F1 28 Tf\n50 680 Td\n");
    for (index, line) in lines.iter().take(24).enumerate() {
        if index > 0 {
            stream.push_str("0 -28 Td\n");
        }
        let _ = writeln!(stream, "({}) Tj", escape_pdf_text(line));
    }
    stream.push_str("ET");
    stream
}

fn collect_text_lines(document: &Document, node_id: NodeId, lines: &mut Vec<String>) {
    let Some(node) = document.node(node_id) else {
        return;
    };
    if let NodeKind::Text(text) = &node.data {
        if !text.content.trim().is_empty() {
            lines.push(text.content.trim().to_string());
        }
    }
    for child in &node.children {
        collect_text_lines(document, *child, lines);
    }
}

fn compose_transform(parent: &Transform, current: &Transform) -> Transform {
    Transform {
        x: parent.x + (current.x * parent.scale_x),
        y: parent.y + (current.y * parent.scale_y),
        width: current.width * parent.scale_x * current.scale_x,
        height: current.height * parent.scale_y * current.scale_y,
        rotation: parent.rotation + current.rotation,
        scale_x: parent.scale_x * current.scale_x,
        scale_y: parent.scale_y * current.scale_y,
    }
}

fn resolve_color_css(tokens: &TokenStore, value: &StyleValue<Color>) -> Option<String> {
    tokens
        .resolve_color(value)
        .map(color_to_css)
        .or_else(|| match value {
            StyleValue::Literal(color) => Some(color_to_css(color.clone())),
            StyleValue::Token(reference) => tokens
                .resolve(&reference.path, 8)
                .and_then(|raw| raw.as_str())
                .and_then(parse_hex_color)
                .map(color_to_css),
        })
}

fn color_to_css(color: Color) -> String {
    format!(
        "rgba({},{},{},{:.3})",
        (color.r * 255.0).round() as u8,
        (color.g * 255.0).round() as u8,
        (color.b * 255.0).round() as u8,
        color.a
    )
}

fn render_font_face_css(document: &Document) -> String {
    let mut css = String::new();
    for asset in &document.assets.assets {
        if !matches!(asset.kind, motion_core::document::AssetKind::Font) {
            continue;
        }
        let Some(family) = asset.name.as_deref() else {
            continue;
        };
        if !asset.uri.starts_with("data:font/") {
            continue;
        }
        let format = if asset.uri.starts_with("data:font/woff2") {
            "woff2"
        } else if asset.uri.starts_with("data:font/woff") {
            "woff"
        } else {
            "opentype"
        };
        let _ = write!(
            css,
            "@font-face{{font-family:'{}';src:url({}) format('{}');font-display:swap;}}",
            escape_html(family),
            asset.uri,
            format
        );
    }
    css
}

fn status_label(status: &motion_core::preflight::PreflightStatus) -> &'static str {
    match status {
        motion_core::preflight::PreflightStatus::Ready => "ready",
        motion_core::preflight::PreflightStatus::Warning => "warning",
        motion_core::preflight::PreflightStatus::Error => "error",
    }
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn escape_pdf_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

#[cfg(test)]
mod tests {
    use super::*;
    use motion_core::{
        document::{Asset, AssetId, AssetKind, Document},
        node::{FrameNode, Node, NodeKind, TextNode},
        scene::Scene,
    };

    fn sample_document() -> Document {
        let mut document = Document::new("Demo");
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
        if let NodeKind::Text(content) = &mut text.data {
            content.content = "Hello Motion".to_string();
        }
        let text_id = text.id;
        document.insert_node(text);
        document.node_mut(root_id).unwrap().children.push(text_id);
        document.scenes.push(Scene::new("Scene 1", root_id));
        document
    }

    #[test]
    fn html_export_contains_scene_name() {
        let html = render_html_document(&sample_document());
        assert!(html.contains("Scene 1"));
        assert!(html.contains("Hello Motion"));
    }

    #[test]
    fn pdf_export_starts_with_pdf_header() {
        let pdf = render_pdf_document(&sample_document());
        assert!(pdf.starts_with(b"%PDF-1.4"));
    }

    #[test]
    fn html_export_embeds_bundled_font_faces() {
        let mut document = sample_document();
        document.assets.assets.push(Asset {
            id: AssetId::new(),
            kind: AssetKind::Font,
            uri: "data:font/woff2;base64,ZmFrZS1mb250".into(),
            hash: "unused".into(),
            name: Some("Inter".into()),
        });

        let html = render_html_document(&document);
        assert!(html.contains("@font-face"));
        assert!(html.contains("font-family:'Inter'"));
        assert!(html.contains("data:font/woff2;base64,ZmFrZS1mb250"));
    }
}
