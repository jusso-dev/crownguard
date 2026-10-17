//! A single-line text editor for the TUI's input popups.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

#[derive(Debug, Clone)]
pub struct LineEdit {
    chars: Vec<char>,
    /// Cursor position, in chars.
    pub cursor: usize,
    max: usize,
    digits_only: bool,
}

pub enum EditOutcome {
    Continue,
    Commit(String),
    Cancel,
}

impl LineEdit {
    pub fn new(value: &str, max: usize, digits_only: bool) -> LineEdit {
        let chars: Vec<char> = value.chars().collect();
        LineEdit {
            cursor: chars.len(),
            chars,
            max,
            digits_only,
        }
    }

    pub fn value(&self) -> String {
        self.chars.iter().collect()
    }

    pub fn before_cursor(&self) -> String {
        self.chars[..self.cursor].iter().collect()
    }

    pub fn after_cursor(&self) -> String {
        self.chars[self.cursor..].iter().collect()
    }

    pub fn handle(&mut self, key: KeyEvent) -> EditOutcome {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        match key.code {
            KeyCode::Enter => return EditOutcome::Commit(self.value()),
            KeyCode::Esc => return EditOutcome::Cancel,
            KeyCode::Left => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Right => self.cursor = (self.cursor + 1).min(self.chars.len()),
            KeyCode::Home => self.cursor = 0,
            KeyCode::End => self.cursor = self.chars.len(),
            KeyCode::Char('a') if ctrl => self.cursor = 0,
            KeyCode::Char('e') if ctrl => self.cursor = self.chars.len(),
            KeyCode::Char('u') if ctrl => {
                self.chars.drain(..self.cursor);
                self.cursor = 0;
            }
            KeyCode::Backspace if self.cursor > 0 => {
                self.cursor -= 1;
                self.chars.remove(self.cursor);
            }
            KeyCode::Delete if self.cursor < self.chars.len() => {
                self.chars.remove(self.cursor);
            }
            KeyCode::Char(c) if !ctrl => self.insert(c),
            _ => {}
        }
        EditOutcome::Continue
    }

    /// Pasted text arrives as one string; newlines become spaces, as every field here is one line.
    pub fn paste(&mut self, text: &str) {
        for c in text.chars() {
            self.insert(if c == '\n' || c == '\r' { ' ' } else { c });
        }
    }

    fn insert(&mut self, c: char) {
        if self.chars.len() >= self.max || c.is_control() || (self.digits_only && !c.is_ascii_digit()) {
            return;
        }
        self.chars.insert(self.cursor, c);
        self.cursor += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    #[test]
    fn edits_and_respects_limits() {
        let mut e = LineEdit::new("ab", 4, false);
        e.handle(key(KeyCode::Left));
        e.handle(key(KeyCode::Char('x')));
        assert_eq!(e.value(), "axb");
        e.handle(key(KeyCode::Char('y')));
        e.handle(key(KeyCode::Char('z')));
        assert_eq!(e.value(), "axyb", "capped at 4 chars");
        e.handle(key(KeyCode::Backspace));
        assert_eq!(e.value(), "axb");
        assert!(matches!(e.handle(key(KeyCode::Enter)), EditOutcome::Commit(v) if v == "axb"));
    }

    #[test]
    fn digits_only() {
        let mut e = LineEdit::new("", 11, true);
        e.paste("51 824 753 556");
        assert_eq!(e.value(), "51824753556");
    }
}
