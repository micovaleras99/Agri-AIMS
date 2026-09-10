/**
 * RSC-06 — grounding for the AgriBot widget.
 *
 * The widget answered from a 7-branch if/else in the browser with hardcoded
 * prose, some of it wrong (it said "5 steps" for a 7-step procedure and pointed
 * at a form that no longer exists). Nothing tied an answer to the guidelines.
 *
 * This builds the answer set from what the system already holds — the
 * accreditation checklists, the document requirements, the LSA II rules, the
 * assistance caps and the seeded compliance requirements — so an answer cannot
 * drift from the data the rest of the app enforces, and every answer carries
 * the source it came from.
 *
 * Retrieval is keyword overlap, not an LLM. No model, no API key, no network.
 */

const { STEP2_ITEMS, VALIDATION_CHECKLIST, FACILITIES, ACCREDITATION_STEPS, DISQUALIFICATION_GROUNDS, VALIDATION_PASS_MARK, BRIEFER_META } = require('../config/accreditationChecklists');
const { DOCUMENT_REQUIREMENTS, requirementsFor } = require('../config/documentRequirements');
const { LSA2_STEPS, MIN_YEARS_AS_LSA1 } = require('../config/lsa2');
const { pool } = require('../config/database');
const { ORGANIZATION } = require('../config/organization');
const { helpEntries } = require('../config/systemHelp');
const { minimumAreaFor, DEFAULT_MINIMUM, COCO_MINIMUM } = require('../config/farmEligibility');


const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'do', 'i', 'to', 'of', 'for',
  'what', 'how', 'my', 'me', 'can', 'and', 'in', 'on', 'it', 'be', 'you', 'need',
  'does', 'with', 'that', 'this', 'there', 'have', 'has', 'was', 'about']);

const terms = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/** Static entries — cheap enough to rebuild per call, so nothing goes stale. */
function staticEntries() {
  const e = [];

  // The most basic question a farmer asks — "what is an LSA?" — had no answer
  // in the corpus, so it matched the Directory entry (which merely lists sites)
  // or was answered ungrounded by the model. The definition comes from the
  // Briefer itself so it cannot drift.
  e.push({
    answer: `${BRIEFER_META.overview.join(' ')} ${BRIEFER_META.processingNote}`,
    source: 'LSA Briefer (ATI-QF-PAD-162) — definition',
    keywords: 'what is lsa learning site agriculture definition meaning means define overview about explain describe',
    // A bare "what is an LSA?" reduces to the single term "lsa", which ties the
    // long definition against every other LSA entry and loses on length. A small
    // boost makes the definition win that tie so even the model-down fallback
    // answers the most basic question correctly; queries with extra terms
    // ("lsa ii", "up-scale") still go where they should.
    weight: 1.1,
  });

  e.push({
    answer: `The accreditation procedure has ${ACCREDITATION_STEPS.length} steps: ${ACCREDITATION_STEPS
      .map((st) => `${st.step}) ${st.label} — ${st.desc}`).join('; ')}.`,
    source: 'LSA Guidelines — accreditation procedure',
    // "accredited"/"accredit" and "many"/"number" are here because farmers ask
    // "how many steps to get accredited?" — without them the scorer matched
    // "accreditation" only, and generic accreditation questions were lost to
    // any other entry that happened to say "accredited" (e.g. the registry).
    keywords: 'steps step number many stages accreditation accredited accredit accreditation process procedure apply application become how long lsa lsa1 join enrol',
  });

  e.push({
    answer: `Every Learning Site must have these basic facilities: ${FACILITIES
      .map((f) => f.label).join(', ')}. The holding area must take at least 30 participants, and comfort rooms must be separate for male and female.`,
    source: 'LSA Guidelines — Qualification Requirements, The Farm',
    keywords: 'facility facilities requirements farm holding wash toilet comfort demonstration tda area infrastructure',
  });

  e.push({
    answer: `An LSA I operator may apply to up-scale to LSA II after ${MIN_YEARS_AS_LSA1} years as an accredited LSA I. The LSA II procedure has ${LSA2_STEPS.length} steps: ${LSA2_STEPS.map((s, i) => `${i + 1}) ${s.label || s.name || s}`).join('; ')}.`,
    source: 'LSA Guidelines — up-scaling to LSA II',
    keywords: 'lsa2 lsa ii upscale up-scaling upgrade level two second promote',
  });

  // appliesTo is a predicate, not a label. requirementsFor({}) gives the set
  // every applicant submits; the conditional ones name their own audience in
  // `form` ("Agri-processing enterprise", "Government-owned site", ...).
  const universal = requirementsFor({}).map((d) => d.label);
  e.push({
    answer: `Every applicant submits: ${universal.join(', ')}.`,
    source: 'ATI List of Documentary Requirements',
    keywords: `which what list document documents documentary requirement requirements needed required submit ${universal.join(' ')}`,
  });

  const conditional = {};
  for (const d of DOCUMENT_REQUIREMENTS.filter((d) => d.appliesTo)) {
    (conditional[d.form] ||= []).push(d.label);
  }
  for (const [audience, labels] of Object.entries(conditional)) {
    e.push({
      answer: `Additional documents for ${audience}: ${labels.join(', ')}.`,
      source: 'ATI List of Documentary Requirements',
      keywords: `document documents requirement additional extra ${audience} ${labels.join(' ')}`,
      weight: 0.7,
    });
  }

  // Checklist lines are things an evaluator ticks, not answers to a question.
  // "What is the minimum farm area?" was returning the tick-box "Farm area meets
  // minimum requirement" instead of the rule with the Coco-LSA and urban
  // exceptions, purely because the shorter entry attracted a smaller length
  // penalty. They stay in the corpus — they are the only source for some
  // questions — but they yield to a purpose-written answer that scores as well.
  for (const item of [...STEP2_ITEMS, ...VALIDATION_CHECKLIST]) {
    e.push({
      answer: item.label,
      source: 'LSA eligibility / field validation checklist',
      keywords: `${item.label} ${item.category} eligible eligibility qualify qualification checklist`,
      weight: 0.6,
    });
  }

  // Rules the system now enforces, so the bot quotes the same numbers the code
  // does rather than a checklist label that merely mentions them.
  e.push({
    answer: `A Learning Site needs at least ${DEFAULT_MINIMUM.toLocaleString()} sq.m. `
      + `Coco-LSA needs ${COCO_MINIMUM.toLocaleString()} sq.m. (1 hectare), and urban or peri-urban `
      + 'agriculture has no minimum at all but must be productive.',
    source: 'LSA Briefer — Farm Requirements',
    keywords: 'minimum area size hectare square meters sqm farm big small land how large requirement',
  });

  e.push({
    answer: `These persons may not become an LSA operator: ${DISQUALIFICATION_GROUNDS.join('; ')}. `
      + 'Every applicant declares at Step 1 that none of these apply to them.',
    source: 'LSA Briefer — Disqualified persons',
    keywords: 'disqualified disqualification cannot not eligible barred public official employee spouse children who may not',
  });

  e.push({
    answer: `Field validation has ${VALIDATION_CHECKLIST.length} inspection items and at least `
      + `${VALIDATION_PASS_MARK} must be met for the farm to be found compliant.`,
    source: 'LSA Guidelines — field validation',
    keywords: 'pass mark how many items validation inspection compliant threshold score',
  });

  // How to use the system, not just what the guidelines say. Without these,
  // "how do I register a farmer?" matched an operator-qualification line and
  // answered confidently with the wrong thing.
  e.push(...helpEntries());

  return e;
}

