/**
 * natasha-rostova.js — Golden EOT packet for Natasha Rostova
 *
 * This is the ground truth. Every field carries provenance back to
 * exact source locations in War and Peace (the primary source).
 * Analytical claims (arc phases, mirror readings, essay angles)
 * originate from the critical analysis layer but reference W&P scenes.
 *
 * Primary source: War and Peace, Aylmer Maude translation (Gutenberg #2600)
 * Analytical source: Storgy character analysis (natasha.txt, 149 lines)
 * Entity: Natasha Rostova
 */

function wp(line, span) {
  return { source: "wp", line, span };
}

function wpAnalysis(wpRef, storgyLine, storgySpan) {
  return { source: "wp", line: wpRef.line, span: wpRef.span, analysis: { source: "storgy", line: storgyLine, span: storgySpan } };
}

const natashaRostova = {
  scope: "entity",
  entity: "Natasha Rostova",
  work: "War and Peace",
  author: "Leo Tolstoy",

  // ── Properties ──
  // Factual: from W&P text. Analytical: from Storgy interpretation of W&P.
  properties: [
    {
      label: "Natasha Rostova",
      value: "emotional and moral center of War and Peace",
      provenance: { source: "storgy", line: 16, span: [23, 49], note: "analytical claim — Storgy's characterization" },
    },
    {
      label: "Natasha Rostova",
      value: "introduced as an exuberant thirteen-year-old",
      provenance: wp(2742, [1, 80]),
    },
    {
      label: "Natasha Rostova",
      value: "pure, unmediated life itself",
      provenance: { source: "storgy", line: 37, span: [82, 110], note: "analytical claim — Storgy's characterization" },
    },
    {
      label: "Natasha Rostova",
      value: "impulsive, warm, incapable of sustained pretense",
      provenance: { source: "storgy", line: 37, span: [247, 289], note: "analytical claim — Storgy's characterization" },
    },
    {
      label: "Natasha Rostova",
      value: "a Rostov through and through",
      provenance: { source: "storgy", line: 37, span: [221, 247], note: "analytical claim — Storgy's characterization" },
    },
    {
      label: "Natasha Rostova",
      value: "measured not by intelligence or social accomplishment but by vitality and moral feeling",
      provenance: { source: "storgy", line: 37, span: [158, 220], note: "analytical claim — Storgy's characterization" },
    },
    {
      label: "Natasha Rostova",
      value: "tends to feel her way there instinctively",
      provenance: { source: "storgy", line: 37, span: [378, 418], note: "analytical claim — Storgy's characterization" },
    },
    {
      label: "Natasha Rostova",
      value: "the most vulnerable and the most resilient character in the book",
      provenance: { source: "storgy", line: 37, span: [449, 510], note: "analytical claim — Storgy's characterization" },
    },
    {
      label: "Natasha Rostova",
      value: "an unbroken connection to what he regards as authentic human experience",
      provenance: { source: "storgy", line: 37, span: [602, 671], note: "analytical claim — Storgy's characterization" },
    },
    {
      label: "Natasha Rostova",
      value: "passionate intensity, moral strength, and a deep connection to life",
      provenance: { source: "storgy", line: 18, span: [436, 504], note: "analytical claim — Storgy's characterization" },
    },
  ],

  // ── Character Arc ──
  // The arc phases are Storgy's analytical reading of W&P.
  // Each phase references the W&P scenes that evidence it.
  characterArc: [
    {
      phase: "joy",
      description: "all forward motion—eager for love, for dancing, for life to begin",
      evidence: [
        { scene: "first ball", wp: wp(25556, [1, 60]) },
        { scene: "folk dance at Uncle's", wp: wp(28400, [1, 75]) },
      ],
      provenance: { source: "storgy", line: 43, span: [107, 168] },
    },
    {
      phase: "error",
      description: "Left alone in Moscow and starved of feeling, she becomes susceptible to Anatole Kuragin's manufactured intensity, agreeing to an elopement that nearly destroys everything she has",
      evidence: [
        { scene: "Anatole elopement", wp: wp(32235, [1, 20]) },
      ],
      provenance: { source: "storgy", line: 43, span: [257, 387] },
    },
    {
      phase: "error_note",
      description: "Her motivation throughout is not selfishness but a desperate need for emotional fullness",
      provenance: { source: "storgy", line: 43, span: [388, 458] },
    },
    {
      phase: "suffering",
      description: "The scandal that follows strips her of social confidence and health, initiating her real moral education",
      evidence: [
        { scene: "nursing Andrei", wp: wp(53042, [1, 67]) },
        { scene: "commandeering carts", wp: wp(47136, [1, 40]) },
      ],
      provenance: { source: "storgy", line: 43, span: [459, 540] },
    },
    {
      phase: "suffering_note",
      description: "Her path to redemption begins through suffering",
      provenance: { source: "storgy", line: 18, span: [1, 43] },
    },
    {
      phase: "regeneration",
      description: "commanding the Rostov household to unload their carts for wounded soldiers, nursing the dying Andrei with selfless tenderness, she finds a purpose that transcends romantic longing",
      evidence: [
        { scene: "commandeering carts", wp: wp(47136, [1, 40]) },
        { scene: "nursing Andrei", wp: wp(53042, [1, 67]) },
        { scene: "epilogue marriage", wp: wp(62440, [1, 40]) },
      ],
      provenance: { source: "storgy", line: 43, span: [541, 678] },
    },
    {
      phase: "regeneration_note",
      description: "she has channeled her passionate intensity into marriage with Pierre and motherhood—a transformation Tolstoy presents not as diminishment but as the most complete expression of who she always was",
      provenance: { source: "storgy", line: 43, span: [679, 818] },
    },
    {
      phase: "arc_summary",
      description: "joy, catastrophic error, suffering, and quiet regeneration",
      provenance: { source: "storgy", line: 43, span: [39, 95] },
    },
  ],

  // ── Key Moments ──
  // Each moment has a W&P source (the actual scene) and a Storgy analysis.
  keyMoments: [
    {
      scene: "The first ball",
      source_ref: "Volume II",
      wp: wp(25556, [1, 60]),
      text: "Natasha's debut at the grand ball, where she dances with Andrei, is her most iconic scene. Her unselfconscious joy—the detail that she does not know what to do with her arms—is precisely what disarms the war-weary prince.",
      analysis: "It establishes her as a force of nature rather than a social performer.",
      significance: "establishes her as a force of nature",
      arc: "joy",
      provenance: { source: "storgy", line: 49, span: [2, 325] },
    },
    {
      scene: "The hunting and folk-dancing at Uncle's estate",
      wp: wp(28400, [1, 75]),
      text: "When Natasha dances the Russian folk dance with instinctive grace despite her aristocratic upbringing, Tolstoy makes his most explicit claim about her: she is connected to something primal and national that transcends class.",
      analysis: "Nikolai's astonishment underscores how extraordinary the moment is.",
      significance: "connected to something primal and national that transcends class",
      arc: "joy",
      provenance: { source: "storgy", line: 50, span: [2, 321] },
    },
    {
      scene: "The Anatole elopement scheme",
      wp: wp(32235, [1, 20]),
      text: "Discovered by Sonya before it can be executed, this crisis reveals the dangerous underside of Natasha's emotional hunger.",
      analysis: "It is her lowest point and the hinge on which her entire development turns.",
      significance: "hinge on which her entire development turns",
      arc: "error",
      provenance: { source: "storgy", line: 51, span: [2, 234] },
    },
    {
      scene: "Nursing Andrei in his final days",
      wp: wp(53042, [1, 67]),
      text: "Natasha's quiet, devoted care of the dying Andrei—their wordless reconciliation, her silent presence—represents her emotional maturity fully arrived.",
      analysis: "The tenderness here is earned by everything she has suffered.",
      significance: "emotional maturity fully arrived",
      arc: "suffering",
      provenance: { source: "storgy", line: 52, span: [2, 257] },
    },
    {
      scene: "Commandeering the carts during Moscow's evacuation",
      wp: wp(47136, [1, 40]),
      text: "An almost wordless act of practical moral authority, this scene shows that Natasha's transformation is not merely internal; it has real consequences in the world.",
      significance: "transformation has real consequences in the world",
      arc: "suffering",
      provenance: { source: "storgy", line: 53, span: [2, 225] },
    },
  ],

  // ── Relationships as Mirrors ──
  // Each relationship: W&P scene + Storgy analytical reading.
  relationships: [
    {
      entity: "Pierre Bezukhov",
      mirror: "reflects her truest self back to her without judgment",
      analysis:
        "His unconditional regard during her disgrace after the Anatole scandal is what eventually makes him the right partner. " +
        "Their epilogue marriage, grounded in mutual respect rather than romantic fever, is Tolstoy's model for a good life.",
      function: "truest spiritual counterpart",
      wp: wp(62440, [1, 40]),
      provenance: { source: "storgy", line: 59, span: [120, 321] },
    },
    {
      entity: "Andrei Bolkonsky",
      mirror: "loves Natasha for her joy but cannot survive contact with her imperfection",
      analysis:
        "His proud, exacting nature makes their engagement a collision between the ideal and the real. " +
        "Their deathbed reconciliation is the novel's most emotionally complex scene precisely because forgiveness arrives too late for anything but grace.",
      function: "collision between ideal and real",
      wp: wp(25556, [1, 60]),
      provenance: { source: "storgy", line: 59, span: [322, 510] },
    },
    {
      entity: "Anatole Kuragin",
      mirror: "the shadow version of romantic feeling—all surface intensity, no moral substance",
      analysis:
        "Exploits her loneliness. " +
        "Functions as a trial by fire that ultimately deepens her character, though it costs her the engagement and nearly her health.",
      function: "shadow of romantic feeling",
      wp: wp(32235, [1, 20]),
      provenance: { source: "storgy", line: 59, span: [511, 598] },
    },
    {
      entity: "Sonya Rostova",
      mirror: "saves Natasha at the cost of their easy friendship",
      analysis:
        "Tolstoy contrasts their fates in the epilogue to distinguish passionate vitality from quiet self-sacrifice.",
      function: "foil and savior",
      wp: wp(32207, [1, 20]),
      provenance: { source: "storgy", line: 59, span: [599, 722] },
    },
    {
      entity: "Princess Mary Bolkonskaya",
      mirror: "closest female friend, bond forged in shared grief",
      analysis:
        "Together they represent complementary paths—spiritual duty and earthly vitality—toward a good life, " +
        "and his suggestion that they are ultimately complementary.",
      function: "complementary path",
      wp: wp(53042, [1, 67]),
      provenance: { source: "storgy", line: 59, span: [723, 860] },
    },
    {
      entity: "Hélène Kuragina",
      mirror: "Natasha's dark mirror: beautiful, socially brilliant, but hollow and predatory",
      analysis:
        "Tolstoy sets the two women in implicit contrast throughout—Natasha's beauty animated by genuine feeling versus Hélène's cold, marble perfection—to distinguish authentic life from its corrupt imitation.",
      function: "dark mirror",
      wp: wp(25571, [1, 15]),
      provenance: { source: "storgy", line: 78, span: [0, 285] },
    },
  ],

  // ── Groups ──
  groups: {
    settled: [
      "Natasha is the emotional and moral center of War and Peace",
      "She is impulsive, warm, incapable of sustained pretense",
      "Her arc follows joy → error → suffering → regeneration",
      "She marries Pierre and becomes a devoted mother",
    ],
    heldOpen: [
      "The epilogue as fulfilment or diminishment—critics debate whether domestic Natasha represents growth or suppression of her spirit",
      "Whether her transformation is the ultimate expression of her character or a loss of her earlier vitality",
    ],
    turns: [
      "The Anatole elopement scheme—hinge of her development",
      "Nursing Andrei—emotional maturity fully arrived",
      "Commandeering carts—transformation has real consequences",
    ],
  },

  // ── Essay Angles ──
  // Storgy's analytical questions, each referencing W&P scenes.
  essayAngles: [
    {
      title: "Natasha as Tolstoy's argument against Romanticism",
      question: "How does the Anatole episode function as a critique of the romantic ideal of passionate love, and what does Natasha's eventual happiness with the unheroic Pierre suggest about Tolstoy's values?",
      wp: wp(32235, [1, 20]),
      provenance: { source: "storgy", line: 80, span: [3, 203] },
    },
    {
      title: "Female vitality and national identity",
      question: "Examine the folk-dancing scene at Uncle's estate alongside the Moscow evacuation. What does Natasha's instinctive connection to Russian folk culture reveal about Tolstoy's conception of authentic national feeling?",
      wp: wp(28400, [1, 75]),
      provenance: { source: "storgy", line: 81, span: [3, 208] },
    },
    {
      title: "The epilogue as fulfilment or diminishment",
      question: 'Critics have debated whether the domestic Natasha of the epilogue represents growth or the suppression of her spirit. Build a thesis defending or challenging Tolstoy\'s framing of marriage and motherhood as her "true" identity.',
      wp: wp(62440, [1, 40]),
      provenance: { source: "storgy", line: 82, span: [3, 201] },
    },
    {
      title: "Natasha and Pierre as moral counterparts",
      question: "Compare the spiritual crises of Natasha (the Anatole scandal) and Pierre (his disillusionment with Freemasonry and Napoleon). How does Tolstoy use their parallel journeys to suggest that moral regeneration requires suffering rather than philosophy?",
      wp: wp(32235, [1, 20]),
      provenance: { source: "storgy", line: 83, span: [3, 215] },
    },
    {
      title: "The function of contrast: Natasha versus Hélène Kuragina",
      question: "Tolstoy sets Natasha's beauty—animated by genuine feeling—against Hélène's cold, marble perfection. Analyze this contrast as a structuring device through which Tolstoy distinguishes authentic life from its corrupt imitation.",
      wp: wp(25571, [1, 15]),
      provenance: { source: "storgy", line: 84, span: [3, 211] },
    },
  ],

  // ── Connected Characters ──
  // Storgy's character descriptions, each referencing W&P scenes.
  connectedCharacters: [
    {
      name: "Pierre Bezukhov",
      description:
        "Pierre is Natasha's truest spiritual counterpart. He defends her honor after the Anatole scandal when others condemn her, and his quiet, unconditional regard is the emotional anchor she needs. During the Moscow occupation he risks his life partly out of devotion to her. In the epilogue they marry, and their partnership—grounded in mutual respect and shared moral seriousness—represents Tolstoy's ideal of domestic happiness.",
      wp: wp(62440, [1, 40]),
      provenance: { source: "storgy", line: 66, span: [0, 407] },
    },
    {
      name: "Prince Andrei Bolkonsky",
      description:
        "Andrei falls in love with Natasha at her first grand ball, enchanted by her unselfconscious joy. Their engagement is the novel's great romantic set-piece, but his proud, exacting nature cannot survive her betrayal with Anatole. He withdraws his forgiveness until he lies dying, when Natasha nurses him with selfless tenderness; their reconciliation, achieved only at the threshold of his death, is one of the novel's most emotionally complex scenes.",
      wp: wp(25556, [1, 60]),
      provenance: { source: "storgy", line: 68, span: [0, 390] },
    },
    {
      name: "Anatole Kuragin",
      description:
        "Anatole is the agent of Natasha's gravest moral crisis. His calculated seduction—secret letters, a staged elopement—exploits her loneliness and romantic hunger during Andrei's absence. She nearly destroys her life for him before the plot is exposed. The episode functions as a trial by fire that ultimately deepens her character, though it costs her the engagement and nearly her health.",
      wp: wp(32235, [1, 20]),
      provenance: { source: "storgy", line: 70, span: [0, 340] },
    },
    {
      name: "Sonya Rostova",
      description:
        "Sonya is Natasha's cousin, confidante, and foil. She intercepts Natasha's elopement letter and alerts the family, an act of loyalty that saves Natasha even as it wounds her. Their friendship is warm but asymmetrical: Natasha's passionate nature always overshadows Sonya's quieter self-sacrifice, and Tolstoy subtly contrasts their fates in the epilogue.",
      wp: wp(32207, [1, 20]),
      provenance: { source: "storgy", line: 72, span: [0, 329] },
    },
    {
      name: "Nikolai Rostov",
      description:
        "Nikolai is Natasha's beloved older brother. Their bond is shown in shared childhood exuberance—most memorably in the hunting and folk-dancing scenes at Uncle's estate—and in Nikolai's protective fury when he learns of Anatole's scheme. He embodies the Rostov family warmth that shapes Natasha's fundamental optimism.",
      wp: wp(28359, [1, 70]),
      provenance: { source: "storgy", line: 74, span: [0, 296] },
    },
    {
      name: "Princess Mary Bolkonskaya",
      description:
        "Initially a rival figure (as Andrei's sister and moral guardian), Princess Mary becomes Natasha's closest female friend in the epilogue. Their bond is cemented by shared grief over Andrei's death and deepened by Mary's marriage to Nikolai, making the two women sisters-in-law. Together they represent complementary paths—spiritual duty and earthly vitality—toward a good life.",
      wp: wp(53042, [1, 67]),
      provenance: { source: "storgy", line: 76, span: [0, 356] },
    },
    {
      name: "Hélène Kuragina",
      description:
        "Hélène is Natasha's dark mirror: beautiful, socially brilliant, but hollow and predatory. It is partly through Hélène's salon that Anatole gains access to Natasha. Tolstoy sets the two women in implicit contrast throughout—Natasha's beauty animated by genuine feeling versus Hélène's cold, marble perfection—to distinguish authentic life from its corrupt imitation.",
      wp: wp(25571, [1, 15]),
      provenance: { source: "storgy", line: 78, span: [0, 285] },
    },
  ],

  // ── Provenance metadata ──
  provenance: {
    primarySource: "wp",
    primaryFile: "pg2600.txt",
    primaryEdition: "Aylmer & Louise Maude translation, Gutenberg #2600",
    analyticalSource: "storgy",
    analyticalFile: "natasha.txt",
    analyticalLines: 149,
    entity: "Natasha Rostova",
    work: "War and Peace",
    author: "Leo Tolstoy",
    note: "Factual claims traced to W&P line numbers. Analytical claims (arc, mirrors, angles) traced to Storgy with W&P scene references.",
  },
};

export default natashaRostova;
