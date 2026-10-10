import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
// Pure local tests must never accidentally contact a production service.
globalThis.fetch = async () => { throw new Error("Network access is disabled in local unit tests."); };
registerHooks({ resolve(specifier, context, nextResolve) {
  let base;
  if (specifier.startsWith("@/")) base = resolve("src", specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) base = fileURLToPath(new URL(specifier, context.parentURL));
  if (base) {
    for (const suffix of ["", ".ts", ".tsx", ".mjs", "/index.ts"]) {
      if (existsSync(base + suffix)) return nextResolve(pathToFileURL(base + suffix).href, context);
    }
  }
  return nextResolve(specifier, context);
} });
