//! motion — command-line tool for validation, export, testing, and package build.

use clap::{Parser, Subcommand};

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
    /// Export a presentation to PDF, PNG, or offline bundle.
    Export {
        /// Path to the document JSON file.
        #[arg(value_name = "FILE")]
        file: String,

        /// Export format: pdf, png, bundle.
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

    match cli.command {
        Commands::Validate { file } => {
            println!("Validating: {file}");
            // TODO: load document, run preflight checks, print report
        }
        Commands::Export { file, format, output } => {
            let out = output.unwrap_or_else(|| format!("output.{format}"));
            println!("Exporting {file} → {out} ({format})");
            // TODO: load document, run renderer headlessly, write export
        }
        Commands::BuildBrand { dir, output } => {
            let out = output.unwrap_or_else(|| "brand.motionbrand".to_string());
            println!("Building brand package from {dir} → {out}");
            // TODO: validate tokens.json, bundle fonts, write package archive
        }
    }
}
