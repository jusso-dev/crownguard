//! Rendering. Every screen is drawn from `App` each frame; nothing here changes the assessment.

use ratatui::Frame;
use ratatui::layout::{Constraint, Flex, Layout, Rect};
use ratatui::style::{Color, Modifier, Style, Stylize};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Clear, List, ListItem, Paragraph, Tabs, Wrap};

use crate::app::{App, EnvRow, FormRow, OrgRow, Overlay, REVIEW_TABS, STEPS, display_name, form_rows, org_rows};
use crate::assessment::{Answer, CLASSIFICATIONS, DSLS, EXPOSURES, REGULATIONS, label_of};
use crate::content::Question;
use crate::engine::{self, Report, impact_of, needs_reason};

const ACCENT: Color = Color::Cyan;
const DIM: Style = Style::new().fg(Color::DarkGray);
const SELECTED: Style = Style::new().bg(Color::Rgb(40, 52, 72)).add_modifier(Modifier::BOLD);

pub fn draw(f: &mut Frame, app: &mut App) {
    let [header, body, footer] =
        Layout::vertical([Constraint::Length(2), Constraint::Min(0), Constraint::Length(2)]).areas(f.area());
    draw_header(f, app, header);
    match app.step {
        0 => draw_org(f, app, body),
        1 => draw_env(f, app, body),
        2 => draw_jewels(f, app, body),
        3 => draw_controls(f, app, body),
        _ => draw_review(f, app, body),
    }
    draw_footer(f, app, footer);
    if app.form.is_some() {
        draw_form(f, app);
    }
    if let Some(e) = &app.editing {
        let area = popup(f.area(), 72, 9);
        f.render_widget(Clear, area);
        let mut lines = vec![];
        if let Some(h) = &e.hint {
            lines.push(Line::from(h.as_str()).fg(Color::Yellow));
            lines.push(Line::default());
        }
        let at = e.input.after_cursor();
        let mut chars = at.chars();
        let under = chars.next().map_or(" ".to_string(), String::from);
        lines.push(Line::from(vec![
            Span::raw(e.input.before_cursor()),
            Span::styled(under, Style::new().add_modifier(Modifier::REVERSED)),
            Span::raw(chars.collect::<String>()),
        ]));
        let block = Block::bordered()
            .title(format!(" {} ", e.title))
            .title_bottom(Line::from(" Enter save · Esc cancel ").right_aligned())
            .border_style(Style::new().fg(ACCENT));
        f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }).block(block), area);
    }
    match app.overlay {
        Some(Overlay::Help) => draw_help(f),
        Some(Overlay::ConfirmQuit) => confirm(
            f,
            "Unsaved changes",
            "s  save and quit\nd  quit without saving\nEsc  keep working",
        ),
        Some(Overlay::ConfirmDelete(i)) => {
            let name = app.a.jewels.get(i).map_or("", |j| display_name(&j.name));
            confirm(
                f,
                "Remove crown jewel",
                &format!("Remove {name}?\n\ny  remove\nn  keep"),
            );
        }
        None => {}
    }
}

fn draw_header(f: &mut Frame, app: &App, area: Rect) {
    let [title, tabs] = Layout::vertical([Constraint::Length(1), Constraint::Length(1)]).areas(area);
    let org = if app.a.org.name.is_empty() {
        "New assessment".to_string()
    } else {
        app.a.org.name.clone()
    };
    let mut spans = vec![
        " crownguard ".bold().fg(Color::Black).bg(ACCENT),
        Span::raw(format!(" {org}  ")),
        Span::styled(app.path.display().to_string(), DIM),
    ];
    if app.read_only {
        spans.push(" read-only".fg(Color::Yellow));
    } else if app.dirty {
        spans.push(" ● unsaved".fg(Color::Yellow));
    }
    f.render_widget(Line::from(spans), title);
    let titles = STEPS.iter().enumerate().map(|(i, s)| format!("{} {s}", i + 1));
    let tabs_widget = Tabs::new(titles)
        .select(app.step)
        .highlight_style(Style::new().fg(ACCENT).bold().underlined())
        .divider("│");
    f.render_widget(tabs_widget, tabs);
}

fn draw_footer(f: &mut Frame, app: &App, area: Rect) {
    let keys = if app.editing.is_some() {
        "type to edit · ←/→ move · Enter save · Esc cancel"
    } else if app.form.is_some() {
        "↑/↓ field · Enter edit/toggle · ←/→ change · Esc close · Ctrl+S save"
    } else {
        match app.step {
            0 => "↑/↓ field · Enter edit · ←/→ choose · Space toggle · Tab next step · Ctrl+S save · ? help · q quit",
            1 => "↑/↓ move · Space select · ←/→ licence · Tab next step · Ctrl+S save · ? help · q quit",
            2 => "a add · Enter edit · d remove · Tab next step · Ctrl+S save · ? help · q quit",
            3 => {
                "y yes · p partial · n no · u unknown · a N/A · x clear · Enter note · f filter · PgUp/PgDn detail · ? help"
            }
            _ => "←/→ section · ↑/↓ scroll · Ctrl+S save · ? help · q quit",
        }
    };
    let [status, help] = Layout::vertical([Constraint::Length(1), Constraint::Length(1)]).areas(area);
    f.render_widget(Line::from(format!(" {}", app.status)).fg(Color::Gray), status);
    f.render_widget(Line::from(format!(" {keys}")).style(DIM), help);
}

