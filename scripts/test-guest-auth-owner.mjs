// Isolated PostgreSQL instance; never connects to a remote database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync('supabase/migrations/20261119022948_guest_reservation_checkout.sql', 'utf8');
const guard = migration.match(/DO \$\$\nBEGIN\n  IF NOT has_schema_privilege[\s\S]*?\nEND; \$\$;/)?.[0];
assert.ok(guard, 'Expected migration owner guard');
const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE candidate NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA auth TO candidate;
  `);
  await db.exec(guard);
  await db.exec('SET ROLE candidate');
  await assert.rejects(db.exec(guard), /Migration owner requires Auth table access and RLS bypass/);
  await db.exec('RESET ROLE; GRANT SELECT, UPDATE ON auth.users TO candidate; SET ROLE candidate');
  await assert.rejects(db.exec(guard), /Migration owner requires Auth table access and RLS bypass/);
  await db.exec('RESET ROLE; ALTER ROLE candidate BYPASSRLS; SET ROLE candidate');
  await db.exec(guard);
  console.log('PASS: migration owner guard rejects missing Auth privileges and missing RLS bypass, and accepts a qualified owner.');
} finally {
  await db.close();
}
