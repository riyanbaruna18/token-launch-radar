// Token radar model v2 ("radar-2"): one snapshot of the protocol universe in,
// one ranked board out.
//
// The board ranks launch candidates only. A candidate is a protocol the
// snapshot records with no token at all, filtered by the same definition the
// snapshot's own watchlist uses: not a wrapped, staked or bridged product of
// a token that already trades, not a versioned pool of another protocol, and
// not an exchange. The starter board's top rows were WBTC, Binance staked
// ETH and the Coinbase bridge — products that can never launch a token of
// their own. This model applies the watchlist's definition to every row, so
// the board is a list of protocols that might actually launch.
//
// Implied value follows only from the snapshot's own figures, never from a
// hand-kept list of names:
//
//   multiple   = the category's market multiple: the median mcap/TVL of the
//                snapshot's live-token protocols in that category, shrunk
//                toward the global median (prior weight 3) and clamped to
//                [0.05, 0.60]; categories with fewer than three live
//                protocols take the global median outright, because one
//                protocol's ratio is luck, not a market price. The market,
//                not the author, prices each category.
//   growth     = tanh(clamp(change_7d, -80, 300) / 60): a smooth, bounded
//                response. A +26% week lifts the value ~25%; a -70% week
//                halves it; a +4,448% outlier is capped, not worshipped.
//   maturity   = a hump, not a staircase: 0.55 + 0.45 * rise * decay, where
//                rise climbs to 1.0 over the first 730 days and decay falls
//                to 0.30 over the next 1,460. Protocols in their prime
//                launch window (1-2 years old, no token yet) score highest;
//                a protocol five years old with no token has likely chosen
//                not to launch one.
//   chains     = 1 + 0.02 * min(chains - 1, 5): more chains, more surface.
//   implied    = max(1, round(tvl_usd * multiple * growth * maturity * chains))
//
// The dashboard also shows a confidence score per row: 100 minus a penalty
// for each missing figure (7-day change, listing date, category, chains).

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple_fallback: number;
  multiple_prior_weight: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_scale: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_peak_days: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_decay_days: number;
  maturity_decay_floor: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap_steps: number;
}

export const MODEL: ModelConstants = {
  base_multiple_fallback: 0.205,
  multiple_prior_weight: 3,
  multiple_floor: 0.05,
  multiple_cap: 0.6,
  growth_scale: 60,
  growth_weight: 0.6,
  growth_floor: -80,
  growth_cap: 300,
  maturity_peak_days: 730,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_decay_days: 1460,
  maturity_decay_floor: 0.3,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_cap_steps: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  confidence: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  confidence: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  farm_steps: string[];
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Exchange names a protocol name must not begin with (the watchlist's rule). */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Categories that are wrapped, staked or bridged products, not launches of their own. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a name describes a wrapped, staked or exchange product. */
function wrappedLike(p: SnapshotProtocol): boolean {
  const words = p.name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) return true;
  return EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix));
}

/**
 * Whether a protocol is a launch candidate: pre-token, not a wrapped/staked/
 * bridged product, not a versioned pool, not an exchange. This is the
 * snapshot's own watchlist definition, applied to every row of the board.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== null && !WRAPPED_CATEGORIES.has(p.category) && !VERSIONED.test(p.name) && !wrappedLike(p);
}

/** The median of a sorted number list, or null when empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * The market multiples, one per category, derived from the snapshot's own
 * live-token protocols: median mcap/TVL per category, shrunk toward the
 * global median with a prior, clamped to the model's band. Categories with
 * no live protocol take the global median. Computed from the snapshot on
 * every run, never hard-coded.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants): Map<string, number> {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const list = byCategory.get(p.category ?? '') ?? [];
    list.push(ratio);
    byCategory.set(p.category ?? '', list);
  }
  all.sort((a, b) => a - b);
  const global = median(all) ?? model.base_multiple_fallback;
  const out = new Map<string, number>();
  for (const [category, ratios] of byCategory) {
    // A category median from fewer than three live protocols is one
    // protocol's luck, not a market price: those categories take the global
    // median. With three or more, shrink the median toward the global one.
    if (ratios.length < 3) {
      out.set(category, global);
      continue;
    }
    ratios.sort((a, b) => a - b);
    const med = median(ratios) ?? global;
    const shrunk = (ratios.length * med + model.multiple_prior_weight * global) / (ratios.length + model.multiple_prior_weight);
    out.set(category, Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk)));
  }
  return out;
}

/** The category multiple for one protocol: its category's, else the global median. */
function multipleFor(p: SnapshotProtocol, multiples: Map<string, number>, model: ModelConstants): number {
  return multiples.get(p.category ?? '') ?? model.base_multiple_fallback;
}