fn check(on: bool) -> Span<'static> {
    if on { "[x] ".fg(Color::Green) } else { "[ ] ".into() }
}

fn value_or_unset(v: &str) -> Span<'static> {
    if v.is_empty() {
        Span::styled("not set", DIM)
    } else {
        Span::raw(v.to_string())
    }
}

// ---- Organisation ----------------------------------------------------------------------------------------------------

fn draw_org(f: &mut Frame, app: &mut App, area: Rect) {
    let [left, right] = Layout::horizontal([Constraint::Percentage(60), Constraint::Percentage(40)]).areas(area);
    let rows = org_rows();
    let items: Vec<ListItem> = rows
        .iter()
        .map(|row| {
            let line = match *row {
                OrgRow::Text(field) => Line::from(vec![
                    Span::styled(format!("{:<22}", field.label()), DIM),
                    value_or_unset(field.get(&app.a)),
                ]),
                OrgRow::Sector => Line::from(vec![
                    Span::styled(format!("{:<22}", "Sector"), DIM),
                    value_or_unset(&app.a.org.sector),
                    "  ‹›".fg(ACCENT),
                ]),
                OrgRow::Size => Line::from(vec![
                    Span::styled(format!("{:<22}", "Size"), DIM),
                    value_or_unset(&app.a.org.size),
                    "  ‹›".fg(ACCENT),
                ]),
                OrgRow::Regulation(i) => {
                    let (id, label) = REGULATIONS[i];
                    let head = if i == 0 { "Obligations" } else { "" };
                    Line::from(vec![
                        Span::styled(format!("{head:<22}"), DIM),
                        check(app.a.org.regulations.iter().any(|r| r == id)),
                        Span::raw(label),
                    ])
                }
            };
            ListItem::new(line)
        })
        .collect();
    let list = List::new(items)
        .block(Block::bordered().title(" Organisation "))
        .highlight_style(SELECTED)
        .highlight_symbol("▶ ");
    f.render_stateful_widget(list, left, &mut app.org);

    let mut help = vec![
        Line::from("Who the assessment is for.").bold(),
        Line::default(),
        Line::from(
            "The obligations you tick here are copied onto each new crown jewel, and any obligation on a crown jewel raises its impact by one.",
        ),
        Line::default(),
        Line::from(
            "Prepared for / by and the protective marking appear on the PDF report. Add a logo and colours in the web app.",
        ),
    ];
    if let Some(abn) = &app.a.org.abn {
        if abn.len() != 11 {
            help.push(Line::default());
            help.push(Line::from("An ABN has 11 digits.").fg(Color::Yellow));
        }
    }
    f.render_widget(
        Paragraph::new(help)
            .wrap(Wrap { trim: true })
            .block(Block::bordered().title(" About this step ")),
        right,
    );
}

// ---- Environment -----------------------------------------------------------------------------------------------------

