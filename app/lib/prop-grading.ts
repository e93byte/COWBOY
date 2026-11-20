import { LIVE_LEAGUES } from "./sports-leagues";
import type { PropSelection } from "./pick-outcomes";

// Player-prop settlement. The posted prop names come from ESPN's propBets
// feed; the values come from the same event's box score. Any stat this module
// cannot resolve is left unsettled rather than guessed, so a mis-mapped line
// can never produce a wrong won/lost result.
export type PropGrade = "won" | "lost" | "void" | null;

type StatRef = { group?: RegExp; label: string };
const ref = (label: string, group?: RegExp): StatRef => ({ label, group });

const BASKETBALL: Record<string, StatRef[]> = {
  points: [ref("PTS")],
  rebounds: [ref("REB")],
  assists: [ref("AST")],
  threes: [ref("3PT")],
  "3-pointers made": [ref("3PT")],
  "three pointers made": [ref("3PT")],
  "3-point field goals made": [ref("3PT")],
  steals: [ref("STL")],
  blocks: [ref("BLK")],
  turnovers: [ref("TO")],
  "pts+rebs+asts": [ref("PTS"), ref("REB"), ref("AST")],
  "points+rebounds+assists": [ref("PTS"), ref("REB"), ref("AST")],
  "points+rebounds": [ref("PTS"), ref("REB")],
  "points+assists": [ref("PTS"), ref("AST")],
  "rebounds+assists": [ref("REB"), ref("AST")],
  "steals+blocks": [ref("STL"), ref("BLK")],
  "field goals made": [ref("FG")],
};

const FOOTBALL: Record<string, StatRef[]> = {
  "passing yards": [ref("YDS", /pass/i)],
  "pass yards": [ref("YDS", /pass/i)],
  "passing touchdowns": [ref("TD", /pass/i)],
  "passing tds": [ref("TD", /pass/i)],
  "rushing yards": [ref("YDS", /rush/i)],
  "rush yards": [ref("YDS", /rush/i)],
  "rushing touchdowns": [ref("TD", /rush/i)],
  "receiving yards": [ref("YDS", /receiv/i)],
  "reception yards": [ref("YDS", /receiv/i)],
  receptions: [ref("REC", /receiv/i)],
  "receiving touchdowns": [ref("TD", /receiv/i)],
  "interceptions thrown": [ref("INT", /pass/i)],
  "completions": [ref("C/ATT", /pass/i)],
};

const BASEBALL: Record<string, StatRef[]> = {
  strikeouts: [ref("K", /pitch/i)],
  "pitcher strikeouts": [ref("K", /pitch/i)],
  hits: [ref("H", /bat/i)],
  "total bases": [ref("TB", /bat/i)],
  "home runs": [ref("HR", /bat/i)],
  rbis: [ref("RBI", /bat/i)],
  "runs batted in": [ref("RBI", /bat/i)],
  runs: [ref("R", /bat/i)],
  walks: [ref("BB", /bat/i)],
  "hits allowed": [ref("H", /pitch/i)],
  "earned runs": [ref("ER", /pitch/i)],
  "pitching outs": [ref("OUTS", /pitch/i)],
};

const HOCKEY: Record<string, StatRef[]> = {
  goals: [ref("G")],
  assists: [ref("A")],
  points: [ref("G"), ref("A")],
  "shots on goal": [ref("S")],
  saves: [ref("SV", /goal/i)],
  "power play points": [ref("PP")],
};

const SOCCER: Record<string, StatRef[]> = {
  goals: [ref("G")],
  assists: [ref("A")],
  shots: [ref("SH")],
  "shots on target": [ref("ST")],
  "shots on goal": [ref("ST")],
};

const norm = (value: unknown): string => typeof value === "string" || typeof value === "number"
  ? String(value).trim().toLowerCase().replace(/\s+/g, " ") : "";
