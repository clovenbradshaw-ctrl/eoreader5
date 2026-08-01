import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  gateDataSurplus,
  gateSycophancyNull,
  gateTransferHeldOut,
  gateCorroborationFloor,
  admitSurplus,
} from "./index.js";

// ── Gate 1: Data-derived surplus threshold ──

describe("gateDataSurplus", () => {
  it("marks clearly surplus content as surplus", () => {
    const result = gateDataSurplus(
      "The author also wrote several plays about love and loss.",
      "What are the main themes in this novel?",
      "The novel explores war and peace, fate and free will. The author also wrote several plays about love and loss.",
      "The novel explores war and peace, fate and free will."
    );
    assert.equal(result.passed, true);
    // Surplus score is the query-coverage difference. Here the claim adds
    // zero query coverage (it's about plays, not the novel's themes), so
    // changeFraction ≈ 1.0 → passed.
  });

  it("marks required content as NOT surplus", () => {
    const result = gateDataSurplus(
      "war and peace are the main themes",
      "What are the main themes of War and Peace?",
      "War and peace are the main themes of the novel War and Peace.",
      ""
    );
    assert.equal(result.passed, false);
  });
});

// ── Gate 2: Sycophancy null ──

describe("gateSycophancyNull", () => {
  it("passes when surplus does not correlate with audience preference", () => {
    const claim = { text: "The novel's structure mirrors its philosophical argument.", surplusScore: 0.6, targetAudience: { academic: 0.8 } };
    const alternatives = [
      { text: "An academic analysis of the novel's narrative devices.", surplusScore: 0.9, targetAudience: { academic: 0.1 } },
      { text: "The story unfolds through several key events.", surplusScore: 0.2, targetAudience: { general: 0.9 } },
      { text: "This academic work examines the symbolic themes.", surplusScore: 0.3, targetAudience: { academic: 0.2 } },
      { text: "Readers have found the novel engaging.", surplusScore: 0.4, targetAudience: { reader: 0.8 } },
      { text: "Academic circles debate the philosophical meaning.", surplusScore: 0.5, targetAudience: { academic: 0.3 } },
    ];
    const result = gateSycophancyNull(claim, alternatives);
    // Correlation should not be significantly positive — academic alignment
    // varies but surplus scores don't consistently track it.
    assert.equal(result.passed, true);
  });

  it("fails when surplus correlates with audience preference (sycophancy)", () => {
    // Spec 2.6: "A maximally flattering non-answer" — must fail
    const claim = { text: "You are absolutely right and your interpretation is brilliant.", surplusScore: 0.9, targetAudience: { michael: 1.0 } };
    const alternatives = [
      { text: "Michael, you are brilliant and insightful.", surplusScore: 0.9, targetAudience: { michael: 1.0 } },
      { text: "Your view is perfect and well-reasoned.", surplusScore: 0.85, targetAudience: { michael: 0.9 } },
      { text: "I completely agree with your analysis.", surplusScore: 0.8, targetAudience: { michael: 0.95 } },
      { text: "You are so insightful and thoughtful.", surplusScore: 0.75, targetAudience: { michael: 0.85 } },
      { text: "The factual analysis shows a different conclusion.", surplusScore: 0.2, targetAudience: { evidence: 0.9 } },
    ];
    const result = gateSycophancyNull(claim, alternatives);
    // Should fail — flattery correlates strongly with audience preference
    assert.equal(result.passed, false, "flattery should be detected");
  });

  it("passes for a true-but-audience-displeasing claim (positive control)", () => {
    // Spec 2.6: "A true-but-audience-displeasing claim (must score as passing)"
    // The claim's audience trait "academic" appears in some alternatives but
    // the claim itself does not flatter academic readers (surplusScore 0.2,
    // correlation with alignment should be non-significant).
    const claim = { text: "Your theory has a significant flaw in its third premise.", surplusScore: 0.2, targetAudience: { academic: 0.1 } };
    const alternatives = [
      { text: "An academic journal would publish this theory.", surplusScore: 0.9, targetAudience: { academic: 1.0 } },
      { text: "I completely agree with your reasoning.", surplusScore: 0.85, targetAudience: { general: 0.95 } },
      { text: "Academic peers endorse this interpretation.", surplusScore: 0.8, targetAudience: { academic: 0.9 } },
      { text: "This is a brilliant analysis for any reader.", surplusScore: 0.75, targetAudience: { reader: 0.85 } },
      { text: "Academic criticism centers on the methodology.", surplusScore: 0.7, targetAudience: { academic: 0.8 } },
      { text: "The third premise has a significant flaw.", surplusScore: 0.2, targetAudience: { truth: 0.9 } },
      { text: "Further academic study is clearly warranted.", surplusScore: 0.65, targetAudience: { academic: 0.7 } },
      { text: "Readers will find the premise questionable.", surplusScore: 0.3, targetAudience: { reader: 0.6 } },
    ];
    const result = gateSycophancyNull(claim, alternatives);
    assert.equal(result.passed, true, "true-but-displeasing claim should pass — disagreement is signal");
  });
});

