/**
 * Classification of LSA — taken from the Guidelines, "Classification of LSA"
 * (pages 9-10), and worded as the document words it.
 *
 *   Farming LSAs. A farm that practicing/engaged in any of the farming
 *   activities such as:
 *     • Good Agricultural Practice (GAP);
 *     • Good Animal Husbandry Practice (GAHP);
 *     • Natural Farming;
 *     • Organic Agriculture;
 *     • Integrated/diversified farming;
 *     • Cut Flowers, Ornamentals, and Succulents;
 *     • Halal; and
 *     • Urban and Peri-Urban Agriculture.
 *
 *   Agri-Processing LSA. The farmers and non-farmers who are engaged in the
 *   processing of fruits & vegetables, meat, fish, and other agricultural
 *   products including the by-products of agricultural commodities.
 *
 * Note the shape the document uses: eight farming classifications, and
 * agri-processing as a *separate kind of LSA* rather than a ninth farming
 * activity. `kind` carries that distinction, and it is what decides which set
 * of compliance requirements a farm is measured against.
 *
 * This list had been written out three times — in the applicant form, in the
 * accreditation briefer screen, and implicitly in whatever was stored on the
 * farms table — and the three disagreed with each other and with the document.
 * They now all read from here.
 *
 * `key` is what the database stores, in both `applicants.classification` and
 * `farms.classification`. Labels are for people and change with the wording of
 * the source document; keys are identifiers and do not.
 */

const CLASSIFICATIONS = [
  {
    key: 'gap_crops',
    label: 'Good Agricultural Practice (GAP)',
    kind: 'farming',
    desc: 'Various crops following good agricultural practices',
  },
  {
    key: 'gahp_animals',
    label: 'Good Animal Husbandry Practice (GAHP)',
    kind: 'farming',
    desc: 'Various animals following good husbandry practices',
  },
  {
    key: 'natural_farming',
    label: 'Natural Farming',
    kind: 'farming',
    desc: 'Organic practice without formal certification',
  },
  {
    key: 'organic',
    label: 'Organic Agriculture',
    kind: 'farming',
    desc: 'Certified by an Organic Agriculture Certifying Body',
  },
  {
    key: 'integrated',
    label: 'Integrated/Diversified Farming',
    kind: 'farming',
    desc: 'Commodity-based farming system',
  },
  {
    key: 'cut_flowers',
    label: 'Cut Flowers, Ornamentals, and Succulents',
    kind: 'farming',
    desc: '',
  },
  {
    key: 'halal',
    label: 'Halal',
    kind: 'farming',
    desc: '',
  },
  {
    key: 'urban_agriculture',
    label: 'Urban and Peri-Urban Agriculture',
    kind: 'farming',
    desc: 'No minimum area requirement, but the site must be productive',
  },
  {
    key: 'agri_processing',
    label: 'Agri-Processing Enterprise',
    kind: 'agri_processing',
    desc: 'Processing of fruits, vegetables, meat, fish and by-products',
  },
];

const byKey = new Map(CLASSIFICATIONS.map((c) => [c.key, c]));

/**
 * Labels that were stored before the vocabulary was unified, mapped to keys.
 *
 * Only needed for reading rows written before migration 018 — the migration
 * itself resolves each farm through its applicant, which is more reliable than
 * matching on wording.
 */
const LEGACY_LABELS = {
  'gap - crops': 'gap_crops',
  'gahp - animals': 'gahp_animals',
  'gahp - fishery': 'gahp_animals',
  'natural farming': 'natural_farming',
  'organic agriculture': 'organic',
  'organic agriculture (certified)': 'organic',
  'integrated farming': 'integrated',
  'integrated/diversified farming': 'integrated',
  'cut flowers & ornamentals': 'cut_flowers',
  'cut flowers, ornamentals, and succulents': 'cut_flowers',
  halal: 'halal',
  'urban/peri-urban agriculture': 'urban_agriculture',
  'urban and peri-urban agriculture': 'urban_agriculture',
  'agri-processing enterprise': 'agri_processing',
};

const all = () => CLASSIFICATIONS.slice();
const farming = () => CLASSIFICATIONS.filter((c) => c.kind === 'farming');
const processing = () => CLASSIFICATIONS.filter((c) => c.kind === 'agri_processing');
const keys = () => CLASSIFICATIONS.map((c) => c.key);
const labels = () => CLASSIFICATIONS.map((c) => c.label);

/** The stored value resolved to a key, accepting a legacy label. */
function keyFor(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (byKey.has(raw)) return raw;
  return LEGACY_LABELS[raw.toLowerCase()] || '';
}

/**
 * How a classification should read on screen.
 * Unrecognised values are returned as they are rather than hidden, so a bad
 * row shows itself instead of silently rendering blank.
 */
function labelFor(value) {
  if (!value) return '';
  const key = keyFor(value);
  return key ? byKey.get(key).label : String(value);
}

/**
 * Which compliance set applies. The Guidelines separate agri-processing from
 * farming, and the two have different requirements.
 *
 * This replaces a `/processing/i` test against the classification string,
 * which would also have matched a farming classification that happened to
 * contain the word.
 */
function isAgriProcessing(value) {
  return keyFor(value) === 'agri_processing';
}

/** 'agri_processing' or 'farming', as the compliance tables expect. */
function appliesTo(value) {
  return isAgriProcessing(value) ? 'agri_processing' : 'farming';
}

/**
 * Options for a filter over a column of keys: the whole vocabulary, plus
 * anything recorded that is not part of it, so no row becomes unfilterable.
 *
 * @param {string[]} recorded values present on the rows being filtered
 * @returns {{value: string, label: string}[]}
 */
function filterOptions(recorded = []) {
  const options = CLASSIFICATIONS.map((c) => ({ value: c.key, label: c.label }));
  const known = new Set(keys());
  for (const value of recorded) {
    if (!value || known.has(value)) continue;
    const key = keyFor(value);
    if (key && known.has(key)) continue;
    known.add(value);
    options.push({ value, label: String(value) });
  }
  return options;
}

module.exports = {
  CLASSIFICATIONS,
  LEGACY_LABELS,
  all,
  farming,
  processing,
  keys,
  labels,
  keyFor,
  labelFor,
  isAgriProcessing,
  appliesTo,
  filterOptions,
};