fn draw_env(f: &mut Frame, app: &mut App, area: Rect) {
    let [left, right] = Layout::horizontal([Constraint::Percentage(55), Constraint::Percentage(45)]).areas(area);
    let rows = app.env_rows();
    let items: Vec<ListItem> = rows
        .iter()
        .map(|row| {
            let line = match *row {
                EnvRow::Platform(bi) => {
                    let p = &app.cat.bundles[bi].platform;
                    Line::from(vec![
                        check(app.a.platforms.contains(&p.id)),
                        Span::raw(p.name.clone()).bold(),
                    ])
                }
                EnvRow::Module(bi, mi) => {
                    let p = &app.cat.bundles[bi].platform;
                    let m = &p.modules[mi];
                    let on = app.a.modules.get(&p.id).is_some_and(|ms| ms.contains(&m.id));
                    Line::from(vec![
                        Span::raw("    "),
                        check(on),
                        Span::raw(format!("{} module (optional)", m.name)),
                    ])
                }
                EnvRow::Licence(bi) => {
                    let p = &app.cat.bundles[bi].platform;
                    let tier = app
                        .a
                        .licence
                        .get(&p.id)
                        .and_then(|id| p.licence_tiers.iter().find(|t| &t.id == id));
                    Line::from(vec![
                        Span::styled("    Licence  ", DIM),
                        tier.map_or_else(|| Span::styled("not specified", DIM), |t| Span::raw(t.name.clone())),
                        "  ‹›".fg(ACCENT),
                    ])
                }
            };
            ListItem::new(line)
        })
        .collect();
    let list = List::new(items)
        .block(Block::bordered().title(" Platforms "))
        .highlight_style(SELECTED)
        .highlight_symbol("▶ ");
    f.render_stateful_widget(list, left, &mut app.env);

    let selected = app.env.selected().and_then(|i| rows.get(i)).copied();
    let text: Vec<Line> = match selected {
        Some(EnvRow::Platform(bi)) => {
            let b = &app.cat.bundles[bi];
            vec![
                Line::from(b.platform.name.clone()).bold(),
                Line::default(),
                Line::from(b.platform.description.clone()),
                Line::default(),
                Line::from(format!(
                    "{} questions · {} asset types",
                    b.questions.len(),
                    b.asset_types.len()
                ))
                .style(DIM),
            ]
        }
        Some(EnvRow::Module(bi, mi)) => {
            let m = &app.cat.bundles[bi].platform.modules[mi];
            vec![
                Line::from(m.name.clone()).bold(),
                Line::default(),
                Line::from(m.description.clone()),
            ]
        }
        Some(EnvRow::Licence(bi)) => {
            let p = &app.cat.bundles[bi].platform;
            let mut lines = vec![
                Line::from("Licence tier").bold(),
                Line::default(),
                Line::from(
                    "Used to flag fixes that need features your plan doesn't include. It doesn't change any score.",
                ),
            ];
            if let Some(tier) = app
                .a
                .licence
                .get(&p.id)
                .and_then(|id| p.licence_tiers.iter().find(|t| &t.id == id))
            {
                lines.push(Line::default());
                lines.push(Line::from("Includes:").style(DIM));
                for feat in &tier.features {
                    let name = p
                        .licence_features
                        .iter()
                        .find(|x| &x.id == feat)
                        .map_or(feat.as_str(), |x| x.name.as_str());
                    lines.push(Line::from(format!("  • {name}")));
                }
            }
            lines
        }
        None => vec![],
    };
    f.render_widget(
        Paragraph::new(text)
            .wrap(Wrap { trim: true })
            .block(Block::bordered().title(" Details ")),
        right,
    );
}

// ---- Crown jewels ----------------------------------------------------------------------------------------------------

fn band_color(band: &str) -> Color {
    match band {
        "Extreme" => Color::Red,
        "High" => Color::LightRed,
        "Medium" => Color::Yellow,
        _ => Color::Green,
    }
}

fn draw_jewels(f: &mut Frame, app: &mut App, area: Rect) {
    let [left, right] = Layout::horizontal([Constraint::Percentage(55), Constraint::Percentage(45)]).areas(area);
    let report = engine::report(&app.cat, &app.a);
    let items: Vec<ListItem> = app
        .a
        .jewels
        .iter()
        .map(|j| {
            let asset = app
                .cat
                .asset_type(&j.platform, &j.asset_type)
                .map_or(j.asset_type.as_str(), |t| t.name.as_str());
            let risk = report.risks.iter().find(|r| r.jewel.id == j.id);
            let band = match risk {
                Some(r) => Span::styled(format!("{:<8}", r.band), Style::new().fg(band_color(r.band))),
                None => Span::styled(format!("{:<8}", "—"), DIM),
            };
            ListItem::new(vec![
                Line::from(vec![band, Span::raw(display_name(&j.name).to_string()).bold()]),
                Line::from(format!(
                    "        {asset} · {}",
                    label_of(&CLASSIFICATIONS, &j.classification)
                ))
                .style(DIM),
            ])
        })
        .collect();
    let title = format!(" Crown jewels ({}) ", app.a.jewels.len());
    if items.is_empty() {
        let msg = if app.a.platforms.is_empty() {
            "Choose a platform on the Environment step (press 2), then come back and press a to add your first crown jewel."
        } else {
            "No crown jewels yet. Press a to add one: the systems and information that would hurt most if compromised."
        };
        f.render_widget(
            Paragraph::new(msg)
                .wrap(Wrap { trim: true })
                .block(Block::bordered().title(title)),
            left,
        );
    } else {
        let list = List::new(items)
            .block(Block::bordered().title(title))
            .highlight_style(SELECTED)
            .highlight_symbol("▶ ");
        f.render_stateful_widget(list, left, &mut app.jewels);
    }

    let mut lines = vec![];
    if let Some(j) = app.jewels.selected().and_then(|i| app.a.jewels.get(i)) {
        if let Some(r) = report.risks.iter().find(|r| r.jewel.id == j.id) {
            lines.push(Line::from(vec![
                Span::raw("Risk  "),
                Span::styled(
                    format!("{} ({})", r.band, r.score),
                    Style::new().fg(band_color(r.band)).bold(),
                ),
                Span::raw(format!("  impact {} × likelihood {}", r.impact, r.likelihood)),
            ]));
            lines.push(
                Line::from(format!(
                    "{} open gaps · answer confidence {:.0}%",
                    r.gaps.len(),
                    r.confidence * 100.0
                ))
                .style(DIM),
            );
            lines.push(Line::default());
        } else if !app.a.platforms.contains(&j.platform) {
            lines.push(Line::from("Its platform isn't selected, so it isn't scored.").fg(Color::Yellow));
            lines.push(Line::default());
        }
        if let Some(t) = app.cat.asset_type(&j.platform, &j.asset_type) {
            lines.push(Line::from(t.name.clone()).bold());
            lines.push(Line::from(t.description.clone()));
            lines.push(Line::default());
            lines.push(Line::from("Ask yourself").style(DIM));
            lines.extend(t.discovery_prompts.iter().map(|p| Line::from(format!("• {p}"))));
        }
    }
    f.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: true })
            .block(Block::bordered().title(" Details ")),
        right,
    );
}