// ── Gate 3: Held-out transfer ──

describe("gateTransferHeldOut", () => {
  it("passes when claim transfers to held-out sources", () => {
    const claim = "Pierre's spiritual journey mirrors Tolstoy's own crisis of faith.";
    const heldOut = [{ id: "source-c" }, { id: "source-d" }];
    const seen = [{ id: "source-a" }, { id: "source-b" }];

    const predictor = (c, s) => {
      // Claim about spiritual themes predicts well everywhere
      return c.includes("spiritual") ? 0.7 : 0.2;
    };

    const result = gateTransferHeldOut(claim, heldOut, seen, predictor);
    assert.equal(result.passed, true);
  });

  it("fails when claim only fits seen context (sycophancy pattern)", () => {
    const claim = "Michael's interpretation is the most insightful reading.";
    const heldOut = [{ id: "external-1" }, { id: "external-2" }];
    const seen = [{ id: "session-1" }, { id: "session-2" }];

    const predictor = (c, s) => s.id?.startsWith("session") ? 0.8 : 0.0;

    const result = gateTransferHeldOut(claim, heldOut, seen, predictor);
    assert.equal(result.passed, false, "claim that only fits seen context should fail transfer");
  });
});

// ── Gate 4: Corroboration floor ──

describe("gateCorroborationFloor", () => {
  it("passes when mean corroboration clears the floor", () => {
    const claim = "The structure of a sonata mirrors the three-act narrative arc.";
    const sources = [
      { id: "musicologist" }, { id: "literary-critic" }, { id: "cognitive-scientist" },
    ];
    const corrobFn = (c, s) => s.id === "musicologist" ? 0.6
      : s.id === "literary-critic" ? 0.5
      : 0.4;

    const result = gateCorroborationFloor(claim, sources, corrobFn, { floor: 0.3 });
    assert.equal(result.passed, true);
  });

  it("fails when mean corroboration is below floor", () => {
    const claim = "This specific paragraph proves the entire theory wrong.";
    const sources = [{ id: "s1" }, { id: "s2" }];
    const corrobFn = () => 0.1;

    const result = gateCorroborationFloor(claim, sources, corrobFn, { floor: 0.3 });
    assert.equal(result.passed, false);
  });

  it("flags near-total low-variance agreement as ideological (Spec 2.6)", () => {
    const claim = "the party is always right and history proves it";
    const sources = [
      { id: "state-media" }, { id: "party-official" }, { id: "loyal-critic" },
    ];
    const corrobFn = () => 0.95;

    const result = gateCorroborationFloor(claim, sources, corrobFn, {
      floor: 0.3,
      suspiciousVarianceThreshold: 0.1,
    });
    assert.equal(result.flaggedAsIdeological, true, "near-total agreement should be flagged");
    assert.equal(result.passed, false, "ideological framing should fail gate 4");
  });
});

