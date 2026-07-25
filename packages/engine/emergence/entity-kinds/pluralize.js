// Multi-lingual noun pluralizer — productive rules per language with seed
// irregulars from UniMorph N;PL bundles. Follows the eoreader4.2 morph.js
// pattern (productive rules + UniMorph seed irregulars).
//
// Pure and deterministic: no ambient state, no network calls.
//
// Language codes use ISO 639-3 (eng, deu, fra, spa, jpn, ara, ...).

// ── English irregulars (minimal embedded fallback) ─────────────────────────
// For full coverage, load priors from eoPriors.SEED_IRREGULAR_PLURAL and pass
// them as the `priors` option. This embedded set ensures basic function even
// when priors are not available (pure engine context).
const FALLBACK_IRREGULAR = new Map(Object.entries({
  person:"people", man:"men", woman:"women", child:"children",
  foot:"feet", tooth:"teeth", mouse:"mice", goose:"geese", ox:"oxen",
  louse:"lice", die:"dice", penny:"pence", deer:"deer", fish:"fish",
  sheep:"sheep", swine:"swine", series:"series", species:"species",
  criterion:"criteria", phenomenon:"phenomena", datum:"data", corpus:"corpora",
  index:"indices", appendix:"appendices", axis:"axes", thesis:"theses",
  analysis:"analyses", hypothesis:"hypotheses", crisis:"crises",
  curriculum:"curricula", medium:"media", bacterium:"bacteria", stratum:"strata",
  focus:"foci", nucleus:"nuclei", fungus:"fungi", alumnus:"alumni",
}));

// ── German irregulars (from UniMorph deu N;PL) ───────────────────────────
const DE_IRREGULAR = new Map(Object.entries({
  // Umlaut + -er
  mann:"männer", buch:"bücher", blatt:"blätter", dorf:"dörfer",
  haus:"häuser", volk:"völker", wald:"wälder", gott:"götter",
  // Umlaut + -e
  gast:"gäste", ball:"bälle", baum:"bäume", grund:"gründe",
  hals:"hälse", kopf:"köpfe", korb:"körbe", platz:"plätze",
  schlag:"schläge", stuhl:"stühle", ton:"töne", vogel:"vögel",
  // -er (no umlaut)
  kind:"kinder", biert:"biere",
  // -en
  staat:"staaten", bär:"bären", mensch:"menschen",
  // -er
  kleid:"kleider", lamm:"lämmer",
}));

// ── French irregulars (from UniMorph fra N;PL) ───────────────────────────
const FR_IRREGULAR = new Map(Object.entries({
  // -al → -aux
  journal:"journaux", cheval:"chevaux", animal:"animaux", général:"généraux",
  hôpital:"hôpitaux", mal:"maux", idéal:"idéaux",
  // -ail → -aux
  travail:"travaux", corail:"coraux", vitrail:"vitraux",
  // -ou → -oux (most take -s, these are exceptions)
  bijou:"bijoux", caillou:"cailloux", chou:"choux", genou:"genoux",
  hibou:"hiboux", joujou:"joujoux", pou:"poux",
  // -eu → -eux
  cheveu:"cheveux", lieu:"lieux", jeu:"jeux",
  // -au → -aux (most take -s, these take -x)
  bateau:"bateaux", chapeau:"chapeaux", manteau:"manteaux",
  drapeau:"drapeaux", gâteau:"gâteaux", château:"châteaux",
  // -euil → -eux
  œil:"yeux",
  // Zero-derivation (same form)
  fils:"fils", corps:"corps", prix:"prix", nez:"nez", temps:"temps",
  bras:"bras", voix:"voix", croix:"croix", pois:"pois", souris:"souris",
}));

// ── Spanish irregulars (from UniMorph spa N;PL) ──────────────────────────
const ES_IRREGULAR = new Map(Object.entries({
  // -z → -ces
  vez:"veces", luz:"luces", voz:"voces", paz:"paces", actriz:"actrices",
  nariz:"narices", raíz:"raíces", pez:"peces", lápiz:"lápices",
  // -án/én/ón → -anes/enes/ones (remove accent, add -es)
  joven:"jóvenes",
  // Invariants (same in plural)
  crisis:"crisis", análisis:"análisis", dosis:"dosis", tesis:"tesis",
  parásito:"parásitos",
  // Others
  mamá:"mamás", papá:"papás", sofá:"sofás",
}));

// ── Per-language rule sets ────────────────────────────────────────────────
const capitalize = (w, c) => (c ? w.charAt(0).toUpperCase() + w.slice(1) : w);

function pluralizeEnglish(canonical, cap, priorMap) {
  if (priorMap && priorMap.has(canonical)) return capitalize(priorMap.get(canonical), cap);
  if (FALLBACK_IRREGULAR.has(canonical)) return capitalize(FALLBACK_IRREGULAR.get(canonical), cap);
  // -f/-fe → -ves (with exceptions)
  if (/(?:fe?)$/i.test(canonical) && !/^(chief|chef|belief|roof|cliff|gulf|reef|proof|sheriff|tariff|handkerchief)$/.test(canonical)) {
    return capitalize(canonical.replace(/(?:fe?)$/, "ves"), cap);
  }
  // consonant + y → -ies
  if (/[bcdfghjklmnpqrstvwxz]y$/i.test(canonical)) return capitalize(canonical.replace(/y$/, "ies"), cap);
  // -s, -sh, -ch, -x, -z → -es
  if (/[sxz]$|[cs]h$/i.test(canonical)) return capitalize(canonical + "es", cap);
  return capitalize(canonical + "s", cap);
}

