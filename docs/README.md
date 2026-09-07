# 📚 Documentation

- [`api/`](api/) — the OpenAPI contract (`openapi.yaml`) and a static HTML catalog rendered from it.
- [`architecture/`](architecture/) — design decisions and standing tradeoffs, including the
  library-adoption verdicts and preconditions carried into later plans.
- [`db/`](db/) — the schema (`schema.sql`, source of truth), the invariants test suite that
  proves each constraint actually rejects what it claims to, and the generated ER diagram
  under [`diagrams/`](diagrams/).
- [`prototype/`](prototype/) — a standalone HTML prototype of the test-runner UI.
- [`superpowers/specs/`](superpowers/specs/) and [`superpowers/plans/`](superpowers/plans/) —
  the fork's design spec and the ordered implementation plans that built it.

Back to the [main README](../README.md).
