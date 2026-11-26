#!/usr/bin/env node
// Usage:
//   node scripts/skill-tree.mjs validate
//   node scripts/skill-tree.mjs build [--check]   regenerate metrics.json and skill-tree.sql
//   node scripts/skill-tree.mjs gap <profile.json> <role-id>
//   node scripts/skill-tree.mjs db [out.db]       load the SQL into SQLite (needs node:sqlite)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, metrics, gap, toSQL } from './skill-tree/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data/skill-tree');
const reg = JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8'));
const [cmd = 'validate', ...args] = process.argv.slice(2);

const errors = validate(reg);
if (errors.length) {
  for (const e of errors) console.error(`INVALID: ${e}`);
  process.exit(1);
}

if (cmd === 'validate') {
  console.log(`skill tree valid: ${reg.branches.length} branches, ${reg.skills.length} skills, ${reg.roles.length} roles`);
} else if (cmd === 'build') {
  const outputs = {
    'metrics.json': JSON.stringify(metrics(reg), null, 2) + '\n',
    'skill-tree.sql': toSQL(reg),
    '../../apps/web/src/data/skill-tree.json': JSON.stringify({ registry: reg, metrics: metrics(reg) }) + '\n',
  };
  const stale = [];
  for (const [f, body] of Object.entries(outputs)) {
    const p = path.join(dir, f);
    if (args.includes('--check')) {
      if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== body) stale.push(f);
    } else fs.writeFileSync(p, body);
  }
  if (stale.length) {
    console.error(`stale generated files: ${stale.join(', ')} (run: node scripts/skill-tree.mjs build)`);
    process.exit(1);
  }
  console.log(args.includes('--check') ? 'generated skill tree files are current' : 'wrote metrics.json, skill-tree.sql and the web bundle');
} else if (cmd === 'gap') {
  const [profilePath, roleId] = args;
  if (!profilePath || !roleId) { console.error('usage: gap <profile.json> <role-id>'); process.exit(2); }
  console.log(JSON.stringify(gap(reg, JSON.parse(fs.readFileSync(profilePath, 'utf8')), roleId), null, 2));
} else if (cmd === 'db') {
  const { DatabaseSync } = await import('node:sqlite');
  const out = args[0] ?? path.join(root, 'dist/skill-tree.db');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (fs.existsSync(out)) fs.rmSync(out);
  const db = new DatabaseSync(out);
  db.exec(toSQL(reg));
  const n = db.prepare('SELECT COUNT(*) AS n FROM role_requirement').get().n;
  console.log(`wrote ${out} (${n} role requirements)`);
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}