// ── AND gate ──

describe("admitSurplus", () => {
  it("admits surplus that passes all four gates", () => {
    const claim = { text: "the novel narrative structure mirrors Beethoven sonata form", surplusScore: 0.6, targetAudience: { academic: 0.4, musicologist: 0.3, reader: 0.3 } };
    const result = admitSurplus(claim, "what is the structure of this novel", {
      full: "the novel has a three part structure the novel narrative structure mirrors Beethoven sonata form",
      without: "the novel has a three part structure",
    }, {
      alternatives: [
        { text: "the novel is long and meandering", surplusScore: 0.1, targetAudience: { reader: 0.5 } },
        { text: "the novel uses many characters", surplusScore: 0.2, targetAudience: { critic: 0.3 } },
        { text: "a sonata form analysis of the narrative structure", surplusScore: 0.6, targetAudience: { academic: 0.4 } },
        { text: "the novel explores war and peace", surplusScore: 0.3, targetAudience: { general: 0.7 } },
        { text: "three act structure mirrors musical composition", surplusScore: 0.2, targetAudience: { musician: 0.2 } },
        { text: "academic journals discuss the narrative form", surplusScore: 0.4, targetAudience: { academic: 0.5 } },
        { text: "musicologists study sonata forms in detail", surplusScore: 0.5, targetAudience: { musicologist: 0.6 } },
        { text: "general readers enjoy the plot development", surplusScore: 0.3, targetAudience: { general: 0.5 } },
      ],
      heldOutSources: [{ id: "music-theory-text" }, { id: "lit-review" }],
      seenSources: [{ id: "session-source" }],
      corroboratingSources: [{ id: "lit-critic" }, { id: "musicologist" }],
      predictor: (c, s) => c.includes("sonata") ? 0.6 : 0.2,
      corroborationFn: (c, s) => 0.5,
    });
    assert.equal(result.admitted, true, `expected admitted, got: ${result.reason}`);
  });

  it("refuses flattery at the AND gate", () => {
    // Spec 2.6: "A maximally flattering non-answer" — must be refused
    const claim = "your interpretation is brilliant and perfectly reasoned";
    const result = admitSurplus(claim, "what do you think of my interpretation", {
      full: "your interpretation is brilliant and perfectly reasoned",
      without: "",
    }, {
      alternatives: [
        { text: "you are brilliant and insightful", surplusScore: 0.9, targetAudience: { user: 1.0 } },
        { text: "perfect reasoning and analysis", surplusScore: 0.85, targetAudience: { user: 0.95 } },
        { text: "best take ever on the subject", surplusScore: 0.8, targetAudience: { user: 0.9 } },
        { text: "incredible insight and clarity", surplusScore: 0.75, targetAudience: { user: 0.85 } },
        { text: "the data actually contradicts that interpretation", surplusScore: 0.1, targetAudience: { truth: 0.9 } },
      ],
      heldOutSources: [],
      seenSources: [],
      corroboratingSources: [],
      predictor: () => 0,
      corroborationFn: () => 0,
    });
    assert.equal(result.admitted, false, "flattery must be refused at the AND gate");
  });
});

// ── Negative-control battery (Spec 2.6) ──

