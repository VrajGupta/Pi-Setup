# Planner handoff — PI-07 scope repair (2026-08-04)

Stage: planner. Mode: **human-authorized ticket-scope repair** after bounce 3/3 escalation.
Not a new feature plan. No application code, no new tickets, no redaction implementation, no Done.

## Human decision (supplied, not asked)

> Narrow PI-07's scope to exclude colon-delimited rootless opaque userinfo forms such as
> `sip:user:password@example.test`; do not attempt another redaction implementation now.

## Why the loop was not converging

PI-07's credential criterion was written as an absolute ("no credential of any syntax") and was being
enforced by an expanding syntax blacklist. Bounce 1 (`AWS_ACCESS_KEY_ID`), bounce 2 (`postgres://` `.env`
URLs), bounce 3 (`jdbc:oracle:thin:user/pw@host`), and the authorized recovery pass (`sip:user:pw@host`)
each closed one shape and revealed the next. The reviewer itself flagged non-convergence and asked for a
human choice: fail-closed structured boundary, or narrow the criterion. The human chose to narrow.

## The boundary as now written

**Supported (PI-07 guarantees redaction):**
1. Named credential assignments — `api_key`, `access_key`, `access_token`, `aws_access_key_id`,
   `authorization`, `cookie`, `credential`, `password`, `passwd`, `private_key`, `secret`, `token`,
   `*_url`, `*_uri`; quoted values with whitespace/escaped quotes; fails closed on malformed quoting.
2. `Authorization:`/`Cookie:` headers incl. RFC-folded continuations; `Bearer`/`Basic` tokens.
3. Recognized secret token formats — `sk-…`, `gh[pousr]_…`, JWT.
4. Hierarchical or slash-prefixed credential URIs — `scheme://user:pw@host`, `scheme:/…`,
   `jdbc:oracle:thin:user/pw@host:1521:app`, malformed one-slash variants; all `scheme://`/`scheme:/`
   URLs become `[URL]` (also satisfies INV-8's provider-base-URL rule).
5. Query-string credentials — `api_key=`, `access_token=`, `key=`, `secret=`, `token=`.

**Excluded (out of PI-07's guarantee and tests):** opaque/rootless URIs with colon-delimited userinfo,
no `//` root and no `/` separator — canonically `sip:user:password@example.test`, plus comparable
SIP/SIPS and colon-delimited JDBC userinfo variants. Reviewers must not bounce PI-07 for this form.

**INV-2 is not narrowed.** The residual gap is a documented, accepted risk recorded under INV-2 in
`docs/2026-08-04-flow-ui-and-token-savings.md`. The global security warning ("never paste raw `.env`
files, credential URIs, or provider secrets into prompts; redaction is defense in depth") is preserved
in the issue, the tracker, and the invariant doc. Closing the gap with a fail-closed structured boundary
would be a **new ticket**; none was created in this run.

## Made observable, not implicit

Two acceptance criteria were added so the exception cannot hide:
- a doc comment on `extensions/workflow/prompt-assembly.ts` naming supported forms and the excluded form;
- exactly one explicitly named scope test in `extensions/workflow/prompt-assembly.test.ts` documenting
  that the excluded form is not part of PI-07's guarantee.

Minimal production-seam set kept. Explicit "out of criteria": no speculative URI-dialect tests, no
SIP/rootless redaction behavior, no new redaction implementation.

## Verification-command — unchanged

`node --test --experimental-strip-types extensions/workflow/prompt-assembly.test.ts extensions/workflow/policy.test.ts && npm run check`

It already covers the amended criteria (criteria 5–7 live in `prompt-assembly.test.ts`; `tsc --noEmit`
runs via `npm run check`), so it was not amended.

## Project #12 Status writes (direct read-backs)

Item `PVTI_lAHOCFvJwM4BfV__zg1N89Y` (issue #9), field `PVTSSF_lAHOCFvJwM4BfV__zhZpjbc`:
- Before: `Reviewing` (human-escalated, bounce budget exhausted).
- Write 1 → `Planned` (option `f75ad846`). Read-back: #9 `Planned`, #11 `Agent Ready`, #2 `Done`.
- Write 2 → `Agent Ready` (option `61e4505c`). Read-back: #9 `Agent Ready`, #11 `Agent Ready`, #2 `Done`.

PI-09/#11 untouched. PI-06/#2 remains `Done`. PI-07 was not marked Done. PR #14 and all code untouched;
planner artifacts land on branch `planner/pi-07-scope-repair` so PR #14's diff is unchanged.

## Changed paths

- `tickets.md` — PI-07 entry rewritten (scope decision, boundary, amended criteria, bounce history,
  status `Agent Ready`); tracker header corrected to name Project #12 as the workflow authority.
- `docs/2026-08-04-flow-ui-and-token-savings.md` — INV-2 documented exception + preserved warning.
- `docs/handoffs/2026-08-04-planner-pi07-scope-repair.md` — this handoff.
- GitHub issue #9 — body amended; durable planner comment added.

## Next agent

`/coder` starts at **PI-07 / issue #9** (`Agent Ready`, blocker PI-06 Done). Work is small: add the
source doc comment and the one named scope test, then run the unchanged gate. Do not widen redaction.
Then **PI-09 / issue #11** (`Agent Ready`, independent) remains available.
