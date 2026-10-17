//! Scoring, ported from `src/engine/risk.ts`, `maturity.ts` and `roadmap.ts`. The TypeScript engine is the reference:
//! `tui/parity.ts` checks this port against `pnpm cg score` on the e2e fixtures, so keep the two in step.

use std::collections::{HashMap, HashSet};

use crate::assessment::{Answer, Assessment, Jewel};
use crate::content::{Catalogue, E8_STRATEGIES, Question, Severity};

pub type Answers = HashMap<String, Answer>;

/// Score credited for an answer. Unknown and unanswered never count as compliant. N/A is excluded.
pub fn answer_value(a: Option<Answer>) -> Option<f64> {
    match a {
        Some(Answer::Yes) => Some(1.0),
        Some(Answer::Partial) => Some(0.5),
        Some(Answer::Na) => None,
        _ => Some(0.0),
    }
}

pub fn is_gap(a: Option<Answer>) -> bool {
    !matches!(a, Some(Answer::Yes | Answer::Na))
}

/// N/A must be justified. Without a reason it doesn't count as an answer, so it is scored as a gap.
pub fn needs_reason(a: &Assessment, question: &str) -> bool {
    a.answers.get(question) == Some(&Answer::Na) && a.notes.get(question).is_none_or(|n| n.trim().is_empty())
}

/// The answers the scoring uses: unjustified N/A answers are dropped (treated as unanswered).
pub fn effective_answers(a: &Assessment) -> Answers {
    a.answers
        .iter()
        .filter(|(id, _)| !needs_reason(a, id))
        .map(|(id, ans)| (id.clone(), *ans))
        .collect()
}

/// Questions in scope: selected platforms, core module plus enabled optional modules, and either platform-wide ("*")
/// or protecting at least one recorded crown jewel.
pub fn active_questions<'c>(cat: &'c Catalogue, a: &Assessment) -> Vec<&'c Question> {
    let mut out = Vec::new();
    for pid in &a.platforms {
        let Some(bundle) = cat.bundle(pid) else {
            continue;
        };
        let enabled: HashSet<&str> = bundle
            .platform
            .modules
            .iter()
            .filter(|m| !m.optional || a.modules.get(pid).is_some_and(|ms| ms.contains(&m.id)))
            .map(|m| m.id.as_str())
            .collect();
        let jewel_types: HashSet<&str> = a
            .jewels
            .iter()
            .filter(|j| &j.platform == pid)
            .map(|j| j.asset_type.as_str())
            .collect();
        out.extend(bundle.questions.iter().filter(|q| {
            enabled.contains(q.module.as_str())
                && q.applies_to
                    .iter()
                    .any(|t| t == "*" || jewel_types.contains(t.as_str()))
        }));
    }
    out
}

#[derive(Debug, Default, Clone, Copy)]
pub struct GapStats {
    pub weight: f64,
    pub gap: f64,
    pub unknown_weight: f64,
}

pub fn gap_stats(questions: &[&Question], answers: &Answers) -> GapStats {
    let mut s = GapStats::default();
    for q in questions {
        let a = answers.get(&q.id).copied();
        let Some(v) = answer_value(a) else { continue };
        let w = q.severity.weight();
        s.weight += w;
        s.gap += w * (1.0 - v);
        if matches!(a, None | Some(Answer::Unknown)) {
            s.unknown_weight += w;
        }
    }
    s
}

/// `Math.min(5, Math.max(1, Math.round(n)))`. JS rounds halves up; every input here is positive, where Rust agrees.
fn clamp(n: f64) -> u8 {
    n.round().clamp(1.0, 5.0) as u8
}

pub fn impact_of(j: &Jewel) -> u8 {
    let base = j.confidentiality.max(j.integrity).max(j.availability);
    let uplift = u8::from(!j.regulations.is_empty() || j.classification == "highly-confidential");
    (base + uplift).min(5)
}

/// Likelihood 1–5: 1 + 4 × weighted gap ratio, +0.5 per exposure flag. Any open critical-severity gap floors it at 3.
pub fn likelihood_of(stats: GapStats, exposures: usize, open_critical: bool) -> u8 {
    let ratio = if stats.weight == 0.0 {
        0.0
    } else {
        stats.gap / stats.weight
    };
    let raw = 1.0 + 4.0 * ratio + 0.5 * exposures as f64;
    clamp(if open_critical { raw.max(3.0) } else { raw })
}