fn draw_form(f: &mut Frame, app: &mut App) {
    let Some((ji, _)) = app.form else { return };
    let Some(j) = app.a.jewels.get(ji) else {
        return;
    };
    let area = popup(f.area(), 130, 40);
    f.render_widget(Clear, area);
    let [left, right] = Layout::horizontal([Constraint::Percentage(68), Constraint::Percentage(32)]).areas(area);
    let asset = app.cat.asset_type(&j.platform, &j.asset_type);
    let typical: &[String] = asset.map_or(&[], |t| &t.exposures);
    let platform_name = app
        .cat
        .bundle(&j.platform)
        .map_or(j.platform.as_str(), |b| b.platform.name.as_str());
    let field = |label: &str| Span::styled(format!("{label:<17}"), DIM);
    let items: Vec<ListItem> = form_rows()
        .into_iter()
        .map(|row| {
            let line = match row {
                FormRow::Text(t) => Line::from(vec![field(t.short_label()), value_or_unset(&truncate(t.get(j), 60))]),
                FormRow::Platform => Line::from(vec![
                    field("Platform"),
                    Span::raw(platform_name.to_string()),
                    "  ‹›".fg(ACCENT),
                ]),
                FormRow::AssetType => Line::from(vec![
                    field("Asset type"),
                    Span::raw(asset.map_or(j.asset_type.clone(), |t| t.name.clone())),
                    "  ‹›".fg(ACCENT),
                ]),
                FormRow::Classification => Line::from(vec![
                    field("Classification"),
                    Span::raw(label_of(&CLASSIFICATIONS, &j.classification)),
                    "  ‹›".fg(ACCENT),
                ]),
                FormRow::Dsl => Line::from(vec![
                    field("IDCF level"),
                    j.dsl.as_deref().map_or_else(
                        || Span::styled("not classified", DIM),
                        |d| Span::raw(label_of(&DSLS, d)),
                    ),
                    "  ‹›".fg(ACCENT),
                ]),
                FormRow::Rating(k) => {
                    let (label, v) = [
                        ("Confidentiality", j.confidentiality),
                        ("Integrity", j.integrity),
                        ("Availability", j.availability),
                    ][k];
                    Line::from(vec![
                        field(label),
                        Span::raw(format!(
                            "{}{}",
                            "■".repeat(v as usize),
                            "□".repeat(5usize.saturating_sub(v as usize))
                        ))
                        .fg(ACCENT),
                        Span::raw(format!(" {v}/5")),
                    ])
                }
                FormRow::Regulation(i) => {
                    let (id, label) = REGULATIONS[i];
                    Line::from(vec![
                        field(if i == 0 { "Obligations" } else { "" }),
                        check(j.regulations.iter().any(|r| r == id)),
                        Span::raw(label),
                    ])
                }
                FormRow::Exposure(i) => {
                    let (id, label) = EXPOSURES[i];
                    let mut spans = vec![
                        field(if i == 0 { "Exposures" } else { "" }),
                        check(j.exposures.iter().any(|e| e == id)),
                        Span::raw(label),
                    ];
                    if typical.iter().any(|t| t == id) {
                        spans.push(Span::styled("  typical", DIM));
                    }
                    Line::from(spans)
                }
            };
            ListItem::new(line)
        })
        .collect();
    let title = format!(" Crown jewel: {} ", display_name(&j.name));
    let list = List::new(items)
        .block(Block::bordered().title(title).border_style(Style::new().fg(ACCENT)))
        .highlight_style(SELECTED)
        .highlight_symbol("▶ ");
    f.render_stateful_widget(list, left, &mut app.form_state);

    let impact = impact_of(j);
    let mut lines = vec![
        Line::from(format!("Impact {impact}/5")).bold(),
        Line::from("Highest of confidentiality, integrity and availability, plus one for any obligation or a highly confidential classification.").style(DIM),
        Line::default(),
    ];
    if let Some(t) = asset {
        lines.push(Line::from("Examples").style(DIM));
        lines.extend(t.examples.iter().map(|e| Line::from(format!("• {e}"))));
        lines.push(Line::default());
    }
    lines.push(Line::from("Each exposure you tick raises likelihood by half a step.").style(DIM));
    f.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: true })
            .block(Block::bordered().title(" Guidance ")),
        right,
    );
}

