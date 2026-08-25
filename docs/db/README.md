# Database design

| File | What it is |
|---|---|
| `schema.sql` | The design. Source of truth. Executed against PostgreSQL 16. |
| `invariants.test.sql` | Proves each claimed constraint rejects what it claims to reject. |
| `../diagrams/er.*` | Generated view of the relational model (17 entities). |

## Running the checks

```bash
docker run -d --name pp-schema -e POSTGRES_PASSWORD=x -e POSTGRES_DB=pp -p 55432:5432 postgres:16-alpine
docker cp docs/db/schema.sql            pp-schema:/tmp/
docker cp docs/db/invariants.test.sql   pp-schema:/tmp/
docker exec pp-schema psql -U postgres -d pp -v ON_ERROR_STOP=1 -f /tmp/schema.sql
docker exec pp-schema psql -U postgres -d pp -f /tmp/invariants.test.sql
```

Every step labelled `MUST FAIL` should raise; every `MUST SUCCEED` should not.
The final query must return exactly three publication violations.

## Two ideas carry most of the design

**A published `test_version` is immutable.** Attempts pin a version, so editing
a test can never move a score already recorded. Enforced by triggers, not
convention — `docs/db/invariants.test.sql` proves an UPDATE on a published
question raises.

**Nothing may cross a version boundary.** Every content and attempt table
carries `test_version_id`, and every parent link is a COMPOSITE foreign key
including it. "An answer to a question from a different version of this test"
is unrepresentable rather than merely discouraged — a plain single-column FK
would accept one happily.

## What is deliberately outside the relational model

`failed_write` has no foreign keys and stores `raw_body` as `text`, not
`jsonb`. Its job is retaining request bodies that failed validation — including
ones that are not valid JSON and ones naming an attempt that does not exist.
It is the one table whose purpose is to accept garbage, so it is absent from
the ER diagram: drawing an edge would assert a link the schema intentionally
does not have.
