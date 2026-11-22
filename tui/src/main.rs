//! crownguard in the terminal: the crown-jewel assessment wizard as a Ratatui app, with the question catalogue built
//! in, so it runs as one binary with no browser, Node or network. It reads and writes the same `.crownguard.json`
//! files as the web app; open a file there to add a logo and download the PDF report.

mod app;
mod assessment;
mod content;
mod engine;
mod score;
mod text;
mod ui;

use std::io::IsTerminal;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand, ValueEnum};

use crate::assessment::Assessment;
use crate::content::Catalogue;

#[derive(Parser)]
#[command(name = "crownguard", version, about, args_conflicts_with_subcommands = true)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    /// Assessment to open, or to create if it doesn't exist yet.
    #[arg(default_value = "assessment.crownguard.json")]
    file: PathBuf,
}

#[derive(Subcommand)]
enum Command {
    /// Print the crown-jewel score for an assessment without opening the interface.
    Score {
        file: PathBuf,
        #[arg(long, value_enum, default_value_t = Format::Json)]
        format: Format,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum Format {
    Json,
    Text,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let cat = match Catalogue::embedded() {
        Ok(cat) => cat,
        Err(e) => {
            eprintln!("error: content failed to load: {e:#}");
            return ExitCode::from(2);
        }
    };
    match cli.command {
        Some(Command::Score { file, format }) => {
            let (a, opened) = match assessment::load(&file) {
                Ok(x) => x,
                Err(e) => {
                    eprintln!("error: {e:#}");
                    return ExitCode::from(1);
                }
            };
            if let Some(from) = opened.migrated_from {
                eprintln!(
                    "info: opened a file saved in the older {from} format and brought it up to schema {}.",
                    assessment::SCHEMA_VERSION
                );
            }
            match format {
                Format::Json => println!(
                    "{}",
                    serde_json::to_string_pretty(&score::summary(&cat, &a)).expect("serialises")
                ),
                Format::Text => println!("{}", score::text(&cat, &a)),
            }
            ExitCode::SUCCESS
        }
        None => {
            if !std::io::stdout().is_terminal() {
                eprintln!("error: the interface needs a terminal; use `crownguard score <file>` in scripts");
                return ExitCode::from(1);
            }
            let (a, opened, existed) = if cli.file.exists() {
                match assessment::load(&cli.file) {
                    Ok((a, opened)) => (a, opened, true),
                    Err(e) => {
                        eprintln!("error: {e:#}");
                        return ExitCode::from(1);
                    }
                }
            } else {
                (Assessment::empty(), Default::default(), false)
            };
            let app = app::App::new(cat, a, cli.file, opened, existed);
            let terminal = ratatui::init();
            let result = app::run(terminal, app);
            ratatui::restore();
            match result {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("error: {e:#}");
                    ExitCode::from(3)
                }
            }
        }
    }
}
