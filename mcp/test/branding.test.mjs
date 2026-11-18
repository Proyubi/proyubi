import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
test('Proyubi package and CLI identity', () => {
 const pkg=JSON.parse(read('../package.json'));
 assert.equal(pkg.name,'@proyubi/mcp');
 assert.equal(pkg.bin['proyubi-mcp'],'dist/index.js');
 assert.ok(!pkg.description.includes('Pullcord'));
});
test('MCP announces the Proyubi server while retaining existing design-file wire format',()=>{
 assert.match(read('../src/core.ts'),/name: "proyubi-mcp"/);
 assert.match(read('../src/design.ts'),/kind: "pullcord-design"/);
});