/** The growth multiplier: a smooth, bounded response to the 7-day TVL change. */
export function growthMultiplier(change7d: number | null, model: ModelConstants): { pct: number; mult: number } {
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(change7d, 0)));
  const mult = 1 + model.growth_weight * Math.tanh(pct / model.growth_scale);
  return { pct, mult };
}

/** The maturity multiplier: a hump peaking at the prime launch window. */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const days = age ?? model.unknown_age_days;
  const rise = Math.min(Math.max(days, 0), model.maturity_peak_days) / model.maturity_peak_days;
  const decay = days <= model.maturity_peak_days
    ? 1
    : Math.max(model.maturity_decay_floor, 1 - (days - model.maturity_peak_days) / model.maturity_decay_days);
  return model.maturity_floor + model.maturity_range * rise * decay;
}

/** The chain multiplier: a small bonus for protocols live on more chains. */
export function chainMultiplier(p: SnapshotProtocol, model: ModelConstants): number {
  return 1 + model.chain_step * Math.min(Math.max(p.chains.length - 1, 0), model.chain_cap_steps);
}

/** How much of the picture the snapshot gives for one protocol, 0-100. */
export function confidenceScore(p: SnapshotProtocol): number {
  let score = 100;
  if (p.change_7d === null) score -= 30;
  if (p.listed_at === null) score -= 30;
  if (p.category === null) score -= 20;
  if (p.chains.length === 0) score -= 20;
  return Math.max(0, score);
}

/** The four multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, number>,
  model: ModelConstants,
): {
  implied: number;
  categoryMult: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
  confidence: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const categoryMult = multipleFor(protocol, multiples, model);
  const { pct: growthPct, mult: growthMult } = growthMultiplier(protocol.change_7d, model);
  const maturityMult = maturityMultiplier(age, model);
  const chainMult = chainMultiplier(protocol, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * categoryMult * growthMult * maturityMult * chainMult));
  return { implied, categoryMult, growthPct, growthMult, maturityMult, chainMult, age, confidence: confidenceScore(protocol) };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it that the snapshot carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: launch candidates below the watchlist floor, by TVL.
  // Every candidate in the snapshot makes the board; the floor is a floor,
  // never a ceiling, and the list ranks nothing by itself.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isLaunchCandidate(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    confidence: s.confidence,
    model: {
      category_multiple: round4(s.categoryMult),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, or null. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** Gas per transaction on a chain, in the words a farmer budgets with. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $5–15 of gas per transaction';
  if (c === 'solana') return 'about $0.01 of gas per transaction';
  if (c === 'binance') return 'about $0.10–0.30 of gas per transaction';
  if (c === 'base' || c === 'arbitrum' || c === 'optimism' || c === 'linea' || c === 'scroll' || c === 'zksync era' || c === 'unichain' || c === 'megaeth' || c === 'soneium') {
    return 'about $0.10–1 of gas per transaction';
  }
  return 'about $1–3 of gas per transaction';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the loan-to-value below 50%.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the position in range.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trad')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('yield') || c.includes('farm')) {
    return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and leave the yield compounding.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital alloc')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares for the full season.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and place one position in an active market, then keep the balance staked.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  }
  if (c.includes('option')) {
    return `Deposit $${capital} of USDC as collateral on ${name} and open one small covered position.`;
  }
  if (c.includes('launchpad')) {
    return `Stake $${capital} of the launch asset on ${name} and join one sale allocation.`;
  }
  if (c.includes('payment')) {
    return `Route $${capital} of payments through ${name} on ${chain} and keep the account active.`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of the ${name} index token on ${chain} and hold it.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const action = actionFor(p, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot or a chat.`,
      cost: 'no cost to create the wallet',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
  ];
  if (second !== null) {
    steps.push({
      text: `Repeat the same position on ${second} with half the capital, so the wallet shows activity on two chains the protocol counts.`,
      cost: `$${Math.round(capital / 2)} of capital and ${gasFor(second)}`,
      time: '15 minutes to set up',
    });
  } else {
    steps.push({
      text: `Do one qualifying action in the first week, such as a deposit, a borrow, a swap or a vote, so the wallet is not a one-transaction account.`,
      cost: gas,
      time: '10 minutes',
    });
  }
  steps.push(
    {
      text: `Do one qualifying action every week, such as a deposit, a borrow, a swap or a vote, so the position stays active in every snapshot.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from the link it publishes and check your standing.`,
      cost: 'no fee to check, and never pay to claim an airdrop',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it safely.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    confidence: row.confidence,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm_steps: row.farm_steps,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