// ---- Controls --------------------------------------------------------------------------------------------------------

fn answer_span(app: &App, q: &Question) -> Span<'static> {
    match app.a.answers.get(&q.id) {
        Some(Answer::Na) if needs_reason(&app.a, &q.id) => Span::styled("N/A?   ", Style::new().fg(Color::Yellow)),
        Some(a) => {
            let color = match a {
                Answer::Yes => Color::Green,
                Answer::Partial => Color::Yellow,
                Answer::No => Color::Red,
                Answer::Unknown => Color::Magenta,
                Answer::Na => Color::Gray,
            };
            Span::styled(format!("{:<7}", a.label()), Style::new().fg(color))
        }
        None => Span::styled(format!("{:<7}", "·"), DIM),
    }
}

fn draw_controls(f: &mut Frame, app: &mut App, area: Rect) {
    let [left, right] = Layout::horizontal([Constraint::Percentage(45), Constraint::Percentage(55)]).areas(area);
    let all = engine::active_questions(&app.cat, &app.a);
    let effective = engine::effective_answers(&app.a);
    let answered = all.iter().filter(|q| effective.contains_key(&q.id)).count();
    let list = app.control_list();
    let title = format!(
        " Controls · {answered}/{} answered · showing {} ",
        all.len(),
        app.filter.label()
    );
    if list.is_empty() {
        let msg = if all.is_empty() {
            "No questions in scope yet. Choose a platform (step 2) and add crown jewels (step 3)."
        } else {
            "Nothing matches this filter. Press f to change it."
        };
        f.render_widget(
            Paragraph::new(msg)
                .wrap(Wrap { trim: true })
                .block(Block::bordered().title(title)),
            left,
        );
        f.render_widget(Block::bordered().title(" Question "), right);
        return;
    }
    // The list borrows the catalogue through `app`, so render with a copy of the list state and store it after.
    let mut state = app.controls;
    let sel = state.selected().unwrap_or(0).min(list.len() - 1);
    state.select(Some(sel));
    let width = left.width.saturating_sub(24) as usize;
    let items: Vec<ListItem> = list
        .iter()
        .map(|q| {
            let sev = match q.severity.id() {
                "critical" => Span::styled("C ", Style::new().fg(Color::Red).bold()),
                "high" => Span::styled("H ", Style::new().fg(Color::LightRed)),
                "medium" => Span::styled("M ", Style::new().fg(Color::Yellow)),
                _ => Span::styled("L ", DIM),
            };
            ListItem::new(Line::from(vec![
                answer_span(app, q),
                sev,
                Span::styled(format!("{:<11}", q.id), DIM),
                Span::raw(truncate(&q.question, width)),
            ]))
        })
        .collect();
    let widget = List::new(items)
        .block(Block::bordered().title(title))
        .highlight_style(SELECTED)
        .highlight_symbol("▶");
    f.render_stateful_widget(widget, left, &mut state);

    let q = list[sel];
    let platform = app.cat.bundle(&q.platform);
    let domain = platform
        .and_then(|b| b.platform.domains.iter().find(|d| d.id == q.domain))
        .map_or(q.domain.as_str(), |d| d.name.as_str());
    let mut lines = vec![
        Line::from(vec![Span::styled(
            format!(
                "{} · {} · {} severity · effort {}",
                q.id,
                domain,
                q.severity.id(),
                q.effort.id()
            ),
            DIM,
        )]),
        Line::default(),
        Line::from(q.question.clone()).bold(),
        Line::default(),
        Line::from(vec![Span::raw("Answer  "), answer_span(app, q)]),
    ];
    if let Some(note) = app.a.notes.get(&q.id) {
        lines.push(Line::from(vec![Span::styled("Note    ", DIM), Span::raw(note.clone())]));
    }
    if needs_reason(&app.a, &q.id) {
        lines.push(Line::from("N/A needs a reason (Enter). Until then it counts as unanswered.").fg(Color::Yellow));
    }
    let section = |lines: &mut Vec<Line>, title: &str, body: &str| {
        lines.push(Line::default());
        lines.push(Line::from(title.to_string()).fg(ACCENT).bold());
        lines.push(Line::from(body.to_string()));
    };
    section(&mut lines, "Why it matters", &q.why);
    section(&mut lines, "What yes looks like", &q.yes_looks_like);
    section(&mut lines, "How to fix it", &q.remediation);
    if let Some(b) = platform {
        let have: Vec<&String> = app
            .a
            .licence
            .get(&b.platform.id)
            .and_then(|t| b.platform.licence_tiers.iter().find(|x| &x.id == t))
            .map_or(vec![], |t| t.features.iter().collect());
        let missing: Vec<&str> = q
            .licence
            .iter()
            .filter(|l| !have.contains(l))
            .map(|l| {
                b.platform
                    .licence_features
                    .iter()
                    .find(|x| &x.id == l)
                    .map_or(l.as_str(), |x| x.name.as_str())
            })
            .collect();
        if !missing.is_empty() {
            section(&mut lines, "Licence", &format!("Needs {}", missing.join(", ")));
        }
    }
    let protects: Vec<&str> = app
        .a
        .jewels
        .iter()
        .filter(|j| j.platform == q.platform && q.applies_to_type(&j.asset_type))
        .map(|j| display_name(&j.name))
        .collect();
    if !protects.is_empty() {
        section(&mut lines, "Protects", &protects.join(", "));
    }
    if let Some(ev) = app.a.evidence(&q.id) {
        let checks = ev.get("checks").and_then(|c| c.as_array()).map_or(0, Vec::len);
        let failing = ev
            .get("checks")
            .and_then(|c| c.as_array())
            .map_or(0, |c| c.iter().filter(|x| x["status"] == "fail").count());
        let source = ev.get("source").and_then(|s| s.as_str()).unwrap_or("scan");
        let suggested = ev
            .get("suggested")
            .and_then(|s| s.as_str())
            .unwrap_or("nothing decisive");
        section(
            &mut lines,
            "Scan evidence",
            &format!("{source}: {checks} checks, {failing} failing; suggested {suggested}."),
        );
    }
    let detail = Paragraph::new(lines)
        .wrap(Wrap { trim: true })
        .scroll((app.detail_scroll, 0))
        .block(Block::bordered().title(" Question "));
    f.render_widget(detail, right);
    app.controls = state;
}

