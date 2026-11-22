//! App state and key handling. Rendering lives in `ui.rs`.

use std::path::PathBuf;

use anyhow::Result;
use ratatui::DefaultTerminal;
use ratatui::crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::widgets::ListState;

use crate::assessment::{
    self, Answer, Assessment, CLASSIFICATIONS, DSLS, EXPOSURES, Jewel, NOTE_MAX, Opened, REGULATIONS, SECTORS, SIZES,
};
use crate::content::{AssetType, Catalogue, Question};
use crate::engine::{self, is_gap};
use crate::text::{EditOutcome, LineEdit};

pub const STEPS: [&str; 5] = ["Organisation", "Environment", "Crown jewels", "Controls", "Review"];
pub const REVIEW_TABS: [&str; 5] = ["Summary", "Risks", "Domains", "Essential Eight", "Roadmap"];
const MAX_PLATFORMS: usize = 5;
const MAX_JEWELS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrgField {
    Name,
    Abn,
    Jurisdiction,
    PreparedFor,
    PreparedBy,
    Marking,
}

impl OrgField {
    pub fn label(self) -> &'static str {
        match self {
            OrgField::Name => "Organisation name",
            OrgField::Abn => "ABN (optional)",
            OrgField::Jurisdiction => "Primary jurisdiction",
            OrgField::PreparedFor => "Report prepared for",
            OrgField::PreparedBy => "Report prepared by",
            OrgField::Marking => "Protective marking",
        }
    }

    fn limit(self) -> usize {
        match self {
            OrgField::Abn => 11,
            OrgField::Jurisdiction => 100,
            OrgField::Marking => 80,
            _ => 200,
        }
    }

    pub fn get(self, a: &Assessment) -> &str {
        match self {
            OrgField::Name => &a.org.name,
            OrgField::Abn => a.org.abn.as_deref().unwrap_or(""),
            OrgField::Jurisdiction => &a.org.jurisdiction,
            OrgField::PreparedFor => &a.branding.prepared_for,
            OrgField::PreparedBy => &a.branding.prepared_by,
            OrgField::Marking => &a.branding.marking,
        }
    }

    fn set(self, a: &mut Assessment, v: String) {
        match self {
            OrgField::Name => a.org.name = v,
            OrgField::Abn => a.org.abn = if v.is_empty() { None } else { Some(v) },
            OrgField::Jurisdiction => a.org.jurisdiction = v,
            OrgField::PreparedFor => a.branding.prepared_for = v,
            OrgField::PreparedBy => a.branding.prepared_by = v,
            OrgField::Marking => a.branding.marking = v,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrgRow {
    Text(OrgField),
    Sector,
    Size,
    Regulation(usize),
}

pub fn org_rows() -> Vec<OrgRow> {
    let mut rows = vec![
        OrgRow::Text(OrgField::Name),
        OrgRow::Text(OrgField::Abn),
        OrgRow::Sector,
        OrgRow::Size,
        OrgRow::Text(OrgField::Jurisdiction),
    ];
    rows.extend((0..REGULATIONS.len()).map(OrgRow::Regulation));
    rows.extend([OrgField::PreparedFor, OrgField::PreparedBy, OrgField::Marking].map(OrgRow::Text));
    rows
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnvRow {
    /// Index into `Catalogue::bundles`.
    Platform(usize),
    Module(usize, usize),
    Licence(usize),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JewelText {
    Name,
    Description,
    BusinessProcesses,
}

impl JewelText {
    pub fn label(self) -> &'static str {
        match self {
            JewelText::Name => "Name",
            JewelText::Description => "Description",
            JewelText::BusinessProcesses => "Business processes it supports",
        }
    }

    /// Label in the crown-jewel form, where the column is narrow.
    pub fn short_label(self) -> &'static str {
        match self {
            JewelText::Name => "Name",
            JewelText::Description => "Description",
            JewelText::BusinessProcesses => "Supports",
        }
    }

    fn limit(self) -> usize {
        match self {
            JewelText::Name => 200,
            _ => 2000,
        }
    }

    pub fn get(self, j: &Jewel) -> &str {
        match self {
            JewelText::Name => &j.name,
            JewelText::Description => &j.description,
            JewelText::BusinessProcesses => &j.business_processes,
        }
    }

    fn set(self, j: &mut Jewel, v: String) {
        match self {
            JewelText::Name => j.name = v,
            JewelText::Description => j.description = v,
            JewelText::BusinessProcesses => j.business_processes = v,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormRow {
    Text(JewelText),
    Platform,
    AssetType,
    Classification,
    Dsl,
    /// 0 = confidentiality, 1 = integrity, 2 = availability.
    Rating(usize),
    Regulation(usize),
    Exposure(usize),
}

pub fn form_rows() -> Vec<FormRow> {
    let mut rows = vec![
        FormRow::Text(JewelText::Name),
        FormRow::Platform,
        FormRow::AssetType,
        FormRow::Text(JewelText::Description),
        FormRow::Classification,
        FormRow::Dsl,
        FormRow::Rating(0),
        FormRow::Rating(1),
        FormRow::Rating(2),
    ];
    rows.extend((0..REGULATIONS.len()).map(FormRow::Regulation));
    rows.extend((0..EXPOSURES.len()).map(FormRow::Exposure));
    rows.push(FormRow::Text(JewelText::BusinessProcesses));
    rows
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filter {
    All,
    Open,
    Unanswered,
}

impl Filter {
    pub fn label(self) -> &'static str {
        match self {
            Filter::All => "all",
            Filter::Open => "open gaps",
            Filter::Unanswered => "unanswered",
        }
    }
}

#[derive(Debug, Clone)]
pub enum Target {
    Org(OrgField),
    Jewel(usize, JewelText),
    Note(String),
}

pub struct Editing {
    pub target: Target,
    pub title: String,
    pub hint: Option<String>,
    pub input: LineEdit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Overlay {
    Help,
    ConfirmQuit,
    ConfirmDelete(usize),
}

pub struct App {
    pub cat: Catalogue,
    pub a: Assessment,
    pub path: PathBuf,
    pub dirty: bool,
    pub read_only: bool,
    pub web_only: Vec<&'static str>,
    pub step: usize,
    pub status: String,
    pub quit: bool,
    pub editing: Option<Editing>,
    pub overlay: Option<Overlay>,
    /// Index of the crown jewel open in the editor form, and the selected row in it.
    pub form: Option<(usize, usize)>,
    pub org: ListState,
    pub env: ListState,
    pub jewels: ListState,
    pub controls: ListState,
    pub form_state: ListState,
    pub filter: Filter,
    pub detail_scroll: u16,
    pub review_tab: usize,
    pub review_scroll: u16,
}

impl App {
    pub fn new(cat: Catalogue, a: Assessment, path: PathBuf, opened: Opened, existed: bool) -> App {
        let status = if opened.read_only {
            "This file is from a newer crownguard. It's shown read-only; saving is off.".to_string()
        } else if let Some(from) = opened.migrated_from {
            format!(
                "Opened a schema {from} file; it will be saved as schema {}.",
                assessment::SCHEMA_VERSION
            )
        } else if existed {
            format!("Opened {}. Press ? for keys.", path.display())
        } else {
            format!(
                "New assessment; Ctrl+S saves it to {}. Press ? for keys.",
                path.display()
            )
        };
        let selected = || ListState::default().with_selected(Some(0));
        App {
            cat,
            a,
            path,
            dirty: false,
            read_only: opened.read_only,
            web_only: opened.web_only,
            step: 0,
            status,
            quit: false,
            editing: None,
            overlay: None,
            form: None,
            org: selected(),
            env: selected(),
            jewels: selected(),
            controls: selected(),
            form_state: selected(),
            filter: Filter::All,
            detail_scroll: 0,
            review_tab: 0,
            review_scroll: 0,
        }
    }

    // ---- derived lists -------------------------------------------------------------------------------------------

    pub fn env_rows(&self) -> Vec<EnvRow> {
        let mut rows = Vec::new();
        for (bi, b) in self.cat.bundles.iter().enumerate() {
            rows.push(EnvRow::Platform(bi));
            if self.a.platforms.contains(&b.platform.id) {
                rows.extend(
                    b.platform
                        .modules
                        .iter()
                        .enumerate()
                        .filter(|(_, m)| m.optional)
                        .map(|(mi, _)| EnvRow::Module(bi, mi)),
                );
                rows.push(EnvRow::Licence(bi));
            }
        }
        rows
    }

    /// Asset types a crown jewel on this platform can be: those in the core module or an enabled optional one.
    pub fn asset_types(&self, platform: &str) -> Vec<&AssetType> {
        let Some(b) = self.cat.bundle(platform) else {
            return vec![];
        };
        b.asset_types
            .iter()
            .filter(|t| {
                b.platform.modules.iter().any(|m| {
                    m.id == t.module
                        && (!m.optional || self.a.modules.get(platform).is_some_and(|ms| ms.contains(&m.id)))
                })
            })
            .collect()
    }

    pub fn control_list(&self) -> Vec<&Question> {
        let answers = engine::effective_answers(&self.a);
        engine::active_questions(&self.cat, &self.a)
            .into_iter()
            .filter(|q| match self.filter {
                Filter::All => true,
                Filter::Open => is_gap(answers.get(&q.id).copied()),
                Filter::Unanswered => !answers.contains_key(&q.id),
            })
            .collect()
    }

    // ---- events --------------------------------------------------------------------------------------------------

    pub fn on_paste(&mut self, text: &str) {
        if let Some(e) = &mut self.editing {
            e.input.paste(text);
        }
    }

    pub fn on_key(&mut self, key: KeyEvent) {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        if ctrl && key.code == KeyCode::Char('c') {
            self.request_quit();
            return;
        }
        if let Some(e) = &mut self.editing {
            match e.input.handle(key) {
                EditOutcome::Continue => {}
                EditOutcome::Cancel => self.editing = None,
                EditOutcome::Commit(v) => {
                    let target = e.target.clone();
                    self.editing = None;
                    self.commit(target, v);
                }
            }
            return;
        }
        if let Some(o) = self.overlay {
            self.on_overlay_key(o, key);
            return;
        }
        if ctrl && key.code == KeyCode::Char('s') {
            self.save();
            return;
        }
        if ctrl && key.code == KeyCode::Char('q') {
            self.request_quit();
            return;
        }
        if self.form.is_some() {
            self.on_form_key(key);
            return;
        }
        match key.code {
            KeyCode::Char('?') => self.overlay = Some(Overlay::Help),
            KeyCode::Char('q') => self.request_quit(),
            KeyCode::Tab => self.step = (self.step + 1) % STEPS.len(),
            KeyCode::BackTab => self.step = (self.step + STEPS.len() - 1) % STEPS.len(),
            KeyCode::Char(c @ '1'..='5') => self.step = c as usize - '1' as usize,
            _ => match self.step {
                0 => self.on_org_key(key),
                1 => self.on_env_key(key),
                2 => self.on_jewels_key(key),
                3 => self.on_controls_key(key),
                _ => self.on_review_key(key),
            },
        }
    }

    fn on_overlay_key(&mut self, overlay: Overlay, key: KeyEvent) {
        match (overlay, key.code) {
            (Overlay::ConfirmQuit, KeyCode::Char('s')) => {
                self.overlay = None;
                if self.save() {
                    self.quit = true;
                }
            }
            (Overlay::ConfirmQuit, KeyCode::Char('d')) => self.quit = true,
            (Overlay::ConfirmDelete(i), KeyCode::Char('y')) => {
                self.overlay = None;
                if i < self.a.jewels.len() {
                    let j = self.a.jewels.remove(i);
                    self.changed();
                    self.status = format!("Removed {}.", display_name(&j.name));
                }
            }
            (Overlay::Help, _) | (_, KeyCode::Esc | KeyCode::Char('n') | KeyCode::Char('q')) => self.overlay = None,
            _ => {}
        }
    }

    fn request_quit(&mut self) {
        if self.dirty && !self.read_only {
            self.editing = None;
            self.overlay = Some(Overlay::ConfirmQuit);
        } else {
            self.quit = true;
        }
    }

    /// Returns whether the file was written.
    fn save(&mut self) -> bool {
        if self.read_only {
            self.status = "Read-only: this file is from a newer crownguard, so saving is off.".into();
            return false;
        }
        match assessment::save(&self.a, &self.path) {
            Ok(()) => {
                self.dirty = false;
                self.status = format!("Saved {}.", self.path.display());
                true
            }
            Err(e) => {
                self.status = format!("Not saved: {e:#}");
                false
            }
        }
    }

    fn changed(&mut self) {
        self.dirty = true;
        self.a.touch();
    }

    fn edit(&mut self, target: Target, title: String, value: &str, limit: usize, digits: bool, hint: Option<String>) {
        if self.read_only {
            self.status = "Read-only file.".into();
            return;
        }
        self.editing = Some(Editing {
            target,
            title,
            hint,
            input: LineEdit::new(value, limit, digits),
        });
    }

    fn commit(&mut self, target: Target, value: String) {
        match target {
            Target::Org(f) => f.set(&mut self.a, value.trim().to_string()),
            Target::Jewel(i, f) => {
                if let Some(j) = self.a.jewels.get_mut(i) {
                    f.set(j, value.trim().to_string());
                }
            }
            Target::Note(q) => {
                let v = value.trim().to_string();
                if v.is_empty() {
                    self.a.notes.shift_remove(&q);
                } else {
                    self.a.notes.insert(q, v);
                }
            }
        }
        self.changed();
    }

    fn mutate(&mut self, f: impl FnOnce(&mut App)) {
        if self.read_only {
            self.status = "Read-only file.".into();
            return;
        }
        f(self);
        self.changed();
    }

    // ---- Organisation ----------------------------------------------------------------------------------------------

    fn on_org_key(&mut self, key: KeyEvent) {
        let rows = org_rows();
        let i = move_cursor(&mut self.org, rows.len(), key.code);
        let Some(row) = i.map(|i| rows[i]) else {
            return;
        };
        let forward = !matches!(key.code, KeyCode::Left | KeyCode::Char('h'));
        let activate = matches!(
            key.code,
            KeyCode::Enter | KeyCode::Char(' ') | KeyCode::Left | KeyCode::Right | KeyCode::Char('h' | 'l')
        );
        if !activate {
            return;
        }
        match row {
            OrgRow::Text(f) if matches!(key.code, KeyCode::Enter | KeyCode::Char(' ')) => {
                let value = f.get(&self.a).to_string();
                self.edit(
                    Target::Org(f),
                    f.label().into(),
                    &value,
                    f.limit(),
                    f == OrgField::Abn,
                    None,
                );
            }
            OrgRow::Text(_) => {}
            OrgRow::Sector => self.mutate(|app| app.a.org.sector = cycle(&SECTORS, &app.a.org.sector, forward)),
            OrgRow::Size => self.mutate(|app| app.a.org.size = cycle(&SIZES, &app.a.org.size, forward)),
            OrgRow::Regulation(r) => self.mutate(|app| toggle(&mut app.a.org.regulations, REGULATIONS[r].0)),
        }
    }

    // ---- Environment -----------------------------------------------------------------------------------------------

    fn on_env_key(&mut self, key: KeyEvent) {
        let rows = self.env_rows();
        let Some(row) = move_cursor(&mut self.env, rows.len(), key.code).map(|i| rows[i]) else {
            return;
        };
        let forward = !matches!(key.code, KeyCode::Left | KeyCode::Char('h'));
        if !matches!(
            key.code,
            KeyCode::Enter | KeyCode::Char(' ') | KeyCode::Left | KeyCode::Right | KeyCode::Char('h' | 'l')
        ) {
            return;
        }
        match row {
            EnvRow::Platform(bi) => {
                let id = self.cat.bundles[bi].platform.id.clone();
                if !self.a.platforms.contains(&id) && self.a.platforms.len() >= MAX_PLATFORMS {
                    self.status = format!("At most {MAX_PLATFORMS} platforms.");
                    return;
                }
                self.mutate(|app| toggle(&mut app.a.platforms, &id));
                if !self.a.platforms.contains(&id) && self.a.jewels.iter().any(|j| j.platform == id) {
                    self.status =
                        "Crown jewels on that platform are kept, but left out of scoring until you select it again."
                            .into();
                }
            }
            EnvRow::Module(bi, mi) => {
                let pid = self.cat.bundles[bi].platform.id.clone();
                let mid = self.cat.bundles[bi].platform.modules[mi].id.clone();
                self.mutate(|app| {
                    let list = app.a.modules.entry(pid).or_default();
                    toggle(list, &mid);
                });
            }
            EnvRow::Licence(bi) => {
                let p = &self.cat.bundles[bi].platform;
                let ids: Vec<&str> = p.licence_tiers.iter().map(|t| t.id.as_str()).collect();
                let current = self.a.licence.get(&p.id).cloned().unwrap_or_default();
                let next = cycle(&ids, &current, forward);
                let pid = p.id.clone();
                self.mutate(|app| {
                    if next.is_empty() {
                        app.a.licence.shift_remove(&pid);
                    } else {
                        app.a.licence.insert(pid, next);
                    }
                });
            }
        }
    }

    // ---- Crown jewels ----------------------------------------------------------------------------------------------

    fn on_jewels_key(&mut self, key: KeyEvent) {
        let n = self.a.jewels.len();
        let i = move_cursor(&mut self.jewels, n, key.code);
        match key.code {
            KeyCode::Char('a') => self.add_jewel(),
            KeyCode::Enter | KeyCode::Char('e') if i.is_some() => {
                self.form = i.map(|i| (i, 0));
                self.form_state.select(Some(0));
            }
            KeyCode::Char('d') | KeyCode::Delete if i.is_some() && !self.read_only => {
                self.overlay = i.map(Overlay::ConfirmDelete)
            }
            _ => {}
        }
    }

    fn add_jewel(&mut self) {
        if self.read_only {
            self.status = "Read-only file.".into();
            return;
        }
        if self.a.jewels.len() >= MAX_JEWELS {
            self.status = format!("At most {MAX_JEWELS} crown jewels.");
            return;
        }
        let Some(platform) = self.a.platforms.iter().find(|p| self.cat.bundle(p).is_some()).cloned() else {
            self.status = "Choose a platform on the Environment step first.".into();
            return;
        };
        let Some(asset) = self
            .asset_types(&platform)
            .first()
            .map(|t| (t.id.clone(), t.name.clone()))
        else {
            return;
        };
        let first_of_type = !self.a.jewels.iter().any(|j| j.asset_type == asset.0);
        let jewel = Jewel {
            id: uuid::Uuid::new_v4().to_string(),
            name: if first_of_type { asset.1 } else { String::new() },
            platform,
            asset_type: asset.0,
            description: String::new(),
            classification: "confidential".into(),
            dsl: None,
            confidentiality: 4,
            integrity: 4,
            availability: 3,
            regulations: self.a.org.regulations.clone(),
            exposures: vec![],
            business_processes: String::new(),
            extra: Default::default(),
        };
        self.a.jewels.push(jewel);
        self.changed();
        let i = self.a.jewels.len() - 1;
        self.jewels.select(Some(i));
        self.form = Some((i, 0));
        self.form_state.select(Some(0));
    }

    fn on_form_key(&mut self, key: KeyEvent) {
        let Some((ji, _)) = self.form else { return };
        if ji >= self.a.jewels.len() {
            self.form = None;
            return;
        }
        if matches!(key.code, KeyCode::Esc | KeyCode::Char('q')) {
            self.form = None;
            return;
        }
        let rows = form_rows();
        let Some(r) = move_cursor(&mut self.form_state, rows.len(), key.code) else {
            return;
        };
        self.form = Some((ji, r));
        let forward = !matches!(key.code, KeyCode::Left | KeyCode::Char('h'));
        if !matches!(
            key.code,
            KeyCode::Enter | KeyCode::Char(' ') | KeyCode::Left | KeyCode::Right | KeyCode::Char('h' | 'l')
        ) {
            return;
        }
        match rows[r] {
            FormRow::Text(f) => {
                if matches!(key.code, KeyCode::Enter | KeyCode::Char(' ')) {
                    let value = f.get(&self.a.jewels[ji]).to_string();
                    self.edit(Target::Jewel(ji, f), f.label().into(), &value, f.limit(), false, None);
                }
            }
            FormRow::Platform => {
                let platforms: Vec<&str> = self.a.platforms.iter().map(String::as_str).collect();
                let next = cycle_required(&platforms, &self.a.jewels[ji].platform, forward);
                if next != self.a.jewels[ji].platform {
                    let first = self
                        .asset_types(&next)
                        .first()
                        .map(|t| t.id.clone())
                        .unwrap_or_default();
                    self.mutate(|app| {
                        let j = &mut app.a.jewels[ji];
                        j.platform = next;
                        j.asset_type = first;
                    });
                }
            }
            FormRow::AssetType => {
                let j = &self.a.jewels[ji];
                let ids: Vec<String> = self.asset_types(&j.platform).iter().map(|t| t.id.clone()).collect();
                let ids: Vec<&str> = ids.iter().map(String::as_str).collect();
                let next = cycle_required(&ids, &j.asset_type, forward);
                self.mutate(|app| app.a.jewels[ji].asset_type = next);
            }
            FormRow::Classification => {
                let ids = CLASSIFICATIONS.map(|c| c.0);
                self.mutate(|app| {
                    let j = &mut app.a.jewels[ji];
                    j.classification = cycle_required(&ids, &j.classification, forward);
                });
            }
            FormRow::Dsl => {
                let ids = DSLS.map(|c| c.0);
                self.mutate(|app| {
                    let j = &mut app.a.jewels[ji];
                    let next = cycle(&ids, j.dsl.as_deref().unwrap_or(""), forward);
                    j.dsl = if next.is_empty() { None } else { Some(next) };
                });
            }
            FormRow::Rating(k) => self.mutate(|app| {
                let j = &mut app.a.jewels[ji];
                let v = [&mut j.confidentiality, &mut j.integrity, &mut j.availability]
                    .into_iter()
                    .nth(k)
                    .expect("0..3");
                *v = if forward {
                    (*v % 5) + 1
                } else if *v <= 1 {
                    5
                } else {
                    *v - 1
                };
            }),
            FormRow::Regulation(x) => self.mutate(|app| toggle(&mut app.a.jewels[ji].regulations, REGULATIONS[x].0)),
            FormRow::Exposure(x) => self.mutate(|app| toggle(&mut app.a.jewels[ji].exposures, EXPOSURES[x].0)),
        }
    }

    // ---- Controls --------------------------------------------------------------------------------------------------

    fn on_controls_key(&mut self, key: KeyEvent) {
        let ids: Vec<String> = self.control_list().iter().map(|q| q.id.clone()).collect();
        let before = self.controls.selected();
        let i = move_cursor(&mut self.controls, ids.len(), key.code);
        if self.controls.selected() != before {
            self.detail_scroll = 0;
        }
        match key.code {
            KeyCode::PageDown => self.detail_scroll = self.detail_scroll.saturating_add(5),
            KeyCode::PageUp => self.detail_scroll = self.detail_scroll.saturating_sub(5),
            KeyCode::Char('f') => {
                self.filter = match self.filter {
                    Filter::All => Filter::Open,
                    Filter::Open => Filter::Unanswered,
                    Filter::Unanswered => Filter::All,
                };
                self.controls.select(Some(0));
                self.detail_scroll = 0;
            }
            _ => {}
        }
        let Some(id) = i.and_then(|i| ids.get(i)).cloned() else {
            return;
        };
        let answer = match key.code {
            KeyCode::Char('y') => Some(Some(Answer::Yes)),
            KeyCode::Char('p') => Some(Some(Answer::Partial)),
            KeyCode::Char('n') => Some(Some(Answer::No)),
            KeyCode::Char('u') => Some(Some(Answer::Unknown)),
            KeyCode::Char('a') => Some(Some(Answer::Na)),
            KeyCode::Char('x') | KeyCode::Backspace => Some(None),
            KeyCode::Enter | KeyCode::Char('e') => {
                let value = self.a.notes.get(&id).cloned().unwrap_or_default();
                self.edit(
                    Target::Note(id.clone()),
                    format!("Note for {id}"),
                    &value,
                    NOTE_MAX,
                    false,
                    None,
                );
                return;
            }
            _ => None,
        };
        let Some(answer) = answer else { return };
        self.mutate(|app| match answer {
            Some(x) => {
                app.a.answers.insert(id.clone(), x);
            }
            None => {
                app.a.answers.shift_remove(&id);
            }
        });
        if self.read_only {
            return;
        }
        if answer == Some(Answer::Na) && self.a.notes.get(&id).is_none_or(|n| n.trim().is_empty()) {
            let hint = Some("N/A needs a reason. Until it has one it counts as unanswered.".to_string());
            self.edit(
                Target::Note(id.clone()),
                format!("Why is {id} not applicable?"),
                "",
                NOTE_MAX,
                false,
                hint,
            );
        }
        // Move on to the next question; in a filtered list the answered one may have dropped out already.
        let len = self.control_list().len();
        let cur = self.controls.selected().unwrap_or(0);
        let still_listed = self.control_list().get(cur).is_some_and(|q| q.id == id);
        let next = if still_listed { cur + 1 } else { cur };
        self.controls.select(Some(next.min(len.saturating_sub(1))));
        self.detail_scroll = 0;
    }

    // ---- Review ----------------------------------------------------------------------------------------------------

    fn on_review_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Right | KeyCode::Char('l') => {
                self.review_tab = (self.review_tab + 1) % REVIEW_TABS.len();
                self.review_scroll = 0;
            }
            KeyCode::Left | KeyCode::Char('h') => {
                self.review_tab = (self.review_tab + REVIEW_TABS.len() - 1) % REVIEW_TABS.len();
                self.review_scroll = 0;
            }
            KeyCode::Down | KeyCode::Char('j') => self.review_scroll = self.review_scroll.saturating_add(1),
            KeyCode::Up | KeyCode::Char('k') => self.review_scroll = self.review_scroll.saturating_sub(1),
            KeyCode::PageDown => self.review_scroll = self.review_scroll.saturating_add(10),
            KeyCode::PageUp => self.review_scroll = self.review_scroll.saturating_sub(10),
            KeyCode::Home | KeyCode::Char('g') => self.review_scroll = 0,
            _ => {}
        }
    }
}

pub fn display_name(name: &str) -> &str {
    if name.trim().is_empty() { "(unnamed)" } else { name }
}

/// Up/down/home/end movement for a list. Returns the selected index, or None for an empty list.
fn move_cursor(state: &mut ListState, len: usize, code: KeyCode) -> Option<usize> {
    if len == 0 {
        state.select(None);
        return None;
    }
    let cur = state.selected().unwrap_or(0).min(len - 1);
    let next = match code {
        KeyCode::Down | KeyCode::Char('j') => (cur + 1).min(len - 1),
        KeyCode::Up | KeyCode::Char('k') => cur.saturating_sub(1),
        KeyCode::Home | KeyCode::Char('g') => 0,
        KeyCode::End | KeyCode::Char('G') => len - 1,
        _ => cur,
    };
    state.select(Some(next));
    Some(next)
}

fn toggle(list: &mut Vec<String>, id: &str) {
    if let Some(i) = list.iter().position(|x| x == id) {
        list.remove(i);
    } else {
        list.push(id.to_string());
    }
}

/// Next value in `options`, with "not set" (empty) before the first.
fn cycle(options: &[&str], current: &str, forward: bool) -> String {
    let mut all = vec![""];
    all.extend_from_slice(options);
    cycle_required(&all, current, forward)
}

fn cycle_required(options: &[&str], current: &str, forward: bool) -> String {
    if options.is_empty() {
        return current.to_string();
    }
    let n = options.len();
    let next = match options.iter().position(|o| *o == current) {
        Some(i) if forward => (i + 1) % n,
        Some(i) => (i + n - 1) % n,
        None => 0,
    };
    options[next].to_string()
}

pub fn run(mut terminal: DefaultTerminal, mut app: App) -> Result<()> {
    ratatui::crossterm::execute!(std::io::stdout(), ratatui::crossterm::event::EnableBracketedPaste)?;
    let result = (|| -> Result<()> {
        while !app.quit {
            terminal.draw(|f| crate::ui::draw(f, &mut app))?;
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => app.on_key(key),
                Event::Paste(text) => app.on_paste(&text),
                _ => {}
            }
        }
        Ok(())
    })();
    let _ = ratatui::crossterm::execute!(std::io::stdout(), ratatui::crossterm::event::DisableBracketedPaste);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::crossterm::event::KeyModifiers;

    fn press(app: &mut App, code: KeyCode) {
        app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
    }

    fn type_text(app: &mut App, s: &str) {
        for c in s.chars() {
            press(app, KeyCode::Char(c));
        }
    }

    fn new_app() -> App {
        let path = std::env::temp_dir().join(format!("cg-tui-{}.crownguard.json", uuid::Uuid::new_v4()));
        App::new(
            Catalogue::embedded().unwrap(),
            Assessment::empty(),
            path,
            Opened::default(),
            false,
        )
    }

    #[test]
    fn walks_the_wizard_and_saves_a_file_the_scorer_reads() {
        let mut app = new_app();
        // Organisation name.
        press(&mut app, KeyCode::Enter);
        type_text(&mut app, "Riverbend Health");
        press(&mut app, KeyCode::Enter);
        assert_eq!(app.a.org.name, "Riverbend Health");

        // Environment: select the platform on the last row group (microsoft is third: aws, google, microsoft).
        press(&mut app, KeyCode::Char('2'));
        let rows = app.env_rows();
        let ms = rows
            .iter()
            .position(|r| matches!(r, EnvRow::Platform(bi) if app.cat.bundles[*bi].platform.id == "microsoft"))
            .unwrap();
        app.env.select(Some(ms));
        press(&mut app, KeyCode::Char(' '));
        assert_eq!(app.a.platforms, ["microsoft"]);

        // Crown jewel with defaults, then close the form.
        press(&mut app, KeyCode::Char('3'));
        press(&mut app, KeyCode::Char('a'));
        assert!(app.form.is_some());
        press(&mut app, KeyCode::Esc);
        assert_eq!(app.a.jewels.len(), 1);

        // Answer the first control Yes and the second N/A with a reason.
        press(&mut app, KeyCode::Char('4'));
        let first = app.control_list()[0].id.clone();
        let second = app.control_list()[1].id.clone();
        press(&mut app, KeyCode::Char('y'));
        press(&mut app, KeyCode::Char('a'));
        assert!(app.editing.is_some(), "N/A asks why");
        type_text(&mut app, "No such users");
        press(&mut app, KeyCode::Enter);
        assert_eq!(app.a.answers.get(&first), Some(&Answer::Yes));
        assert_eq!(app.a.answers.get(&second), Some(&Answer::Na));
        assert_eq!(app.a.notes.get(&second).map(String::as_str), Some("No such users"));

        // Save and read back.
        app.on_key(KeyEvent::new(KeyCode::Char('s'), KeyModifiers::CONTROL));
        assert!(!app.dirty, "{}", app.status);
        let (back, _) = assessment::load(&app.path).unwrap();
        std::fs::remove_file(&app.path).ok();
        assert_eq!(back.org.name, "Riverbend Health");
        assert_eq!(back.jewels.len(), 1);
        let s = crate::score::summary(&app.cat, &back);
        assert_eq!(s["inPlace"], 1);
        assert_eq!(s["risks"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn quitting_with_changes_asks_first() {
        let mut app = new_app();
        press(&mut app, KeyCode::Char('3'));
        press(&mut app, KeyCode::Char('a')); // no platform yet: refused
        assert!(app.a.jewels.is_empty());
        press(&mut app, KeyCode::Char('1'));
        press(&mut app, KeyCode::Down);
        press(&mut app, KeyCode::Down);
        press(&mut app, KeyCode::Right); // sector
        assert_eq!(app.a.org.sector, "Government");
        press(&mut app, KeyCode::Char('q'));
        assert_eq!(app.overlay, Some(Overlay::ConfirmQuit));
        assert!(!app.quit);
        press(&mut app, KeyCode::Char('d'));
        assert!(app.quit);
    }
}