pub fn band_of(score: u8) -> &'static str {
    match score {
        20.. => "Extreme",
        10.. => "High",
        5.. => "Medium",
        _ => "Low",
    }
}

#[derive(Debug, Clone)]
pub struct JewelRisk<'a> {
    pub jewel: &'a Jewel,
    pub impact: u8,
    pub likelihood: u8,
    pub score: u8,
    pub band: &'static str,
    /// Share of question weight with a real answer (not unknown/unanswered), 0–1.
    pub confidence: f64,
    pub gaps: Vec<(&'a Question, Option<Answer>)>,
}

fn by_severity(a: &Question, b: &Question) -> std::cmp::Ordering {
    b.severity
        .weight()
        .total_cmp(&a.severity.weight())
        .then_with(|| a.id.cmp(&b.id))
}

pub fn assess_jewel<'a>(jewel: &'a Jewel, questions: &[&'a Question], answers: &Answers) -> JewelRisk<'a> {
    let relevant: Vec<&Question> = questions
        .iter()
        .copied()
        .filter(|q| q.applies_to_type(&jewel.asset_type))
        .collect();
    let stats = gap_stats(&relevant, answers);
    let mut gaps: Vec<&Question> = relevant
        .iter()
        .copied()
        .filter(|q| is_gap(answers.get(&q.id).copied()))
        .collect();
    gaps.sort_by(|a, b| by_severity(a, b));
    let open_critical = gaps.iter().any(|q| q.severity == Severity::Critical);
    let impact = impact_of(jewel);
    let likelihood = likelihood_of(stats, jewel.exposures.len(), open_critical);
    let score = impact * likelihood;
    JewelRisk {
        jewel,
        impact,
        likelihood,
        score,
        band: band_of(score),
        confidence: if stats.weight == 0.0 {
            0.0
        } else {
            1.0 - stats.unknown_weight / stats.weight
        },
        gaps: gaps.into_iter().map(|q| (q, answers.get(&q.id).copied())).collect(),
    }
}

pub fn assess_all<'a>(cat: &'a Catalogue, a: &'a Assessment) -> Vec<JewelRisk<'a>> {
    let questions = active_questions(cat, a);
    let answers = effective_answers(a);
    let mut risks: Vec<JewelRisk> = a
        .jewels
        .iter()
        .filter(|j| a.platforms.contains(&j.platform))
        .map(|j| assess_jewel(j, &questions, &answers))
        .collect();
    risks.sort_by(|x, y| y.score.cmp(&x.score).then(y.impact.cmp(&x.impact)));
    risks
}

#[derive(Debug, Clone)]
pub struct DomainPosture {
    pub platform: String,
    pub domain: String,
    pub name: String,
    /// Weighted compliance 0–1, or None when every question is N/A.
    pub score: Option<f64>,
    pub questions: usize,
    pub gaps: usize,
    pub unknown: usize,
}

pub fn domain_posture(cat: &Catalogue, a: &Assessment) -> Vec<DomainPosture> {
    let questions = active_questions(cat, a);
    let answers = effective_answers(a);
    let mut out = Vec::new();
    for pid in &a.platforms {
        let Some(bundle) = cat.bundle(pid) else {
            continue;
        };
        for d in &bundle.platform.domains {
            let qs: Vec<&Question> = questions
                .iter()
                .copied()
                .filter(|q| q.domain == d.id && q.platform == bundle.platform.id)
                .collect();
            if qs.is_empty() {
                continue;
            }
            let s = gap_stats(&qs, &answers);
            out.push(DomainPosture {
                platform: pid.clone(),
                domain: d.id.clone(),
                name: d.name.clone(),
                score: if s.weight == 0.0 {
                    None
                } else {
                    Some(1.0 - s.gap / s.weight)
                },
                questions: qs.len(),
                gaps: qs.iter().filter(|q| is_gap(answers.get(&q.id).copied())).count(),
                unknown: qs
                    .iter()
                    .filter(|q| matches!(answers.get(&q.id), None | Some(Answer::Unknown)))
                    .count(),
            });
        }
    }
    out
}

#[derive(Debug, Clone, Copy)]
pub struct Posture {
    pub score: Option<f64>,
    pub confidence: f64,
}

pub fn overall_posture(cat: &Catalogue, a: &Assessment) -> Posture {
    let s = gap_stats(&active_questions(cat, a), &effective_answers(a));
    if s.weight == 0.0 {
        return Posture {
            score: None,
            confidence: 0.0,
        };
    }
    Posture {
        score: Some(1.0 - s.gap / s.weight),
        confidence: 1.0 - s.unknown_weight / s.weight,
    }
}

#[derive(Debug, Clone)]
pub struct E8Result<'c> {
    pub strategy: &'static str,
    /// Indicative maturity level reached, or None when the questionnaire doesn't cover the strategy.
    pub level: Option<u8>,
    /// Highest level the questionnaire has questions for.
    pub ceiling: u8,
    /// Open questions blocking the next level.
    pub blockers: Vec<&'c Question>,
    /// A level below the ceiling with no questions, which stops the assessment there.
    pub unasked: Option<u8>,
}

