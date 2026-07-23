# eoreader4.2 compatibility boundary

Status: canonical P0 transfer route

Compatibility exists to complete the transfer from eoreader4.2 without making eoreader4.2 an engine dependency. Legacy launch, source custody, and UI context transfer belong in `eoreaderapp`; deterministic normalization of legacy semantic artifacts may live in `packages/compat-4.2`.

## Allowed in `packages/compat-4.2`

- validate a `Legacy42Envelope`;
- preserve original identifiers, operator names, timestamps, selectors, and payload hashes;
- normalize mapped legacy operators into the current operator epoch;
- hold unmapped records, especially `DES`, for human review;
- emit import artifacts that cite the original legacy envelope in provenance.

## Forbidden in `packages/compat-4.2`

- launching the legacy app;
- opening files, URLs, rooms, or databases;
- calling model, embedding, search, or render services;
- guessing semantic identity from legacy room, topic, folder, turn, or surface labels;
- silently rewriting legacy records in place.

## App-owned transfer work

The separate `eoreaderapp` repository should own the user-facing transfer workflow: locating eoreader4.2 data, collecting permissions, creating `Legacy42Envelope` artifacts, presenting held records for review, and invoking EOReader5 import functions.