/** Seeded compliance requirements already carry their own guideline citation. */
async function complianceEntries() {
  try {
    const [rows] = await pool.query(
      'SELECT title, description, source_reference FROM compliance_requirements'
    );
    return rows.map((r) => ({
      answer: r.description ? `${r.title} — ${r.description}` : r.title,
      source: `LSA Guidelines — ${r.source_reference}`,
      keywords: `${r.title} ${r.description || ''} compliance monitoring requirement obligation`,
      // Each row is one individual requirement, not a definition of compliance
      // monitoring. Like the checklist items, they stay in the corpus (some
      // questions have no other source) but yield to a purpose-written help
      // entry that scores as well — otherwise the dozens of them crowded the
      // "what is compliance monitoring?" help answer out of the results.
      weight: 0.6,
    }));
  } catch {
    // ponytail: chatbot degrades to the static corpus if the DB is unreachable.
    return [];
  }
}

const FALLBACK = {
  answer:
    `I could not find that in the LSA guidelines this system holds. For anything else, contact ${ORGANIZATION.officeShort} at ${ORGANIZATION.email} or ${ORGANIZATION.phone}.`,
  source: null,
};

/**
 * Best-matching answer for a free-text question.
 * @param {string} question
 * @returns {Promise<{answer: string, source: string|null, matched: boolean}>}
 */
/**
 * The best-matching entries for a question, ranked.
 *
 * Split out from answer() so a language model can be given several snippets to
 * ground its reply, rather than one. The scoring is unchanged.
 *
 * @param {string} question
 * @param {number} [limit]
 * @returns {Promise<Array<{answer: string, source: string|null, score: number}>>}
 */
async function retrieve(question, limit = 4) {
  const q = terms(question);
  if (!q.length) return [];

  const entries = [...staticEntries(), ...(await complianceEntries())];
  const scored = [];

  for (const entry of entries) {
    // Keywords say what an entry is *about*; the answer text only mentions
    // things in passing. Scoring them the same meant "what documents do I
    // need?" could be won by the notifications entry, which happens to contain
    // the phrase "returned documents". A keyword hit is worth a full point, a
    // body-only mention a fraction of one.
    const kw = new Set(terms(entry.keywords));
    const body = new Set(terms(entry.answer));

    let hits = 0;
    let keywordHits = 0;
    for (const w of q) {
      if (kw.has(w)) { hits += 1; keywordHits += 1; }
      else if (body.has(w)) hits += 0.3;
    }
    if (!keywordHits) continue;   // a passing mention alone is not an answer

    const weight = entry.weight === undefined ? 1 : entry.weight;
    // The length term is only a tie-break between otherwise equal entries.
    const score = (hits / q.length) * weight - (kw.size + body.size) / 20000;
    if (score > 0) scored.push({ answer: entry.answer, source: entry.source, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

async function answer(question) {
  const hits = await retrieve(question, 1);
  if (!hits.length) return { ...FALLBACK, matched: false };
  return { answer: hits[0].answer, source: hits[0].source, matched: true };
}

/**
 * The whole corpus, unranked, for the language-model path.
 *
 * Keyword retrieve() had to pick the best few of these to fit a context window;
 * the corpus is small enough (~77 short entries, a few thousand tokens) that the
 * model can be handed all of it instead. That removes the keyword-tuning
 * treadmill — a reworded question the scorer would miss is still answered,
 * because the model sees every entry — while grounding is unchanged: it is still
 * only these guideline entries, never the model's own training.
 *
 * @returns {Promise<Array<{answer: string, source: string|null}>>}
 */
async function allEntries() {
  return [...staticEntries(), ...(await complianceEntries())];
}

module.exports = { answer, retrieve, allEntries };
