//! `crownguard score`: the crown-jewel part of `pnpm cg score`'s JSON, with the same keys, so scripts can use either.

use serde_json::{Value, json};

use crate::assessment::Assessment;
use crate::content::Catalogue;
use crate::engine::{self, needs_reason};

pub fn summary(cat: &Catalogue, a: &Assessment) -> Value {
    let r = engine::report(cat, a);
    json!({
        "posture": { "score": r.posture.score, "confidence": r.posture.confidence },
        "inPlace": r.in_place,
        "partial": r.partial,
        "assessed": r.assessed,
        "inScope": r.questions.len(),
        "unanswered": r.questions.iter().filter(|q| !r.answers.contains_key(&q.id)).map(|q| &q.id).collect::<Vec<_>>(),
        "naMissingReason": a.answers.keys().filter(|id| needs_reason(a, id)).collect::<Vec<_>>(),
        "risks": r.risks.iter().map(|x| json!({
            "jewel": x.jewel.name,
            "impact": x.impact,
            "likelihood": x.likelihood,
            "score": x.score,
            "band": x.band,
            "confidence": x.confidence,
            "gaps": x.gaps.len(),
        })).collect::<Vec<_>>(),
        "domains": r.domains.iter().map(|d| json!({
            "platform": d.platform,
            "domain": d.domain,
            "name": d.name,
            "score": d.score,
            "questions": d.questions,
            "gaps": d.gaps,
            "unknown": d.unknown,
        })).collect::<Vec<_>>(),
        "e8": r.e8.iter().map(|e| json!({
            "strategy": e.strategy,
            "title": cat.e8_title(e.strategy),
            "level": e.level,
            "ceiling": e.ceiling,
            "blockers": e.blockers.iter().map(|q| &q.id).collect::<Vec<_>>(),
            "unasked": e.unasked,
        })).collect::<Vec<_>>(),
        "roadmap": r.roadmap.iter().map(|i| json!({
            "id": i.question.id,
            "severity": i.question.severity.id(),
            "effort": i.question.effort.id(),
            "phase": i.phase,
            "reduction": i.reduction,
        })).collect::<Vec<_>>(),
    })
}

/// Short human summary, as `cg score --format text`.
pub fn text(cat: &Catalogue, a: &Assessment) -> String {
    let r = engine::report(cat, a);
    let pct = |x: f64| format!("{}%", (x * 100.0).round());
    let posture = r.posture.score.map_or_else(|| "n/a".to_string(), pct);
    let name = if a.org.name.is_empty() {
        "(unnamed)"
    } else {
        &a.org.name
    };
    let risks = r
        .risks
        .iter()
        .map(|x| format!("{} {} ({})", x.jewel.name, x.band, x.score))
        .collect::<Vec<_>>()
        .join("; ");
    let e8 =
        r.e8.iter()
            .map(|e| {
                format!(
                    "{}=ML{}",
                    e.strategy,
                    e.level.map_or("–".to_string(), |l| l.to_string())
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
    [
        format!("{name} — posture {posture} (confidence {})", pct(r.posture.confidence)),
        format!(
            "{} in place, {} partial, {} assessed of {} in scope",
            r.in_place,
            r.partial,
            r.assessed,
            r.questions.len()
        ),
        format!("Risks: {}", if risks.is_empty() { "none".into() } else { risks }),
        format!("Essential Eight: {}", if e8.is_empty() { "n/a".into() } else { e8 }),
    ]
    .join("\n")
}
