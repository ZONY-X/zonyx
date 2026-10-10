import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
function collect(folder) { return readdirSync(folder,{withFileTypes:true}).flatMap(entry => entry.isDirectory() ? collect(`${folder}/${entry.name}`) : /\.test\.(ts|mjs)$/.test(entry.name) ? [`${folder}/${entry.name}`] : []); }
const files=[...collect("src"),...collect("supabase/functions/_shared")].sort();
let failures=0;
for(const file of files) {
  const result=spawnSync(process.execPath,["--experimental-transform-types","--import","./scripts/register-test-loader.mjs",file],{encoding:"utf8"});
  console.log(`${result.status===0?"PASS":"FAIL"}: ${file}`);
  if(result.status!==0) { failures++; console.error(result.stdout,result.stderr); }
}
console.log(`${files.length} local unit-test files; ${failures} failures.`);
process.exitCode=failures?1:0;