/// ASD's model adds no requirement at these levels over the level below (`NO_NEW_REQUIREMENTS`).
fn adds_nothing(strategy: &str, level: u8) -> bool {
    strategy == "patch-operating-systems" && level == 2
}

/// ASD rule: a maturity level is achieved only when every requirement at that level and below is met. A level with no
/// questions cannot be verified, so assessment stops there, unless ASD adds nothing at that level.
pub fn essential_eight<'c>(questions: &[&'c Question], answers: &Answers) -> Vec<E8Result<'c>> {
    let satisfied = |q: &Question| matches!(answers.get(&q.id), Some(Answer::Yes | Answer::Na));
    E8_STRATEGIES
        .iter()
        .map(|&strategy| {
            let tagged = |level: u8| -> Vec<&'c Question> {
                questions
                    .iter()
                    .copied()
                    .filter(|q| q.e8.iter().any(|t| t.strategy == strategy && t.level == level))
                    .collect()
            };
            let result = |level, ceiling, blockers, unasked| E8Result {
                strategy,
                level,
                ceiling,
                blockers,
                unasked,
            };
            let mut ceiling = [3, 2, 1].into_iter().find(|&l| !tagged(l).is_empty()).unwrap_or(0);
            if ceiling == 0 {
                return result(None, 0, vec![], None);
            }
            while ceiling < 3 && adds_nothing(strategy, ceiling + 1) {
                ceiling += 1;
            }
            let mut level = 0;
            for l in 1..=3 {
                let qs = tagged(l);
                if qs.is_empty() && adds_nothing(strategy, l) {
                    level = l;
                    if l == ceiling {
                        break;
                    }
                    continue;
                }
                if qs.is_empty() {
                    return result(Some(level), ceiling, vec![], Some(l));
                }
                let open: Vec<&Question> = qs.into_iter().filter(|q| !satisfied(q)).collect();
                if !open.is_empty() {
                    return result(Some(level), ceiling, open, None);
                }
                level = l;
                if l == ceiling {
                    break;
                }
            }
            result(Some(level), ceiling, vec![], None)
        })
        .collect()
}

#[derive(Debug, Clone)]
pub struct RoadmapItem<'a> {
    pub question: &'a Question,
    /// Weighted risk reduction across the crown jewels this control protects.
    pub reduction: f64,
    pub priority: f64,
    pub jewels: Vec<&'a Jewel>,
    pub phase: &'static str,
}

pub fn build_roadmap<'a>(questions: &[&'a Question], jewels: &[&'a Jewel], answers: &Answers) -> Vec<RoadmapItem<'a>> {
    let mut items: Vec<RoadmapItem> = questions
        .iter()
        .copied()
        .filter(|q| is_gap(answers.get(&q.id).copied()))
        .map(|question| {
            let shortfall = 1.0 - answer_value(answers.get(&question.id).copied()).unwrap_or(1.0);
            let protects: Vec<&Jewel> = jewels
                .iter()
                .copied()
                .filter(|j| question.applies_to_type(&j.asset_type))
                .collect();
            let impact_sum: u32 = protects.iter().map(|j| u32::from(impact_of(j))).sum();
            let impact_sum = if impact_sum == 0 { 1.0 } else { f64::from(impact_sum) };
            let reduction = question.severity.weight() * shortfall * impact_sum;
            RoadmapItem {
                question,
                reduction,
                priority: reduction / question.effort.cost(),
                jewels: protects,
                phase: "",
            }
        })
        .collect();
    items.sort_by(|a, b| {
        b.priority
            .total_cmp(&a.priority)
            .then_with(|| a.question.id.cmp(&b.question.id))
    });
    let n = items.len() as f64;
    for (i, item) in items.iter_mut().enumerate() {
        let i = i as f64;
        let urgent = item.question.severity == Severity::Critical && item.question.effort != crate::content::Effort::L;
        item.phase = if i < n / 3.0 || urgent {
            "0–30 days"
        } else if i < 2.0 * n / 3.0 {
            "31–60 days"
        } else {
            "61–90 days"
        };
    }
    items
}

/// Everything the Review screen and `crownguard score` show, computed once per change.
pub struct Report<'a> {
    pub questions: Vec<&'a Question>,
    pub answers: Answers,
    pub posture: Posture,
    pub risks: Vec<JewelRisk<'a>>,
    pub domains: Vec<DomainPosture>,
    pub e8: Vec<E8Result<'a>>,
    pub roadmap: Vec<RoadmapItem<'a>>,
    pub in_place: usize,
    pub partial: usize,
    pub assessed: usize,
}

