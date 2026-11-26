// Skill tree registry: validation, role metrics, gap analysis and SQL export.
// One registry (data/skill-tree/registry.json) covers human and agent bearers.
const BEARERS = new Set(['human', 'agent']);

export function validate(reg) {
  const errors = [];
  const err = (m) => errors.push(m);
  const branchIds = new Set();
  for (const b of reg.branches ?? []) {
    if (branchIds.has(b.id)) err(`duplicate branch id: ${b.id}`);
    branchIds.add(b.id);
  }
  const levels = new Set((reg.levels ?? []).map((l) => l.level));
  const maxLevel = Math.max(...levels);
  const skills = new Map();
  for (const s of reg.skills ?? []) {
    if (skills.has(s.id)) err(`duplicate skill id: ${s.id}`);
    skills.set(s.id, s);
    if (!/^[a-z][a-z0-9-]*$/.test(s.id)) err(`skill ${s.id}: id must be kebab-case`);
    if (!branchIds.has(s.branch)) err(`skill ${s.id}: unknown branch ${s.branch}`);
    if (!Number.isInteger(s.tier) || s.tier < 1 || s.tier > 5) err(`skill ${s.id}: tier must be 1-5`);
    if (!Array.isArray(s.bearers) || !s.bearers.length || s.bearers.some((b) => !BEARERS.has(b))) err(`skill ${s.id}: bearers must be a non-empty subset of human, agent`);
    if (!s.evidence) err(`skill ${s.id}: evidence is required`);
    if (s.bearers?.includes('agent') && !(s.agent_acquisition?.length)) err(`skill ${s.id}: agent-bearable skill needs agent_acquisition`);
    for (const m of s.agent_acquisition ?? []) if (!reg.acquisition_modes?.agent?.[m]) err(`skill ${s.id}: unknown agent acquisition mode ${m}`);
  }
  for (const s of skills.values()) {
    for (const p of s.prerequisites ?? []) {
      const pre = skills.get(p);
      if (!pre) { err(`skill ${s.id}: unknown prerequisite ${p}`); continue; }
      if (pre.tier > s.tier) err(`skill ${s.id} (tier ${s.tier}): prerequisite ${p} sits higher at tier ${pre.tier}`);
    }
  }
  // Prerequisites must form a DAG.
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { err(`prerequisite cycle: ${[...trail, id].join(' -> ')}`); return; }
    state.set(id, 1);
    for (const p of skills.get(id)?.prerequisites ?? []) if (skills.has(p)) visit(p, [...trail, id]);
    state.set(id, 2);
  };
  for (const id of skills.keys()) visit(id, []);
  const roleIds = new Set();
  for (const r of reg.roles ?? []) {
    if (roleIds.has(r.id)) err(`duplicate role id: ${r.id}`);
    roleIds.add(r.id);
    if (!BEARERS.has(r.bearer)) err(`role ${r.id}: bearer must be human or agent`);
    const seen = new Set();
    for (const q of r.requires ?? []) {
      if (seen.has(q.skill)) err(`role ${r.id}: skill ${q.skill} listed twice`);
      seen.add(q.skill);
      const s = skills.get(q.skill);
      if (!s) { err(`role ${r.id}: unknown skill ${q.skill}`); continue; }
      if (!s.bearers.includes(r.bearer)) err(`role ${r.id}: ${r.bearer} role requires ${q.skill}, which a ${r.bearer} cannot hold`);
      if (!levels.has(q.level) || q.level < 1 || q.level > maxLevel) err(`role ${r.id}: level for ${q.skill} must be 1-${maxLevel}`);
    }
    if (!r.requires?.length) err(`role ${r.id}: requires at least one skill`);
  }
  return errors;
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