// ---- Review ----------------------------------------------------------------------------------------------------------

fn pct(x: f64) -> String {
    format!("{:.0}%", x * 100.0)
}

fn bar(x: f64, width: usize) -> String {
    let filled = (x * width as f64).round() as usize;
    format!("{}{}", "█".repeat(filled), "░".repeat(width - filled.min(width)))
}

fn draw_review(f: &mut Frame, app: &mut App, area: Rect) {
    let [tabs, body] = Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).areas(area);
    f.render_widget(
        Tabs::new(REVIEW_TABS)
            .select(app.review_tab)
            .highlight_style(Style::new().fg(ACCENT).bold())
            .divider("·"),
        tabs,
    );
    let r = engine::report(&app.cat, &app.a);
    let lines = match app.review_tab {
        0 => review_summary(app, &r),
        1 => review_risks(&r),
        2 => review_domains(app, &r),
        3 => review_e8(app, &r),
        _ => review_roadmap(&r),
    };
    let title = format!(" {} ", REVIEW_TABS[app.review_tab]);
    let p = Paragraph::new(Text::from(lines))
        .wrap(Wrap { trim: false })
        .scroll((app.review_scroll, 0))
        .block(Block::bordered().title(title));
    f.render_widget(p, body);
}

fn review_summary(app: &App, r: &Report) -> Vec<Line<'static>> {
    let mut lines = vec![];
    match r.posture.score {
        Some(s) => lines.push(Line::from(vec![
            Span::raw("Control posture   "),
            Span::styled(format!("{} {}", bar(s, 30), pct(s)), Style::new().fg(ACCENT).bold()),
        ])),
        None => lines.push(Line::from("Control posture   n/a (no questions answered in scope)")),
    }
    lines.push(Line::from(format!(
        "Answer confidence {} {}",
        bar(r.posture.confidence, 30),
        pct(r.posture.confidence)
    )));
    lines.push(
        Line::from(format!(
            "{} in place · {} partial · {} assessed of {} in scope",
            r.in_place,
            r.partial,
            r.assessed,
            r.questions.len()
        ))
        .style(DIM),
    );
    let na_missing = app.a.answers.keys().filter(|id| needs_reason(&app.a, id)).count();
    if na_missing > 0 {
        lines.push(
            Line::from(format!(
                "{na_missing} N/A answers have no reason and count as unanswered."
            ))
            .fg(Color::Yellow),
        );
    }
    lines.push(Line::default());

    let counts = ["Extreme", "High", "Medium", "Low"].map(|b| (b, r.risks.iter().filter(|x| x.band == b).count()));
    let mut spans = vec![Span::raw("Crown-jewel risks  ")];
    for (b, n) in counts {
        spans.push(Span::styled(format!("{n} {b}  "), Style::new().fg(band_color(b))));
    }
    lines.push(Line::from(spans));
    lines.push(Line::default());

    // 5×5 heatmap: likelihood rows (5 at the top), impact columns; each cell counts crown jewels.
    lines.push(Line::from("              Impact →").style(DIM));
    for l in (1..=5u8).rev() {
        let mut spans = vec![
            Span::styled(
                if l == 3 {
                    "Likelihood  ".to_string()
                } else {
                    " ".repeat(12)
                },
                DIM,
            ),
            Span::raw(format!("{l} ")),
        ];
        for i in 1..=5u8 {
            let n = r.risks.iter().filter(|x| x.impact == i && x.likelihood == l).count();
            let cell = if n == 0 {
                "  ·  ".to_string()
            } else {
                format!("  {n:<2} ")
            };
            spans.push(Span::styled(
                cell,
                Style::new().bg(band_color(engine::band_of(i * l))).fg(Color::Black),
            ));
        }
        lines.push(Line::from(spans));
    }
    lines.push(Line::from(format!("{}  1    2    3    4    5", " ".repeat(13))).style(DIM));
    lines.push(Line::default());

    if !app.web_only.is_empty() {
        lines.push(
            Line::from(format!(
                "Kept from the web app, not edited here: {}.",
                app.web_only.join(", ")
            ))
            .style(DIM),
        );
    }
    lines.push(
        Line::from("PDF report: open this file in the web app (Open file), or run `pnpm cg render <file> report.pdf`.")
            .style(DIM),
    );
    lines
}