const number = (value: unknown): number | null => {
  const parsed = Number(String(value ?? "").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export function propStatRefs(propName: string, league: string): StatRef[] | null {
  const leagueConfig = LIVE_LEAGUES.find(entry => entry.id === league);
  const sport = leagueConfig?.sport ?? "";
  const table = sport === "basketball" ? BASKETBALL
    : sport === "football" ? FOOTBALL
    : sport === "baseball" ? BASEBALL
    : sport === "hockey" ? HOCKEY
    : sport === "soccer" ? SOCCER
    : null;
  if (!table) return null;
  const key = norm(propName).replace(/^total /, "");
  return table[key] ?? null;
}

type AthleteStats = { name: string; values: Map<string, number>; labels: string[]; groups: Array<{ name: string; values: Map<string, number> }> };

function athletes(payload: unknown): AthleteStats[] {
  const boxscore = (payload as Record<string, any> | null)?.boxscore;
  const groups = Array.isArray(boxscore?.players) ? boxscore.players : [];
  const result: AthleteStats[] = [];
  for (const rawGroup of groups) {
    const statistics = Array.isArray(rawGroup?.statistics) ? rawGroup.statistics : [];
    for (const stat of statistics) {
      const labels: string[] = Array.isArray(stat?.labels) ? stat.labels.map((label: unknown) => String(label)) : [];
      const groupName = norm(stat?.name ?? stat?.type);
      const entries = Array.isArray(stat?.athletes) ? stat.athletes : [];
      for (const entry of entries) {
        const athlete = entry?.athlete ?? {};
        const name = norm(athlete?.displayName ?? athlete?.shortName ?? athlete?.fullName);
        if (!name) continue;
        const stats: unknown[] = Array.isArray(entry?.stats) ? entry.stats : [];
        const values = new Map<string, number>();
        labels.forEach((label, index) => {
          const value = number(stats[index]);
          if (value !== null) values.set(label.toUpperCase(), value);
        });
        if (!values.size) continue;
        result.push({ name, values, labels: labels.map(label => label.toUpperCase()), groups: [{ name: groupName, values }] });
      }
    }
  }
  // Combine separate stat groups (passing/rushing/receiving) per athlete.
  const merged = new Map<string, AthleteStats>();
  for (const entry of result) {
    const existing = merged.get(entry.name);
    if (!existing) { merged.set(entry.name, entry); continue; }
    existing.groups.push(entry.groups[0]);
    for (const [label, value] of entry.values) if (!existing.values.has(label)) existing.values.set(label, value);
  }
  return [...merged.values()];
}

function readRef(athlete: AthleteStats, target: StatRef): number | null {
  if (target.group) {
    for (const group of athlete.groups) {
      if (!target.group.test(group.name)) continue;
      const value = group.values.get(target.label.toUpperCase());
      if (value !== undefined) return value;
    }
    return null;
  }
  const value = athlete.values.get(target.label.toUpperCase());
  return value === undefined ? null : value;
}

/**
 * Resolve a prop to its numeric box-score value. Returns null when the stat
 * mapping is unknown, which callers treat as "unsettleable" and leave open.
 */
export function propValueFromSummary(payload: unknown, prop: Pick<PropSelection, "player" | "stat">, league: string): number | null {
  const refs = propStatRefs(prop.stat, league);
  if (!refs) return null;
  const name = norm(prop.player);
  const roster = athletes(payload);
  const athlete = roster.find(entry => entry.name === name)
    ?? roster.find(entry => entry.name.endsWith(" " + name) || name.endsWith(" " + entry.name))
    ?? roster.find(entry => entry.name.includes(name) || name.includes(entry.name));
  if (!athlete) return null;
  let total = 0;
  for (const target of refs) {
    const value = readRef(athlete, target);
    if (value === null) return null;
    total += value;
  }
  return total;
}

export function gradePropValue(value: number | null, line: number, side: "over" | "under"): PropGrade {
  if (value === null || !Number.isFinite(line)) return null;
  if (value === line) return "void";
  const won = side === "over" ? value > line : value < line;
  return won ? "won" : "lost";
}

const summaries = new Map<string, { value: unknown; expires: number }>();
const pending = new Map<string, Promise<unknown>>();
const SUMMARY_TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 60_000;

async function fetchSummary(league: string, eventId: string): Promise<unknown | null> {
  const config = LIVE_LEAGUES.find(entry => entry.id === league);
  if (!config || !/^[0-9]{1,16}(?:-[0-9]{1,16})?$/.test(eventId)) return null;
  const key = `${league}:${eventId}`;
  const cached = summaries.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  const request = fetch(`https://site.api.espn.com/apis/site/v2/sports/${config.path}/summary?event=${encodeURIComponent(eventId)}`, {
    cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" },
  }).then(async response => {
    if (!response.ok) return null;
    return await response.json();
  }).catch(() => null).then(value => {
    summaries.set(key, { value, expires: Date.now() + (value ? SUMMARY_TTL_MS : FAILURE_TTL_MS) });
    if (summaries.size > 500) {
      const oldest = summaries.keys().next().value;
      if (oldest) summaries.delete(oldest);
    }
    return value;
  }).finally(() => {
    clearTimeout(timer);
    pending.delete(key);
  });
  pending.set(key, request);
  return request;
}

/** Current box-score value for a prop. Null means "cannot grade safely". */
export async function getPlayerPropValue(league: string, eventId: string, prop: Pick<PropSelection, "player" | "stat">): Promise<number | null> {
  const summary = await fetchSummary(league, eventId);
  return summary ? propValueFromSummary(summary, prop, league) : null;
}