pub fn report<'a>(cat: &'a Catalogue, a: &'a Assessment) -> Report<'a> {
    let questions = active_questions(cat, a);
    let answers = effective_answers(a);
    let jewels: Vec<&Jewel> = a.jewels.iter().filter(|j| a.platforms.contains(&j.platform)).collect();
    let count =
        |f: &dyn Fn(Option<Answer>) -> bool| questions.iter().filter(|q| f(answers.get(&q.id).copied())).count();
    Report {
        posture: overall_posture(cat, a),
        risks: assess_all(cat, a),
        domains: domain_posture(cat, a),
        e8: essential_eight(&questions, &answers),
        roadmap: build_roadmap(&questions, &jewels, &answers),
        in_place: count(&|x| x == Some(Answer::Yes)),
        partial: count(&|x| x == Some(Answer::Partial)),
        assessed: count(&|x| x.is_some_and(|x| x != Answer::Na)),
        questions,
        answers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Map;

    fn jewel(c: u8, i: u8, av: u8) -> Jewel {
        Jewel {
            id: "j".into(),
            name: "J".into(),
            platform: "microsoft".into(),
            asset_type: "ms-entra-tenant".into(),
            description: String::new(),
            classification: "confidential".into(),
            dsl: None,
            confidentiality: c,
            integrity: i,
            availability: av,
            regulations: vec![],
            exposures: vec![],
            business_processes: String::new(),
            extra: Map::new(),
        }
    }

    #[test]
    fn impact_uplifts_for_regulation_or_highly_confidential() {
        let mut j = jewel(3, 2, 1);
        assert_eq!(impact_of(&j), 3);
        j.regulations.push("privacy-act".into());
        assert_eq!(impact_of(&j), 4);
        let mut j = jewel(5, 5, 5);
        j.classification = "highly-confidential".into();
        assert_eq!(impact_of(&j), 5);
    }

    #[test]
    fn likelihood_floors_at_three_with_open_critical() {
        let none = GapStats {
            weight: 10.0,
            gap: 0.0,
            unknown_weight: 0.0,
        };
        assert_eq!(likelihood_of(none, 0, false), 1);
        assert_eq!(likelihood_of(none, 0, true), 3);
        let all = GapStats {
            weight: 10.0,
            gap: 10.0,
            unknown_weight: 10.0,
        };
        assert_eq!(likelihood_of(all, 3, false), 5);
        let half = GapStats {
            weight: 8.0,
            gap: 3.0,
            unknown_weight: 0.0,
        };
        assert_eq!(likelihood_of(half, 0, false), 3); // 1 + 1.5 = 2.5 rounds up, as Math.round does
    }

    #[test]
    fn bands() {
        assert_eq!(band_of(25), "Extreme");
        assert_eq!(band_of(10), "High");
        assert_eq!(band_of(5), "Medium");
        assert_eq!(band_of(4), "Low");
    }

    #[test]
    fn unjustified_na_is_a_gap() {
        let mut a = Assessment::empty();
        a.answers.insert("MS-ID-001".into(), Answer::Na);
        assert!(effective_answers(&a).is_empty());
        a.notes.insert("MS-ID-001".into(), "No users".into());
        assert_eq!(effective_answers(&a).get("MS-ID-001"), Some(&Answer::Na));
    }

    #[test]
    fn all_yes_scores_full_posture() {
        let cat = Catalogue::embedded().unwrap();
        let mut a = Assessment::empty();
        a.platforms.push("microsoft".into());
        a.jewels.push(jewel(4, 4, 3));
        for q in active_questions(&cat, &a) {
            a.answers.insert(q.id.clone(), Answer::Yes);
        }
        let r = report(&cat, &a);
        assert_eq!(r.posture.score, Some(1.0));
        assert_eq!(r.risks[0].likelihood, 1);
        assert!(r.roadmap.is_empty());
    }
}
