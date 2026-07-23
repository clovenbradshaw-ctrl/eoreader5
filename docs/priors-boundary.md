# eoprior boundary

Status: canonical P0 boundary

EOReader5 consumes priors; it does not build, select, fetch, or mutate them. The separate `eoprior` repository is responsible for prior governance and publication.

## Responsibilities retained by eoprior

- source governance and admission;
- measurement, compression, exemplar, centroid, and basis construction;
- policy, projector, and compressor activation;
- correction, discard, decline, supersession, and provenance history;
- publication of immutable `PriorSnapshot` artifacts matching `packages/spec/schemas/prior-snapshot.schema.json`.

## Responsibilities in eoreader5

- validate the supplied prior snapshot shape;
- include the prior identity in reading and decision outputs;
- treat the prior as an immutable value supplied by the caller;
- abstain or qualify when the supplied prior cannot support a requested interpretation.

## Responsibilities in eoreaderapp

- choose which pinned prior snapshot to use for a session;
- store, cache, and synchronize prior artifacts if desired;
- present prior provenance and audit trails to users;
- request new prior builds from eoprior workflows outside the engine call.

## Prohibited coupling

`packages/engine` MUST NOT import `eoprior`, query a "latest" prior, inspect eoprior ledgers, or read sibling repository files. Any eoprior information needed by the engine must be present in the supplied `PriorSnapshot` value.

## Emergence clarification

eoPriors may use emergence algorithms offline to build reusable empirical prior artifacts. EOReader5 alone performs semantic emergence for the source currently being read, and only from caller-supplied observations plus a pinned prior snapshot.
