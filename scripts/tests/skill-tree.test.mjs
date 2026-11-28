import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validate, metrics, gap, toSQL } from '../skill-tree/lib.mjs';

const reg = JSON.parse(fs.readFileSync(new URL('../../data/skill-tree/registry.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(reg);

test('shipped registry is valid', () => assert.deepEqual(validate(reg), []));

test('rejects an unknown prerequisite', () => {
  const r = clone(); r.skills[0].prerequisites.push('no-such-skill');
  assert.match(validate(r).join('\n'), /unknown prerequisite no-such-skill/);
});

test('rejects a prerequisite cycle', () => {
  const r = clone();
  const a = r.skills.find((s) => s.id === 'neural-nets');
  const b = r.skills.find((s) => s.id === 'optimization');
  b.tier = a.tier; b.prerequisites.push('neural-nets');
  assert.match(validate(r).join('\n'), /prerequisite cycle/);
});

test('rejects a prerequisite above the skill tier', () => {
  const r = clone(); r.skills.find((s) => s.id === 'rag').tier = 1;
  assert.match(validate(r).join('\n'), /prerequisite .* sits higher/);
});

test('rejects an agent role that requires a human-only skill', () => {
  const r = clone(); r.roles.find((x) => x.bearer === 'agent').requires.push({ skill: 'ai-governance', level: 3 });
  assert.match(validate(r).join('\n'), /which a agent cannot hold/);
});

test('rejects an agent-bearable skill with no acquisition mode', () => {
  const r = clone(); delete r.skills.find((s) => s.bearers.includes('agent')).agent_acquisition;
  assert.match(validate(r).join('\n'), /needs agent_acquisition/);
});

test('rejects an out-of-range role level', () => {
  const r = clone(); r.roles[0].requires[0].level = 9;
  assert.match(validate(r).join('\n'), /level for/);
});

test('metrics: every skill is required by at least one role, profiles sum to 1', () => {
  const m = metrics(reg);
  assert.deepEqual(m.unrequired_skills, []);
  for (const role of m.roles) {
    const sum = Object.values(role.branch_profile).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 0.02, `${role.id} profile sums to ${sum}`);
  }
  assert.equal(m.pairings.length, m.totals.agent_roles);
});

test('gap: empty profile has zero readiness, full profile has none missing', () => {
  const role = reg.roles[0];
  assert.equal(gap(reg, { bearer: role.bearer, levels: {} }, role.id).readiness, 0);
  const full = Object.fromEntries(role.requires.map((q) => [q.skill, q.level]));
  const g = gap(reg, { bearer: role.bearer, levels: full }, role.id);
  assert.equal(g.readiness, 1);
  assert.deepEqual(g.gaps, []);
});

test('generated files are current', () => {
  const sql = fs.readFileSync(new URL('../../data/skill-tree/skill-tree.sql', import.meta.url), 'utf8');
  assert.equal(sql, toSQL(reg));
  const m = JSON.parse(fs.readFileSync(new URL('../../data/skill-tree/metrics.json', import.meta.url), 'utf8'));
  assert.deepEqual(m, metrics(reg));
});

test('SQL loads into SQLite and readiness view works', async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { t.skip('node:sqlite unavailable'); return; }
  const db = new DatabaseSync(':memory:');
  db.exec(toSQL(reg));
  const role = reg.roles.find((r) => r.id === 'coding-agent');
  db.exec(`INSERT INTO holder (id, bearer, label) VALUES ('a1', 'agent', 'test agent');`);
  const ins = db.prepare('INSERT INTO assessment (holder_id, skill_id, level, assessed_on) VALUES (?, ?, ?, ?)');
  for (const q of role.requires) { ins.run('a1', q.skill, 1, '2026-01-01'); ins.run('a1', q.skill, q.level, '2026-02-01'); }
  const r = db.prepare("SELECT readiness FROM holder_role_readiness WHERE holder_id = 'a1' AND role_id = 'coding-agent'").get();
  assert.equal(r.readiness, 1);
});
