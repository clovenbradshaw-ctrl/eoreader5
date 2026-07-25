// Quality assessment: inspect the actual kinds and parameters the pipeline
// produces for each media type, evaluating semantic correctness.
import { induceParameters, parameterProfiles, profileJaccard } from "./parameters/index.js";
import { induceEntityKinds, buildKindVocabulary } from "./entity-kinds/index.js";

function ent(id, name, attrs) {
  return { id, name, attributes: attrs.map(([f, v, c]) => ({ field_id: f, value_type: v, count: c ?? 1 })) };
}

function assess(label, entities, opts = {}) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`QUALITY ASSESSMENT: ${label}`);
  console.log(`Entities: ${entities.length}`);
  console.log('='.repeat(70));

  const params = induceParameters(entities, {
    population: `qa:${label}`,
    minPrevalence: opts.minPrevalence ?? 0.2,
    minEntityCount: opts.minEntityCount ?? 4,
    permutations: opts.permutations ?? 200,
    quantile: opts.quantile ?? 0.95,
  });

  console.log(`\nStandard parameters (population-wide):`);
  if (params.length === 0) {
    console.log('  (none — population too diverse or too few entities)');
  } else {
    for (const p of params) {
      console.log(`  ${p.external_name.padEnd(20)} prevalence: ${(p._prevalence*100).toFixed(0)}%  p=${p.null_comparison.p_value.toFixed(3)}  n=${p._entity_count}`);
    }
  }

  const kinds = induceEntityKinds(entities, {
    population: `qa:${label}`,
    minPrevalence: opts.minPrevalence ?? 0.2,
    cohesionThreshold: opts.cohesionThreshold ?? 0.2,
    minKindSize: opts.minKindSize ?? 2,
    permutations: opts.permutations ?? 200,
    quantile: opts.quantile ?? 0.95,
  });

  console.log(`\nInduced kinds (${kinds.length}):`);
  if (kinds.length === 0) {
    console.log('  (no kinds induced — entities may be too uniform or too diverse)');
    return { params, kinds };
  }

  for (const k of kinds) {
    console.log(`\n  ── ${k.label} ──`);
    console.log(`     Members: ${k.member_count}  Cohesion: ${k.cohesion.toFixed(3)}`);
    console.log(`     Cohesion null passed: ${k.cohesion_null.passed} (p=${k.cohesion_null.p_value.toFixed(3)})`);
    console.log(`     Members: ${k.member_entity_ids.join(', ')}`);
    console.log(`     Standard parameters (${k.standard_parameters.length}):`);
    for (const sp of k.standard_parameters) {
      const flag = sp.prevalence >= 0.8 ? ' ★' : '';
      console.log(`       ${sp.label.padEnd(20)} prevalence: ${(sp.prevalence*100).toFixed(0)}%${flag}`);
    }
    console.log(`     Distinguishing: ${k.distinguishing_parameters.length} params`);
    console.log(`     Description: ${k.description}`);
  }

  return { params, kinds };
}

// ─────────────────────────────────────────────────────────────────────────────
// NEWS: Politicians (6), Executives (4), NGOs (5)
// ─────────────────────────────────────────────────────────────────────────────
const POL = [["title","string"],["party","string"],["constituency","string"],["education","string"],["location","string"]];
const EXEC = [["title","string"],["organization","string"],["industry","string"],["revenue","number"],["stock_exchange","string"]];
const NGO = [["organization","string"],["location","string"],["founded","number"],["mission","string"],["website","string"]];
const newsEntities = [
  ent("sen1","Sen. Jane Smith", [...POL, ["military_service","string"]]),
  ent("rep1","Rep. John Doe", [...POL]),
  ent("gov1","Gov. Maria Garcia", [...POL]),
  ent("sen2","Sen. Robert Chen", [...POL, ["military_service","string"]]),
  ent("rep2","Rep. Sarah Johnson", [...POL]),
  ent("may1","Mayor David Brown", [...POL]),
  ent("ceo1","Alice Williams", [...EXEC, ["board_member","string"]]),
  ent("cto1","Bob Miller", [...EXEC]),
  ent("cfo1","Carol Davis", [...EXEC]),
  ent("ceo2","Dan Wilson", [...EXEC, ["board_member","string"]]),
  ent("ngo1","Red Cross", [...NGO]),
  ent("ngo2","Doctors Without Borders", [...NGO, ["ceo","string"]]),
  ent("ngo3","World Wildlife Fund", [...NGO]),
  ent("ngo4","Amnesty International", [...NGO]),
  ent("ngo5","Oxfam", [...NGO, ["ceo","string"]]),
];

assess("News (politicians + execs + NGOs)", newsEntities, { minPrevalence: 0.2, cohesionThreshold: 0.2, minKindSize: 2 });