function vector(role, skillIds) {
  const m = new Map(role.requires.map((q) => [q.skill, q.level]));
  return skillIds.map((id) => m.get(id) ?? 0);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function metrics(reg) {
  const skills = new Map(reg.skills.map((s) => [s.id, s]));
  const skillIds = reg.skills.map((s) => s.id);
  const branchIds = reg.branches.map((b) => b.id);
  const roles = reg.roles.map((r) => {
    const branch = Object.fromEntries(branchIds.map((b) => [b, 0]));
    let xp = 0;
    for (const q of r.requires) {
      const s = skills.get(q.skill);
      branch[s.branch] += q.level;
      xp += q.level * s.tier;
    }
    const total = r.requires.reduce((a, q) => a + q.level, 0);
    return {
      id: r.id, label: r.label, bearer: r.bearer,
      skills: r.requires.length,
      breadth: Object.values(branch).filter((v) => v > 0).length,
      depth: round(total / r.requires.length, 2),
      xp,
      branch_profile: Object.fromEntries(branchIds.map((b) => [b, round(branch[b] / total)])),
    };
  });
  const vec = new Map(reg.roles.map((r) => [r.id, vector(r, skillIds)]));
  const humans = reg.roles.filter((r) => r.bearer === 'human');
  const agents = reg.roles.filter((r) => r.bearer === 'agent');
  // For each agent role, the human role whose requirement vector is closest:
  // the person best placed to supervise or pair with that agent.
  const pairings = agents.map((a) => {
    const ranked = humans.map((h) => ({ role: h.id, similarity: round(cosine(vec.get(a.id), vec.get(h.id))) }))
      .sort((x, y) => y.similarity - x.similarity || x.role.localeCompare(y.role));
    return { agent_role: a.id, closest_human_roles: ranked.slice(0, 3) };
  });
  const skillDemand = reg.skills.map((s) => {
    const req = reg.roles.flatMap((r) => r.requires.filter((q) => q.skill === s.id).map((q) => ({ bearer: r.bearer, level: q.level })));
    return {
      id: s.id, branch: s.branch, tier: s.tier, bearers: s.bearers,
      human_roles: req.filter((q) => q.bearer === 'human').length,
      agent_roles: req.filter((q) => q.bearer === 'agent').length,
      max_level: req.reduce((m, q) => Math.max(m, q.level), 0),
      criticality: req.reduce((a, q) => a + q.level, 0),
    };
  }).sort((a, b) => b.criticality - a.criticality || a.id.localeCompare(b.id));
  const bearerSplit = {
    human_only: reg.skills.filter((s) => s.bearers.length === 1 && s.bearers[0] === 'human').length,
    agent_only: reg.skills.filter((s) => s.bearers.length === 1 && s.bearers[0] === 'agent').length,
    shared: reg.skills.filter((s) => s.bearers.length === 2).length,
  };
  return {
    version: reg.version,
    totals: { branches: reg.branches.length, skills: reg.skills.length, roles: reg.roles.length, human_roles: humans.length, agent_roles: agents.length, ...bearerSplit },
    roles, pairings,
    skill_demand: skillDemand,
    unrequired_skills: skillDemand.filter((s) => s.criticality === 0).map((s) => s.id),
  };
}

// A profile is { bearer, levels: { skillId: level } }. Returns the gaps to a
// role and the skills whose prerequisites the profile already meets.
export function gap(reg, profile, roleId) {
  const role = reg.roles.find((r) => r.id === roleId);
  if (!role) throw new Error(`unknown role: ${roleId}`);
  const have = profile.levels ?? {};
  const skills = new Map(reg.skills.map((s) => [s.id, s]));
  const gaps = role.requires
    .map((q) => ({ skill: q.skill, required: q.level, current: have[q.skill] ?? 0 }))
    .filter((g) => g.current < g.required)
    .map((g) => ({ ...g, missing_prerequisites: (skills.get(g.skill).prerequisites ?? []).filter((p) => !(have[p] >= 1)) }));
  const required = role.requires.reduce((a, q) => a + q.level, 0);
  const met = role.requires.reduce((a, q) => a + Math.min(have[q.skill] ?? 0, q.level), 0);
  const unlockable = reg.skills
    .filter((s) => s.bearers.includes(profile.bearer ?? role.bearer) && !(have[s.id] >= 1))
    .filter((s) => (s.prerequisites ?? []).every((p) => have[p] >= 1))
    .map((s) => s.id);
  return { role: role.id, readiness: round(met / required), gaps, unlockable };
}

const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const row = (t, cols, vals) => `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${vals.map(q).join(', ')});`;

export const DDL = `-- Starlight AI skill tree. Portable SQL (SQLite and Postgres).
CREATE TABLE branch (id TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT NOT NULL);
CREATE TABLE level (level INTEGER PRIMARY KEY, label TEXT NOT NULL, human TEXT NOT NULL, agent TEXT NOT NULL);
CREATE TABLE skill (id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branch(id), tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5), label TEXT NOT NULL, description TEXT NOT NULL, evidence TEXT NOT NULL);
CREATE TABLE skill_bearer (skill_id TEXT NOT NULL REFERENCES skill(id), bearer TEXT NOT NULL CHECK (bearer IN ('human','agent')), PRIMARY KEY (skill_id, bearer));
CREATE TABLE skill_prerequisite (skill_id TEXT NOT NULL REFERENCES skill(id), prerequisite_id TEXT NOT NULL REFERENCES skill(id), PRIMARY KEY (skill_id, prerequisite_id));
CREATE TABLE skill_acquisition (skill_id TEXT NOT NULL REFERENCES skill(id), mode TEXT NOT NULL, PRIMARY KEY (skill_id, mode));
CREATE TABLE role (id TEXT PRIMARY KEY, label TEXT NOT NULL, bearer TEXT NOT NULL CHECK (bearer IN ('human','agent')), description TEXT NOT NULL);
CREATE TABLE role_requirement (role_id TEXT NOT NULL REFERENCES role(id), skill_id TEXT NOT NULL REFERENCES skill(id), level INTEGER NOT NULL REFERENCES level(level), PRIMARY KEY (role_id, skill_id));
-- Tracking: a holder is a person or an agent instance; assessments are dated and carry evidence.
CREATE TABLE holder (id TEXT PRIMARY KEY, bearer TEXT NOT NULL CHECK (bearer IN ('human','agent')), label TEXT NOT NULL, target_role_id TEXT REFERENCES role(id));
CREATE TABLE assessment (holder_id TEXT NOT NULL REFERENCES holder(id), skill_id TEXT NOT NULL REFERENCES skill(id), level INTEGER NOT NULL REFERENCES level(level), assessed_on TEXT NOT NULL, evidence_url TEXT, assessor TEXT, PRIMARY KEY (holder_id, skill_id, assessed_on));
CREATE VIEW holder_current_level AS
  SELECT a.holder_id, a.skill_id, a.level FROM assessment a
  WHERE a.assessed_on = (SELECT MAX(b.assessed_on) FROM assessment b WHERE b.holder_id = a.holder_id AND b.skill_id = a.skill_id);
CREATE VIEW holder_role_readiness AS
  SELECT h.id AS holder_id, r.id AS role_id,
    CAST(SUM(MIN(COALESCE(c.level, 0), rr.level)) AS REAL) / SUM(rr.level) AS readiness
  FROM holder h JOIN role r ON r.bearer = h.bearer
  JOIN role_requirement rr ON rr.role_id = r.id
  LEFT JOIN holder_current_level c ON c.holder_id = h.id AND c.skill_id = rr.skill_id
  GROUP BY h.id, r.id;
`;

export function toSQL(reg) {
  const out = [DDL, `-- Seed: registry v${reg.version}. Generated by scripts/skill-tree.mjs sql; do not edit by hand.`];
  for (const b of reg.branches) out.push(row('branch', ['id', 'label', 'description'], [b.id, b.label, b.description]));
  for (const l of reg.levels) out.push(row('level', ['level', 'label', 'human', 'agent'], [l.level, l.label, l.human, l.agent]));
  for (const s of reg.skills) out.push(row('skill', ['id', 'branch_id', 'tier', 'label', 'description', 'evidence'], [s.id, s.branch, s.tier, s.label, s.description, s.evidence]));
  for (const s of reg.skills) for (const b of s.bearers) out.push(row('skill_bearer', ['skill_id', 'bearer'], [s.id, b]));
  for (const s of reg.skills) for (const p of s.prerequisites ?? []) out.push(row('skill_prerequisite', ['skill_id', 'prerequisite_id'], [s.id, p]));
  for (const s of reg.skills) for (const m of s.agent_acquisition ?? []) out.push(row('skill_acquisition', ['skill_id', 'mode'], [s.id, m]));
  for (const r of reg.roles) out.push(row('role', ['id', 'label', 'bearer', 'description'], [r.id, r.label, r.bearer, r.description]));
  for (const r of reg.roles) for (const x of r.requires) out.push(row('role_requirement', ['role_id', 'skill_id', 'level'], [r.id, x.skill, x.level]));
  return out.join('\n') + '\n';
}
