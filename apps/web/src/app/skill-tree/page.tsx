import type { Metadata } from "next";
import bundle from "@/data/skill-tree.json";

export const metadata: Metadata = {
  title: "AI Skill Tree — Starlight",
  description: "Skills a human or an agent can hold, the roles that require them, and how agent roles pair with human roles.",
};

type Skill = { id: string; branch: string; tier: number; label: string; bearers: string[]; prerequisites: string[]; description: string; evidence: string; agent_acquisition?: string[] };
type Branch = { id: string; label: string; description: string };
type Role = { id: string; label: string; bearer: string; description: string; requires: { skill: string; level: number }[] };
type RoleMetric = { id: string; label: string; bearer: string; skills: number; breadth: number; depth: number; xp: number; branch_profile: Record<string, number> };

const reg = bundle.registry as unknown as { version: string; status: string; note: string; levels: { level: number; label: string; human: string; agent: string }[]; branches: Branch[]; skills: Skill[]; roles: Role[] };
const m = bundle.metrics as unknown as {
  totals: Record<string, number>;
  roles: RoleMetric[];
  pairings: { agent_role: string; closest_human_roles: { role: string; similarity: number }[] }[];
  skill_demand: { id: string; human_roles: number; agent_roles: number; criticality: number }[];
};

const SIZE = 920;
const C = SIZE / 2;
const R0 = 90;
const RING = 66;

function layout() {
  const sector = (2 * Math.PI) / reg.branches.length;
  const pos = new Map<string, { x: number; y: number }>();
  reg.branches.forEach((b, bi) => {
    const start = bi * sector - Math.PI / 2;
    for (let tier = 1; tier <= 5; tier++) {
      const here = reg.skills.filter((s) => s.branch === b.id && s.tier === tier);
      here.forEach((s, i) => {
        const a = start + (sector * (i + 1)) / (here.length + 1);
        const r = R0 + RING * (tier - 0.5);
        pos.set(s.id, { x: C + r * Math.cos(a), y: C + r * Math.sin(a) });
      });
    }
  });
  return { pos, sector };
}

const label = (id: string) => reg.roles.find((r) => r.id === id)?.label ?? id;