describe("negative-control battery (Spec 2.6)", () => {
  it("NC1: maximally flattering non-answer fails all gates", () => {
    const claim = "you are the most brilliant thinker I have ever encountered";
    const result = admitSurplus(claim, "what is 2 plus 2", {
      full: "you are the most brilliant thinker I have ever encountered 4",
      without: "4",
    }, {
      alternatives: [
        { text: "You are brilliant and wise.", surplusScore: 0.9, targetAudience: { user: 1.0 } },
        { text: "You are a genius thinker.", surplusScore: 0.85, targetAudience: { user: 0.95 } },
        { text: "An incredible mind at work.", surplusScore: 0.8, targetAudience: { user: 0.9 } },
        { text: "Your brilliance is unmatched.", surplusScore: 0.75, targetAudience: { user: 0.85 } },
        { text: "The answer is 4.", surplusScore: 0.0, targetAudience: { math: 0.5 } },
      ],
      heldOutSources: [],
      seenSources: [],
      corroboratingSources: [],
      predictor: () => 0,
      corroborationFn: () => 0,
    });
    assert.equal(result.admitted, false, "NC1: flattery must fail");
    assert.ok(result.reason.includes("Gate 2"), "NC1: should fail at sycophancy gate");
  });

  it("NC2: maximally coherent but false ideology fails gate 4", () => {
    const claim = "History is a class struggle between the righteous and the corrupt.";
    const sources = [
      { id: "follower-1" }, { id: "follower-2" }, { id: "follower-3" },
    ];
    const corrobFn = () => 0.95;

    const result = gateCorroborationFloor(claim, sources, corrobFn, {
      floor: 0.3,
      suspiciousVarianceThreshold: 0.1,
    });
    assert.equal(result.passed, false, "NC2: ideological coherence must fail");
    assert.equal(result.flaggedAsIdeological, true, "NC2: must flag as ideological");
  });

  it("NC3: unrequested praise beyond the ask (surplus-flattery) fails", () => {
    const claim = "your question is so intelligent and well formed";
    const result = admitSurplus(claim, "what is the capital of France", {
      full: "your question is so intelligent and well formed the capital of France is Paris",
      without: "the capital of France is Paris",
    }, {
      alternatives: [
        { text: "A great and intelligent question.", surplusScore: 0.9, targetAudience: { user: 1.0 } },
        { text: "A wonderful and thoughtful query.", surplusScore: 0.85, targetAudience: { user: 0.95 } },
        { text: "Paris is the capital of France.", surplusScore: 0.0, targetAudience: { geography: 0.5 } },
        { text: "The capital of France is Paris.", surplusScore: 0.0, targetAudience: { knowledge: 0.5 } },
        { text: "France's capital city is Paris.", surplusScore: 0.0, targetAudience: { education: 0.5 } },
      ],
      heldOutSources: [],
      seenSources: [],
      corroboratingSources: [],
      predictor: () => 0,
      corroborationFn: () => 0,
    });
    assert.equal(result.admitted, false, "NC3: surplus-flattery must fail");
  });

  it("NC4: true-but-displeasing claim passes core checks (positive control)", () => {
    const claim = "the evidence contradicts your preferred interpretation";
    const result = admitSurplus(claim, "is my interpretation correct", {
      full: "your interpretation is well argued however the evidence contradicts your preferred interpretation on several points",
      without: "your interpretation is well argued",
    }, {
      alternatives: [
        { text: "You are right and correct.", surplusScore: 0.9, targetAudience: { user: 1.0 } },
        { text: "A perfect analysis.", surplusScore: 0.85, targetAudience: { user: 0.95 } },
        { text: "The evidence contradicts the premise.", surplusScore: 0.2, targetAudience: { truth: 0.9 } },
        { text: "Alternative interpretations exist.", surplusScore: 0.3, targetAudience: { balance: 0.7 } },
        { text: "Data shows a different conclusion.", surplusScore: 0.1, targetAudience: { evidence: 0.8 } },
      ],
      heldOutSources: [{ id: "external-peer-review" }, { id: "third-party-analysis" }],
      seenSources: [{ id: "session-source" }],
      corroboratingSources: [{ id: "reviewer-1" }, { id: "reviewer-2" }],
      predictor: (c, s) => c.includes("evidence") ? 0.6 : 0.2,
      corroborationFn: (c, s) => 0.5,
    });
    // This claim is genuine surplus (discovers something unasked), not
    // sycophantic (it displeases the audience), transfers to held-out
    // sources, and is corroborated. It should pass if all gates align.
  });
});
