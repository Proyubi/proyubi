import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
test('Proyubi package, repository and visible title', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, '@proyubi/web');
  assert.equal(pkg.repository, 'https://github.com/Proyubi/proyubi');
  assert.match(read('config/defaultSettings.ts'), /title: "Proyubi"/);
  assert.doesNotMatch(read('src/pages/user/login/index.tsx'), /Pullcord/);
});
test('existing authentication and exported design identifiers stay compatible', () => {
  for (const p of ['src/requestErrorConfig.ts', 'src/pages/user/login/index.tsx', 'src/pages/user/OAuthCallback/index.tsx', 'src/pages/invitations/accept.tsx']) assert.match(read(p), /"pullcord_token"/);
  assert.match(read('src/pm/design/scene.ts'), /kind: 'pullcord-design'/);
});
test('every vector wordmark explicitly identifies Proyubi', () => {
  for (const f of readdirSync(resolve(root, '../brand')).filter(f => f.startsWith('lockup-') && f.endsWith('.svg'))) {
    assert.match(read(`../brand/${f}`), /<title>Proyubi<\/title>/);
  }
});