// ─────────────────────────────────────────────────────────────────────────────
// NEWS HOMOGENEOUS (stress test): All entities are politicians with
// near-identical profiles — should produce one cohesive kind.
// ─────────────────────────────────────────────────────────────────────────────
const POL2 = [["title","string"],["party","string"],["constituency","string"],["location","string"]];
const homogeneousNews = [
  ent("h1","Sen. Alice", POL2), ent("h2","Sen. Bob", POL2),
  ent("h3","Rep. Carol", POL2), ent("h4","Rep. Dan", POL2),
  ent("h5","Gov. Eve", POL2), ent("h6","Mayor Frank", POL2),
];
assess("News homogeneous (all politicians)", homogeneousNews, { minPrevalence: 0.3, cohesionThreshold: 0.3 });

// ─────────────────────────────────────────────────────────────────────────────
// MUSIC: Composers (6), Performers (4), Works (5)
// ─────────────────────────────────────────────────────────────────────────────
const COMP = [["period","string"],["birth_year","number"],["death_year","number"],["nationality","string"]];
const PERF = [["type","string"],["genre","string"],["founded","number"]];
const WORK = [["composer","string"],["duration","number"],["year","number"],["catalog_number","string"]];
const musicEntities = [
  ent("moz","Wolfgang Amadeus Mozart", [...COMP, ["notable_works","string"]]),
  ent("bac","Johann Sebastian Bach", [...COMP]),
  ent("beet","Ludwig van Beethoven", [...COMP, ["notable_works","string"]]),
  ent("cho","Frédéric Chopin", [...COMP]),
  ent("tch","Pyotr Ilyich Tchaikovsky", [...COMP, ["notable_works","string"]]),
  ent("deb","Claude Debussy", [...COMP]),
  ent("cso","Czech National Symphony Orchestra", [...PERF, ["conductor","string"]]),
  ent("bpo","Berlin Philharmonic", [...PERF]),
  ent("vpo","Vienna Philharmonic", [...PERF]),
  ent("lso","London Symphony Orchestra", [...PERF, ["conductor","string"]]),
  ent("zau","Die Zauberflöte, K620", [...WORK, ["key","string"]]),
  ent("mag","The Magic Flute Overture", [...WORK]),
  ent("sym","Symphony No. 40, K550", [...WORK, ["key","string"]]),
  ent("ej","Eine kleine Nachtmusik, K525", [...WORK]),
  ent("req","Requiem, K626", [...WORK]),
];
assess("Music (composers + performers + works)", musicEntities, { minPrevalence: 0.2, cohesionThreshold: 0.2, minKindSize: 2 });

// ─────────────────────────────────────────────────────────────────────────────
// BOOKS: Authors (6), Characters (5), Publishers (4)
// ─────────────────────────────────────────────────────────────────────────────
const AUTH = [["genre","string"],["publisher","string"],["birth_year","number"],["nationality","string"]];
const CHAR = [["role","string"],["descriptor","string"],["relationship","string"]];
const PUB = [["location","string"],["founded","number"],["specialty","string"]];
const bookEntities = [
  ent("tol","J.R.R. Tolkien", [...AUTH, ["death_year","number"]]),
  ent("lew","C.S. Lewis", [...AUTH]),
  ent("aust","Jane Austen", [...AUTH, ["death_year","number"]]),
  ent("orw","George Orwell", [...AUTH]),
  ent("hem","Ernest Hemingway", [...AUTH]),
  ent("row","J.K. Rowling", [...AUTH]),
  ent("fro","Frodo Baggins", [...CHAR, ["alignment","string"]]),
  ent("sam","Samwise Gamgee", [...CHAR]),
  ent("gan","Gandalf", [...CHAR, ["alignment","string"]]),
  ent("ara","Aragorn", [...CHAR]),
  ent("gol","Gollum", [...CHAR]),
  ent("har","HarperCollins", [...PUB]),
  ent("pen","Penguin Books", [...PUB, ["ceo","string"]]),
  ent("ran","Random House", [...PUB]),
  ent("mac","Macmillan Publishers", [...PUB, ["ceo","string"]]),
];
assess("Books (authors + characters + publishers)", bookEntities, { minPrevalence: 0.2, cohesionThreshold: 0.2, minKindSize: 2 });

// ─────────────────────────────────────────────────────────────────────────────
// ACADEMIC: Authors (6), Papers (4), Institutions (5)
// ─────────────────────────────────────────────────────────────────────────────
const ACAUTH = [["field","string"],["affiliation","string"],["h_index","number"]];
const ACPAPER = [["venue","string"],["year","number"],["citations","number"]];
const ACINST = [["location","string"],["founded","number"],["type","string"]];
const academicEntities = [
  ent("p1","Dr. Alan Turing", [...ACAUTH, ["phd_year","number"]]),
  ent("p2","Dr. Grace Hopper", [...ACAUTH]),
  ent("p3","Dr. Donald Knuth", [...ACAUTH, ["phd_year","number"]]),
  ent("p4","Dr. Barbara Liskov", [...ACAUTH]),
  ent("p5","Dr. Edsger Dijkstra", [...ACAUTH]),
  ent("p6","Dr. Ada Lovelace", [...ACAUTH]),
  ent("pp1","Computing Machinery and Intelligence", [...ACPAPER, ["doi","string"]]),
  ent("pp2","Go To Statement Considered Harmful", [...ACPAPER]),
  ent("pp3","The Art of Computer Programming", [...ACPAPER, ["doi","string"]]),
  ent("pp4","Communications of the ACM", [...ACPAPER]),
  ent("inst1","University of Cambridge", [...ACINST, ["president","string"]]),
  ent("inst2","MIT", [...ACINST]),
  ent("inst3","Stanford University", [...ACINST]),
  ent("inst4","University of Oxford", [...ACINST, ["president","string"]]),
  ent("inst5","Caltech", [...ACINST]),
];
assess("Academic (authors + papers + institutions)", academicEntities, { minPrevalence: 0.2, cohesionThreshold: 0.2, minKindSize: 2 });