export default function SkillTreePage() {
  const { pos, sector } = layout();
  const humans = m.roles.filter((r) => r.bearer === "human");
  const agents = m.roles.filter((r) => r.bearer === "agent");
  const top = m.skill_demand.slice(0, 10);
  const skillLabel = (id: string) => reg.skills.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <header className="mb-10 max-w-3xl">
          <p className="text-xs font-mono text-white/40 uppercase tracking-widest mb-3">Registry v{reg.version} · {reg.status}</p>
          <h1 className="text-4xl font-bold text-white mb-4">The AI <span className="text-gradient-cyan">skill tree</span></h1>
          <p className="text-white/60 text-lg">
            {m.totals.skills} skills across {m.totals.branches} branches. {m.totals.shared} can be held by a person or an agent; {m.totals.human_only} are human-only.
            {" "}{m.totals.human_roles} human roles and {m.totals.agent_roles} agent roles are measured against the same tree.
          </p>
          <p className="text-white/40 text-sm mt-3">{reg.note}</p>
        </header>

        <section className="glass-card p-4 mb-12">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Radial skill tree: branches as sectors, tiers as rings from the centre outwards" className="w-full h-auto">
            {[1, 2, 3, 4, 5].map((t) => (
              <circle key={t} cx={C} cy={C} r={R0 + RING * t} fill="none" stroke="rgba(255,255,255,0.06)" />
            ))}
            {reg.branches.map((b, bi) => {
              const a = bi * sector - Math.PI / 2;
              const mid = a + sector / 2;
              const rl = R0 + RING * 5 + 22;
              return (
                <g key={b.id}>
                  <line x1={C + R0 * Math.cos(a)} y1={C + R0 * Math.sin(a)} x2={C + (R0 + RING * 5) * Math.cos(a)} y2={C + (R0 + RING * 5) * Math.sin(a)} stroke="rgba(255,255,255,0.08)" />
                  <text x={C + rl * Math.cos(mid)} y={C + rl * Math.sin(mid)} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="rgba(255,255,255,0.65)">{b.label.split(/[ ,]/)[0]}</text>
                </g>
              );
            })}
            {reg.skills.flatMap((s) => s.prerequisites.map((p) => {
              const a = pos.get(p), b = pos.get(s.id);
              return a && b ? <line key={`${p}-${s.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(0,212,255,0.18)" /> : null;
            }))}
            {reg.skills.map((s) => {
              const p = pos.get(s.id)!;
              const shared = s.bearers.length === 2;
              return (
                <g key={s.id}>
                  <title>{`${s.label} (tier ${s.tier}, ${s.bearers.join(" + ")})\n${s.description}\nEvidence: ${s.evidence}`}</title>
                  <circle cx={p.x} cy={p.y} r={7} fill={shared ? "#00D4FF" : "#F5B544"} stroke="#050810" strokeWidth="2" />
                </g>
              );
            })}
            <text x={C} y={C - 8} textAnchor="middle" fontSize="15" fontWeight="600" fill="white">AI skill tree</text>
            <text x={C} y={C + 12} textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.5)">tier 1 inside → tier 5 outside</text>
          </svg>
          <div className="flex flex-wrap gap-6 text-sm text-white/60 px-2 pb-2">
            <span className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full bg-[#00D4FF]" />Human or agent</span>
            <span className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full bg-[#F5B544]" />Human only</span>
            <span>Lines show prerequisites. Hover a node for its evidence bar.</span>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-sm font-medium text-white/40 uppercase tracking-widest mb-4">Roles by branch</h2>
          <div className="overflow-x-auto glass-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-left">
                  <th className="p-3 font-medium sticky left-0 bg-navy-900">Role</th>
                  {reg.branches.map((b) => <th key={b.id} className="p-2 font-medium text-xs whitespace-nowrap" title={b.label}>{b.label.split(/[ ,]/)[0]}</th>)}
                  <th className="p-2 font-medium text-xs">Depth</th>
                  <th className="p-2 font-medium text-xs">XP</th>
                </tr>
              </thead>
              <tbody>
                {[...humans, ...agents].map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="p-3 text-white/85 whitespace-nowrap sticky left-0 bg-navy-900">
                      <span className={`text-[10px] font-mono mr-2 ${r.bearer === "agent" ? "text-cyan-primary" : "text-white/40"}`}>{r.bearer === "agent" ? "AGENT" : "HUMAN"}</span>{r.label}
                    </td>
                    {reg.branches.map((b) => {
                      const v = r.branch_profile[b.id] ?? 0;
                      return <td key={b.id} className="p-1"><div className="h-6 rounded" style={{ background: `rgba(0,212,255,${Math.min(0.9, v * 2.2)})` }} title={`${Math.round(v * 100)}% of ${r.label}'s requirement weight`} /></td>;
                    })}
                    <td className="p-2 text-white/60 font-mono text-xs">{r.depth}</td>
                    <td className="p-2 text-white/60 font-mono text-xs">{r.xp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-white/40 text-xs mt-2">Cell shade = share of the role&apos;s required levels in that branch. XP = sum of level × tier.</p>
        </section>

        <section className="grid md:grid-cols-2 gap-6 mb-12">
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-white mb-1">Agent ↔ human pairing</h2>
            <p className="text-white/50 text-sm mb-4">The human role whose requirements are closest to each agent role: the natural supervisor or pair.</p>
            <ul className="space-y-2 text-sm">
              {m.pairings.map((p) => (
                <li key={p.agent_role} className="flex justify-between gap-3">
                  <span className="text-cyan-primary">{label(p.agent_role)}</span>
                  <span className="text-white/70 text-right">{label(p.closest_human_roles[0].role)} <span className="text-white/30 font-mono">{p.closest_human_roles[0].similarity}</span></span>
                </li>
              ))}
            </ul>
          </div>
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-white mb-1">Most-demanded skills</h2>
            <p className="text-white/50 text-sm mb-4">Ranked by summed required level across every role.</p>
            <ul className="space-y-2 text-sm">
              {top.map((s) => (
                <li key={s.id} className="flex justify-between gap-3">
                  <span className="text-white/85">{skillLabel(s.id)}</span>
                  <span className="text-white/40 font-mono text-xs">{s.human_roles}H · {s.agent_roles}A · {s.criticality}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-white/40 uppercase tracking-widest mb-4">Level rubric</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {reg.levels.map((l) => (
              <div key={l.level} className="glass-card p-4 text-sm">
                <div className="text-white font-semibold mb-2">L{l.level} · {l.label}</div>
                <div className="text-white/60"><span className="text-white/40">Human:</span> {l.human}</div>
                <div className="text-white/60"><span className="text-cyan-primary/70">Agent:</span> {l.agent}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
