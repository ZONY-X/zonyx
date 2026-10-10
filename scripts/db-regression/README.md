# Isolated schema regression

Run `npm ci --ignore-scripts && npm run test:schema` with Node 24.

The runner creates a fresh in-memory PostgreSQL 18.3 instance using the locked
PGlite 0.5.8 dependency. It accepts no database URL, loads no environment file,
opens no database connection, and makes no network requests. It contains no
provider clients or credentials. All identity IDs and rental evidence are
synthetic. The owner email and driver labels are fixed literals required by
existing repository authorization rules/tests, not exported production rows.

It replays all 43 SQL files starting with the explicit
`20260728140000_zonyx_launch_baseline.sql`, including both PayPal migrations,
without changing their SQL in the runner. Historical pre-launch files are not
a complete bootstrap: they reference vehicles/hosts/bookings never created in
that history, and the launch baseline replaces those tables. This runner tests
the full current launch schema, not the retired pre-launch architecture.

Local auth/storage primitives supply the schemas, roles, auth.uid/auth.role,
storage folder helpers and grants consumed by the application. PostgreSQL
enforces actual constraints, triggers, function ACLs and RLS. These primitives
are test fixtures, not a full GoTrue/Storage/PostgREST service installation.
Native Supabase PostgreSQL-version compatibility and HTTP/Edge Function
integration are separate checks; no sandbox payment acceptance is implied.

Every SQL test runs in its own BEGIN/ROLLBACK transaction. Legacy SQL assertion
suites run through pgTAP lives_ok; the PayPal suite runs individual pgTAP
assertions. Any SQL exception, failed assertion or failed finish causes a
nonzero exit. No tests are skipped. Accepted agreement fixtures are inserted
before the revision-bootstrap migration, with hashes calculated from their
actual bytes. The historical correction migration skips only an absent target;
its approved-source hash validation remains unchanged when the target exists.

pgTAP 1.3.4 is bundled as deterministic gzip of the unmodified upstream SQL
template for offline execution, with the upstream license in PGTAP-LICENSE.
Source: https://github.com/theory/pgtap/blob/968eb53a33114e83042b3bdb0c664b5b80cf8bdf/sql/pgtap.sql.in
Uncompressed SHA-256: `383ecd73edfd1c7ed5f3b835134ee1fe74e201ee31599346c92ea029b65dcdce`.
The runner verifies that digest, then substitutes upstream build placeholders
for OS and numeric version. No upstream test functions are rewritten.
