// A fresh, network-free PostgreSQL WASM instance. Never accepts a database URL.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const db = new PGlite({ extensions: { pgcrypto } });
let migrations=0, suites=0, assertions=0;
try {
  console.log((await db.query('SELECT version()')).rows[0].version);
  await db.exec(readFileSync('scripts/db-regression/bootstrap.sql', 'utf8'));
  for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql') && f >= '20260728140000').sort()) {
    try { await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8')); }
    catch (e) { throw new Error(`Migration ${file}: ${e.message}`); }
    console.log(`MIGRATION PASS: ${file}`);
    migrations++;
    if (file.endsWith('_zonyx_launch_baseline.sql')) {
      await db.exec(`INSERT INTO auth.users(id,email,raw_user_meta_data,created_at)
        SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
          CASE WHEN n=1 THEN 'zoeysnp@gmail.com' ELSE 'fixture-'||n||'@example.invalid' END,
          jsonb_build_object('full_name','Synthetic fixture '||n),
          '2026-01-01'::timestamptz + n * interval '1 day'
        FROM generate_series(1,6) n;
        UPDATE profiles SET is_admin=true,is_host=true WHERE email='zoeysnp@gmail.com';
        UPDATE profiles SET created_at=u.created_at FROM auth.users u WHERE u.id=profiles.user_id;`);
    }
    if (file.endsWith('_immutable_agreement_corrections_and_driver_integrity.sql')) {
      await db.exec(readFileSync('scripts/db-regression/fixtures.sql', 'utf8'));
    }
  }
  await db.exec('CREATE SCHEMA tap; SET search_path=tap,public,extensions');
  const tapSource=gunzipSync(readFileSync('scripts/db-regression/pgtap-1.3.4.sql.gz'));
  if (createHash('sha256').update(tapSource).digest('hex')!=='383ecd73edfd1c7ed5f3b835134ee1fe74e201ee31599346c92ea029b65dcdce') throw new Error('pgTAP source checksum mismatch');
  await db.exec(tapSource.toString().replace('__OS__','wasm').replace('__VERSION__','1.003004'));
  await db.exec('SET search_path=public,extensions,tap; GRANT USAGE ON SCHEMA tap TO anon,authenticated,service_role');
  let failed=0;
  for (const file of readdirSync('supabase/tests').filter(f => f.endsWith('.test.sql')).sort()) {
    await db.exec('BEGIN');
    try {
      const sql=readFileSync(`supabase/tests/${file}`,'utf8').replace(/^\s*(BEGIN|ROLLBACK);\s*$/gm,'');
      if (/SELECT (?:no_plan\(\)|plan\(\d+\));/.test(sql)) {
        const results=await db.exec(sql);
        for (const result of results) for (const row of result.rows) for (const output of Object.values(row)) {
          if (typeof output==='string' && /^(not )?ok \d+/.test(output)) {
            console.log(`${file}: ${output}`);
            assertions++;
            if (output.startsWith('not ok ')) failed++;
          }
        }
      } else {
        await db.query('SELECT plan(1)');
        const result=await db.query('SELECT lives_ok($1,$2) AS result',[sql,file]);
        const output=result.rows[0].result;
        assertions++;
        console.log(output.split('\n').slice(0,3).join('\n'));
        if (!output.startsWith('ok ')) failed++;
      }
      await db.exec('RESET ROLE');
      const finish=(await db.query('SELECT * FROM finish()')).rows;
      console.log(finish);
      if (finish.some(row=>String(row.finish).includes('Looks like'))) throw new Error('pgTAP finish failed');
      suites++;
    } catch(e) { console.log(`FAIL: ${file}: ${e.message}`); failed++; }
    finally { await db.exec('ROLLBACK'); }
  }
  if (failed) throw new Error(`${failed} SQL regression suites failed`);
  console.log(`PASS: ${migrations} migrations, ${suites} SQL suites, ${assertions} pgTAP assertions.`);
} finally { await db.close(); }