function pluralizeGerman(canonical, cap) {
  if (DE_IRREGULAR.has(canonical)) return capitalize(DE_IRREGULAR.get(canonical), cap);
  // -e → -n (feminine: die Grenze → die Grenzen; neuter: das Auge → die Augen)
  if (/e$/i.test(canonical) && canonical.length > 2) return capitalize(canonical + "n", cap);
  // -er, -el, -en → often invariant (no change, or umlaut for some masculines)
  //   der Lehrer → die Lehrer, das Fenster → die Fenster (same)
  //   der Vater → die Väter, der Apfel → die Äpfel (umlaut — in irregulars above)
  //   der Schüler → die Schüler (same), der Gärtner → die Gärtner (same)
  if (/(?:er|el|en)$/i.test(canonical) && canonical.length > 2) return capitalize(canonical, cap);
  // -ich, -ig, -ling, -nis → -e (der Teppich → die Teppiche)
  if (/(?:ich|ig|ling|nis)$/i.test(canonical)) return capitalize(canonical + "e", cap);
  // Many monosyllabic masculines: add -e (der Tag → die Tage)
  if (canonical.length <= 5 && !/[sxz]$/i.test(canonical) && /[bcdfghjklmnpqrstvwxz]$/i.test(canonical)) {
    return capitalize(canonical + "e", cap);
  }
  // Loanwords and internationalisms: add -s (das Auto → die Autos, das Hotel → die Hotels)
  if (/(?:o|i|y|ismus|tion|tät)$/i.test(canonical) || canonical.length <= 3) {
    return capitalize(canonical + "s", cap);
  }
  // Default: add -en (common for feminines and longer words)
  return capitalize(canonical + "en", cap);
}

function pluralizeFrench(canonical, cap) {
  if (FR_IRREGULAR.has(canonical)) return capitalize(FR_IRREGULAR.get(canonical), cap);
  // -al → -aux (but some take -als)
  if (/al$/i.test(canonical)) return capitalize(canonical.replace(/al$/, "aux"), cap);
  // -au, -eu → often -x (bateau→bateaux, but pneu→pneus)
  if (/(?:au|eu)$/i.test(canonical) && !/pneu$/i.test(canonical)) return capitalize(canonical + "x", cap);
  // -ou → most take -s, exceptions are in irregulars above
  // -s, -x, -z → invariant (same in plural)
  if (/[sxz]$/i.test(canonical)) return capitalize(canonical, cap);
  // Default: add -s
  return capitalize(canonical + "s", cap);
}

function pluralizeSpanish(canonical, cap) {
  if (ES_IRREGULAR.has(canonical)) return capitalize(ES_IRREGULAR.get(canonical), cap);
  // -z → -ces
  if (/z$/i.test(canonical)) return capitalize(canonical.replace(/z$/, "ces"), cap);
  // Stressed final vowel (á, é, í, ó, ú) → add -es
  if (/[áéíóú]$/i.test(canonical)) return capitalize(canonical + "es", cap);
  // Ends in consonant (not -s) → add -es
  if (/[^aeiouáéíóú\s]$/i.test(canonical) && !/s$/i.test(canonical)) return capitalize(canonical + "es", cap);
  // Ends in unstressed vowel or -s → add -s
  if (/[aeiouáéíóú]$/i.test(canonical) || /s$/i.test(canonical)) return capitalize(canonical + "s", cap);
  return capitalize(canonical + "s", cap);
}

function pluralizeJapanese(canonical, cap) {
  // Japanese has no plural inflection for most nouns. Return as-is.
  return capitalize(canonical, cap);
}

function pluralizeArabic(canonical, cap) {
  // Arabic broken plurals are highly irregular (patterns not productive).
  // Return as-is for unknown words; add ات (-āt) for feminine sound plural
  // as a best-effort guess.
  if (/ة$/i.test(canonical)) return capitalize(canonical.replace(/ة$/, "ات"), cap);
  return capitalize(canonical, cap); // return singular for broken plurals
}

// ── Pluralize dispatch ────────────────────────────────────────────────────

/**
 * Pluralize a noun according to the rules of the given language.
 *
 * @param {string} word - singular noun
 * @param {string} [lang="eng"] - ISO 639-3 language code
 * @param {object} [opts]
 * @param {Map<string,string>} [opts.priors] - prior irregular plural map from
 *   eoPriors.SEED_IRREGULAR_PLURAL. Merges with embedded fallback for fuller
 *   coverage (prior entries override embedded ones for the same key).
 * @returns {string} plural form
 */
export function pluralize(word, lang = "eng", opts = {}) {
  if (!word || typeof word !== "string") return word;
  const lower = word.trim();
  if (!lower) return word;
  const cap = /^[A-Z]/.test(lower);
  const canonical = lower.toLowerCase();
  const priors = opts && opts.priors instanceof Map ? opts.priors : null;

  switch (lang) {
    case "deu": return pluralizeGerman(canonical, cap);
    case "fra": return pluralizeFrench(canonical, cap);
    case "spa": return pluralizeSpanish(canonical, cap);
    case "jpn": return pluralizeJapanese(canonical, cap);
    case "ara": return pluralizeArabic(canonical, cap);
    default:   return pluralizeEnglish(canonical, cap, priors);
  }
}
