// Test helper: an app TS file transpiled on its own imports the shared trip state at runtime (liveCalc.ts imports
// tripState.ts). This links those imports to transpiled copies in the same temp folder, so each test's own loader works.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = { tripState: 'src/lib/tripState.ts', liveCalc: 'src/lib/liveCalc.ts' };

export function linkTs(js, out, ts) {
  return js.replace(/from '(?:\.\/|\.\.\/src\/lib\/)(tripState|liveCalc)'/g, (m, name) => {
    const f = path.join(out, `${name}.mjs`);
    if (!fs.existsSync(f)) {
      const src = fs.readFileSync(path.join(app, SHARED[name]), 'utf8');
      const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
      fs.writeFileSync(f, ''); // a placeholder first, so two files importing each other cannot loop
      fs.writeFileSync(f, linkTs(code, out, ts));
    }
    return `from './${name}.mjs'`;
  });
}
