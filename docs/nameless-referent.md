# The Nameless Referent

**Identity lives in the referent, never in a string.** A surface ("Natásha",
"the monster", "I") is scoped evidence *pointing at* a referent. Merging is a
decision about what two surfaces point at — never about what two strings look
like. This is a foundational principle of the engine; every regression we have
had in coreference came from forgetting it.

## The principle, operationally

1. **The referent is the unit.** Presence, relations, figures, and folds attach
   to a referent id. Surfaces are admitted *to* it by explicit lifecycle events
   (`DEF.admit`, `SYN.merge`) and projected through
   `referents/projectReferents` — event-sourced, auditable, reversible.
   Never a mutable lookup keyed by surface string.

2. **Same-string surfaces MUST NOT auto-merge** (`referents/index.js`). "I" is
   Walton, Victor, and the Creature in one book. "The wretch" is sometimes
   Victor. One string, several referents — disambiguated by **scope**
   (character-offset spans, stored as durable anchor quotes), not by the
   string.

3. **The name path is the special case, not the model.** Structural name
   coreference (containment, shared surname — `namesCorefer`) is
   TIER.RESOLVED and only works for *holons*: named, name-admitted referents.
   `individuation.js` names the other types precisely so we don't pretend
   everything is a holon:
   - **emanon** — high mass, agentive, never name-admitted (the Creature)
   - **protogon** — orbited but absent (Kurtz)
   - first-person narrators refer to themselves as "I" for whole spans

4. **Descriptor coreference is witness-channel knowledge.** Deciding that
   monster/wretch/fiend/dæmon predicate one being is `pronoun-semantic` class:
   `resolution-spectrum.js` TIER.MODEL, `needsWitness === true`. The engine
   must not derive it — it must be **injected as a per-text coref prior**
   (eoPriors `priors/coref/*.json`), per the reader-priors discipline: *"the
   prior is INJECTED... the engine never computes it."* When the prior is
   absent, emit a typed **gap** — never a silently wrong number.

## Failed derivations — do not retry

Both attempts are preserved in `perceiver/text/presence.js` headers with their
measured failures:

- **Frame-level distributional lift** admitted "the room", "the guitar", and
  "sonya" as Natasha (3069/3228 frames "present"). Anything sharing a
  referent's scenes lifts identically. *Association is not identity.*
- **Sentence-level complementary distribution** (aliases substitute, so should
  anti-co-occur): "monster" and "room" both scored 0 against "creature" — 44
  seed sentences in 3361 is noise. No separation between alias and associate.

These are not tuning failures. They are the tier boundary asserting itself.

## Why flat alias lists also regress

An ad-hoc `aliases: ["the monster", ...]` option is still string-thinking: no
scope (counts "my enemy" inside the Creature's own tale, where it points at
someone else), no audit trail, no durability (a hand-typed list wrote "daemon";
the text says **"dæmon"** — 20 occurrences, ligature, zero matches). The
curated per-text prior caught that in one pass. Priors of a given text are how
coref knowledge persists and improves instead of being re-guessed per session.

## Where the machinery lives

| concern | module |
|---|---|
| event-sourced identity, no auto-merge | `packages/engine/referents/index.js` |
| referent typing (holon/emanon/protogon…) | `packages/engine/referents/individuation.js` |
| tier taxonomy for coref decisions | `packages/engine/resolution/resolution-spectrum.js` |
| scoped, weighted, prior-driven presence | `packages/engine/perceiver/text/presence.js` |
| per-text coref priors (injected) | `eoPriors/priors/coref/*.json` |
| consumption in the fold | `emergence/summary/entity-fold.js` (`referent` option) |

Enforced by `packages/engine/perceiver/text/presence.test.js` — if a change
makes those tests fail, it is probably re-deriving identity from strings.
