import { copyFileSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootFile = (path: string) => fileURLToPath(import.meta.resolve?.(path) || '');

copyFileSync(rootFile('../README.md'), './dist/README.md');
copyFileSync(rootFile('../LICENSE'), './dist/LICENSE');
cpSync('./src', './dist/src', { recursive: true });
cpSync(rootFile('../media'), './dist/media', { recursive: true });

const content = readFileSync('./package.json', 'utf-8');
const {
  scripts,
  devDependencies,
  private: _,
  overrides,
  volta,
  'lint-staged': __,
  workspaces,
  files,
  ...parsed
}: any = JSON.parse(content);

function replacePath(path: string) {
  return path.replace(/^\.\/dist\//, './');
}

if (parsed.main) parsed.main = replacePath(parsed.main);
if (parsed.types) parsed.types = replacePath(parsed.types);
if (parsed.module) parsed.module = replacePath(parsed.module);

function traverseExports(exports: any) {
  for (const key in exports) {
    if (key.endsWith('@dev')) delete exports[key];

    if (typeof exports[key] === 'string') {
      exports[key] = replacePath(exports[key]);
    } else {
      traverseExports(exports[key]);
    }
  }
}

if (parsed.exports) traverseExports(parsed.exports);

const newContent = JSON.stringify(parsed, null, 2);

writeFileSync('./dist/package.json', newContent);