fn review_risks(r: &Report) -> Vec<Line<'static>> {
    if r.risks.is_empty() {
        return vec![Line::from("No crown jewels in scope yet.")];
    }
    let mut lines = vec![];
    for x in &r.risks {
        lines.push(Line::from(vec![
            Span::styled(
                format!("{:<8} {:>2}  ", x.band, x.score),
                Style::new().fg(band_color(x.band)).bold(),
            ),
            Span::raw(display_name(&x.jewel.name).to_string()).bold(),
            Span::styled(
                format!(
                    "  impact {} × likelihood {} · confidence {} · {} gaps",
                    x.impact,
                    x.likelihood,
                    pct(x.confidence),
                    x.gaps.len()
                ),
                DIM,
            ),
        ]));
        for (q, a) in x.gaps.iter().take(5) {
            let ans = a.map_or("unanswered", Answer::label);
            lines.push(
                Line::from(format!(
                    "      {} {:<8} {} ({ans})",
                    q.id,
                    q.severity.id(),
                    truncate(&q.question, 80)
                ))
                .style(DIM),
            );
        }
        if x.gaps.len() > 5 {
            lines.push(Line::from(format!("      … and {} more", x.gaps.len() - 5)).style(DIM));
        }
        lines.push(Line::default());
    }
    lines
}

fn review_domains(app: &App, r: &Report) -> Vec<Line<'static>> {
    if r.domains.is_empty() {
        return vec![Line::from("No questions in scope yet.")];
    }
    let mut lines = vec![];
    let mut last = String::new();
    for d in &r.domains {
        if d.platform != last {
            let name = app
                .cat
                .bundle(&d.platform)
                .map_or(d.platform.clone(), |b| b.platform.name.clone());
            if !last.is_empty() {
                lines.push(Line::default());
            }
            lines.push(Line::from(name).bold());
            last = d.platform.clone();
        }
        let score = d.score.map_or_else(
            || format!("{} n/a", " ".repeat(20)),
            |s| format!("{} {:>4}", bar(s, 20), pct(s)),
        );
        lines.push(Line::from(vec![
            Span::raw(format!("  {:<34}", truncate(&d.name, 34))),
            Span::styled(score, Style::new().fg(ACCENT)),
            Span::styled(
                format!("  {} questions · {} gaps · {} unknown", d.questions, d.gaps, d.unknown),
                DIM,
            ),
        ]));
    }
    lines
}

fn review_e8(app: &App, r: &Report) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from("Indicative only: a level counts when every question at it and below is Yes or N/A.").style(DIM),
        Line::default(),
    ];
    for e in &r.e8 {
        let level = match e.level {
            None => Span::styled("not covered", DIM),
            Some(l) => Span::styled(format!("ML{l} of {}", e.ceiling), Style::new().fg(ACCENT).bold()),
        };
        lines.push(Line::from(vec![
            Span::raw(format!("{:<38}", app.cat.e8_title(e.strategy))),
            level,
        ]));
        if let Some(u) = e.unasked {
            lines.push(Line::from(format!("    stops at ML{}: no questions at level {u}", u - 1)).style(DIM));
        }
        for q in e.blockers.iter().take(4) {
            lines.push(Line::from(format!("    blocks next level: {} {}", q.id, truncate(&q.question, 80))).style(DIM));
        }
        if e.blockers.len() > 4 {
            lines.push(Line::from(format!("    … and {} more", e.blockers.len() - 4)).style(DIM));
        }
    }
    lines
}

fn review_roadmap(r: &Report) -> Vec<Line<'static>> {
    if r.roadmap.is_empty() {
        return vec![Line::from("No open gaps in scope.")];
    }
    let mut lines = vec![];
    let mut phase = "";
    for item in &r.roadmap {
        if item.phase != phase {
            if !phase.is_empty() {
                lines.push(Line::default());
            }
            phase = item.phase;
            lines.push(Line::from(phase.to_string()).fg(ACCENT).bold());
        }
        let jewels = item
            .jewels
            .iter()
            .map(|j| display_name(&j.name))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(Line::from(vec![
            Span::raw(format!(
                "  {:<11} {:<8} {}  ",
                item.question.id,
                item.question.severity.id(),
                item.question.effort.id()
            )),
            Span::raw(truncate(&item.question.question, 90)),
        ]));
        if !jewels.is_empty() {
            lines.push(Line::from(format!("              protects {jewels}")).style(DIM));
        }
    }
    lines
}

