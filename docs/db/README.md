# Database design

| File                  | What it is                                                       |
| --------------------- | ---------------------------------------------------------------- |
| `schema.sql`          | The design. Source of truth. Executed against PostgreSQL 16.     |
| `invariants.test.sql` | Proves each claimed constraint rejects what it claims to reject. |
| `../diagrams/er.*`    | Generated view of the relational model (17 entities).            |

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

**Nothing may cross a version boundary.** Every content and attempt row is
fenced to exactly one `test_version`. Most tables carry `test_version_id`
directly and reach their parent through a composite foreign key including it,
which pins the row to a single version. The five leaf tables carry no
`test_version_id` of their own and inherit the fence transitively instead.
Four of them — `choice`, `question_tag`, `section_instruction` and
`response_client_cursor` — have exactly one parent, itself already pinned, so
a `choice` cannot reach a second version because its only parent, `question`,
cannot; the leaf's own FK does not need to repeat the version column, and for
three of the four it is a plain single-column FK. `response_choice` is the
one leaf with two parents: `(attempt_id, question_id)` to `response` and
`(choice_id, question_id)` to `choice`. Both are composite and both include
`question_id`, so the answered question and the selected choice's question
are the same column value — the two paths cannot disagree. That second FK
pins a further invariant beyond version fencing: you cannot select a choice
belonging to a different question.

## What is deliberately outside the relational model

`failed_write` has no foreign keys and stores `raw_body` as `text`, not
`jsonb`. Its job is retaining request bodies that failed validation — including
ones that are not valid JSON and ones naming an attempt that does not exist.
It is the one table whose purpose is to accept garbage, so it is absent from
the ER diagram: drawing an edge would assert a link the schema intentionally
does not have.
