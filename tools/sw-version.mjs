// Writes the list of app files and their content hash into sw.js, so the installed app
// downloads a new version whenever any app file changes. Run after changing an app file:
//   node tools/sw-version.mjs
// test/pwa.test.mjs fails if this hasn't been run.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_FILE = /\.(html|css|m?js|json|webmanifest|png|svg)$/;
// The engine (about 2 MB) is kept the first time you play the computer, not when the app installs.
const ENGINE_DIR = 'vendor/stockfish';

// Files the site serves (not left out by .assetsignore) that the app needs, as site paths.
export function appFiles(root = '.') {
  const ignored = readFileSync(join(root, '.assetsignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(join(root, dir)).sort()) {
      const path = dir ? `${dir}/${name}` : name;
      if (ignored.includes(path) || name === 'node_modules' || name === 'sw.js' || path === ENGINE_DIR) continue;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (APP_FILE.test(name)) files.push(path);
    }
  })('');
  // The page is served at "/", never at "/index.html" (which redirects).
  return files.map((path) => (path === 'index.html' ? '/' : path));
}

export function version(root = '.', files = appFiles(root)) {
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(path);
    hash.update(readFileSync(join(root, path === '/' ? 'index.html' : path)));
  }
  return hash.digest('hex').slice(0, 12);
}

export function stamp(source, files, v) {
  return source
    .replace(/^const VERSION = .*$/m, `const VERSION = '${v}';`)
    .replace(/^const FILES = \[[\s\S]*?\];$/m, `const FILES = [\n${files.map((f) => `  '${f}',`).join('\n')}\n];`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = appFiles();
  writeFileSync('sw.js', stamp(readFileSync('sw.js', 'utf8'), files, version('.', files)));
  console.log(`sw.js: ${files.length} files, version ${version('.', files)}`);
}