// ---- overlays --------------------------------------------------------------------------------------------------------

fn draw_help(f: &mut Frame) {
    let area = popup(f.area(), 70, 24);
    f.render_widget(Clear, area);
    let rows = [
        ("Tab / Shift+Tab, 1–5", "next / previous step, or jump to a step"),
        ("↑ ↓  (j k)", "move"),
        ("Enter", "edit a field, open a crown jewel, add a note"),
        ("Space", "tick or untick"),
        ("← →  (h l)", "change a choice; switch Review sections"),
        ("a / d", "add / remove a crown jewel"),
        ("y p n u a", "answer Yes, Partial, No, Unknown, N/A"),
        ("x", "clear an answer"),
        ("f", "filter controls: all, open gaps, unanswered"),
        ("PgUp / PgDn", "scroll the question or review"),
        ("Ctrl+S", "save"),
        ("q, Ctrl+C", "quit (asks if there are unsaved changes)"),
    ];
    let mut lines: Vec<Line> = rows
        .iter()
        .map(|(k, v)| {
            Line::from(vec![
                Span::styled(format!("{k:<22}"), Style::new().fg(ACCENT)),
                Span::raw(*v),
            ])
        })
        .collect();
    lines.push(Line::default());
    lines.push(Line::from("Files are the same .crownguard.json the web app opens and saves.").style(DIM));
    lines.push(Line::from("Nothing leaves this machine.").style(DIM));
    f.render_widget(
        Paragraph::new(lines).block(Block::bordered().title(" Keys ").border_style(Style::new().fg(ACCENT))),
        area,
    );
}

fn confirm(f: &mut Frame, title: &str, body: &str) {
    let area = popup(f.area(), 48, 8);
    f.render_widget(Clear, area);
    let block = Block::bordered()
        .title(format!(" {title} "))
        .border_style(Style::new().fg(Color::Yellow));
    f.render_widget(Paragraph::new(body.to_string()).block(block), area);
}

fn popup(area: Rect, width: u16, height: u16) -> Rect {
    let [row] = Layout::vertical([Constraint::Length(height.min(area.height))])
        .flex(Flex::Center)
        .areas(area);
    let [cell] = Layout::horizontal([Constraint::Length(width.min(area.width))])
        .flex(Flex::Center)
        .areas(row);
    cell
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::App;
    use crate::assessment;
    use crate::content::Catalogue;
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use std::path::{Path, PathBuf};

    fn screen(term: &Terminal<TestBackend>) -> String {
        let buf = term.backend().buffer();
        buf.content().iter().map(|c| c.symbol()).collect::<Vec<_>>().join("")
    }

    /// Every step, the jewel form, the editor and each overlay render at a roomy and a cramped size without panicking.
    #[test]
    fn every_screen_renders() {
        let fixture = Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../e2e/fixtures/current.crownguard.json"
        ));
        let (a, opened) = assessment::load(fixture).unwrap();
        for (w, h) in [(140, 45), (50, 14), (20, 6)] {
            let mut app = App::new(
                Catalogue::embedded().unwrap(),
                a.clone(),
                PathBuf::from("x.crownguard.json"),
                opened.clone(),
                true,
            );
            let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
            let key = |app: &mut App, code| app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
            for step in 0..5 {
                app.step = step;
                if step == 4 {
                    for _ in 0..5 {
                        term.draw(|f| draw(f, &mut app)).unwrap();
                        key(&mut app, KeyCode::Right);
                    }
                }
                term.draw(|f| draw(f, &mut app)).unwrap();
            }
            app.step = 2;
            key(&mut app, KeyCode::Enter); // open the jewel form
            for _ in 0..30 {
                term.draw(|f| draw(f, &mut app)).unwrap();
                key(&mut app, KeyCode::Down);
            }
            key(&mut app, KeyCode::Esc);
            app.step = 3;
            key(&mut app, KeyCode::Enter); // note editor
            term.draw(|f| draw(f, &mut app)).unwrap();
            key(&mut app, KeyCode::Esc);
            key(&mut app, KeyCode::Char('?'));
            term.draw(|f| draw(f, &mut app)).unwrap();
            key(&mut app, KeyCode::Esc);
            if w == 140 {
                app.step = 4;
                app.review_tab = 0;
                term.draw(|f| draw(f, &mut app)).unwrap();
                let s = screen(&term);

                assert!(s.contains("Control posture"), "summary shows posture");
                assert!(s.contains("Current Co"), "header shows the organisation");
            }
        }
    }
}
