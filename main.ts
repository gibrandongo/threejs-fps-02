// BREACHLINE — the entry program. It hands the game in: copies game/
// and screenshots/ from this repository to the output directory and
// writes dossier.json with the kit's buildDossier library, byte for
// byte the dossier the scorer rebuilds. Plain JavaScript only, so it
// runs under any Node 22 without type stripping. Deterministic: the
// same repository always writes the same bytes.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// Never wipe the repository itself: refuse an output dir that is the
// repo root or inside it (a bad MAKEFUN_OUTPUT_DIR would delete the
// very files this program copies).
const resolvedOut = resolve(outDir);
if (
  resolvedOut === repoRoot ||
  resolvedOut.startsWith(repoRoot + sep) ||
  repoRoot.startsWith(resolvedOut + sep)
) {
  console.error('refusing to write output inside the repository:', resolvedOut);
  process.exit(1);
}

// Build the dossier from the repository FIRST, before touching the
// output directory: the dossier reads only game/ and screenshots/,
// so these bytes are identical to building it after the copy, and a
// dossier failure now surfaces before any output is mutated instead
// of leaving a partial /output behind.
const dossier = buildDossier(repoRoot, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });
cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log('BREACHLINE handed in: game/, screenshots/, dossier.json ->', outDir);