// ─────────────────────────────────────────────────────────────────────────────
// NOISY (stress test): 12 entities with mostly random attributes + a few
// coherent groups. Tests whether the pipeline resists over-fitting noise.
// ─────────────────────────────────────────────────────────────────────────────
const noisyEntities = [
  // 5 doctors sharing structured profile
  ent("dr1","Dr. Alice Heart", [["title","string"],["hospital","string"],["specialty","string"],["location","string"]]),
  ent("dr2","Dr. Bob Bone", [["title","string"],["hospital","string"],["specialty","string"],["location","string"]]),
  ent("dr3","Dr. Carol Care", [["title","string"],["hospital","string"],["specialty","string"],["location","string"],["education","string"]]),
  ent("dr4","Dr. Dan Diagnosis", [["title","string"],["hospital","string"],["specialty","string"],["location","string"]]),
  ent("dr5","Dr. Eve Emergency", [["title","string"],["hospital","string"],["specialty","string"],["location","string"]]),
  // 4 random noise entities with no shared profile
  ent("noise1","Random Entity A", [["color","string"],["height","number"]]),
  ent("noise2","Random Entity B", [["flavor","string"],["weight","number"]]),
  ent("noise3","Random Entity C", [["shape","string"],["age","number"]]),
  ent("noise4","Random Entity D", [["material","string"],["size","number"]]),
  // 3 more doctors to ensure robustness
  ent("dr6","Dr. Frank Fever", [["title","string"],["hospital","string"],["specialty","string"],["location","string"],["awards","string"]]),
  ent("dr7","Dr. Grace Germ", [["title","string"],["hospital","string"],["specialty","string"],["location","string"]]),
  ent("dr8","Dr. Henry Heal", [["title","string"],["hospital","string"],["specialty","string"],["location","string"]]),
];
assess("Noisy (doctors + random entities)", noisyEntities, { minPrevalence: 0.15, cohesionThreshold: 0.25, minKindSize: 3 });

// ─────────────────────────────────────────────────────────────────────────────
// FLAC AUDIO CROSS-CHECK: simulate what the app produces from the real FLAC
// file's Wikimedia page. The app records obs[] as boolean attribute-presence
// flags, then clusters by shared obs profiles.
// ─────────────────────────────────────────────────────────────────────────────
const FLAC_PAGE = {
  "Wolfgang Amadeus Mozart":       ["title","date","location_cooccurrence","org_affiliation"],
  "Czech National Symphony Orchestra": ["org_affiliation","date","location_cooccurrence"],
  "Magic Flute Overture":          ["title","date"],
  "Musopen Kickstarter Project":   ["org_affiliation","date","url"],
};
const flacEntities = Object.entries(FLAC_PAGE).map(([name, obs], i) => ({
  id: `flac${i}`,
  name,
  attributes: obs.map(a => ({ field_id: a, value_type: "string", count: 1 })),
}));
// Expand with synthetic audio corpus for meaningful clustering
const expandedFlac = [
  ...flacEntities,
  ...musicEntities,
];
assess("FLAC Audio + Music Corpus (expanded)", expandedFlac, { minPrevalence: 0.15, cohesionThreshold: 0.18, minKindSize: 2 });

// ─────────────────────────────────────────────────────────────────────────────
// VOCABULARY QUALITY: check that buildKindVocabulary produces clean output
// ─────────────────────────────────────────────────────────────────────────────
const vocabKinds = induceEntityKinds(expandedFlac, {
  population: "qa:vocab-flac", minPrevalence: 0.15,
  cohesionThreshold: 0.18, minKindSize: 2, permutations: 200,
});
const vocab = buildKindVocabulary(vocabKinds, { population: "qa:vocab-flac" });
console.log(`\n${'='.repeat(70)}`);
console.log(`VOCABULARY QUALITY: ${vocab.kinds.length} kinds in vocabulary`);
console.log('='.repeat(70));
for (const kd of vocab.kinds) {
  console.log(`  ${kd.label}`);
  console.log(`    Cohesion: ${kd.cohesion.toFixed(3)}`);
  console.log(`    Required params: ${kd.standard_parameters.filter(p => p.required).map(p => p.label).join(', ') || '(none)'}`);
  console.log(`    Optional params: ${kd.standard_parameters.filter(p => !p.required).map(p => p.label).join(', ') || '(none)'}`);
  console.log(`    Distinguishing: ${kd.distinguishing_parameters.length} unique to this kind`);
}
