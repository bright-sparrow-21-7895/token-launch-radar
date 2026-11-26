// Token Launch Radar — the model.
//
// One sealed DefiLlama snapshot in, one ranked board out. The board ranks protocols that record
// no token yet by the market value a token would carry if it were priced the way the snapshot's
// own token-bearing protocols are priced:
//
//   implied = TVL x category ratio x growth multiplier x age multiplier
//
// The category ratio is the median market-cap/TVL ratio of the snapshot's token-bearing protocols
// in the same DefiLlama category (used when the category has at least MIN_RATIO_SAMPLES of them,
// otherwise the global median over every token-bearing protocol). The growth multiplier rewards
// seven-day TVL momentum, clamped so one hot week cannot dominate; the age multiplier pays a
// maturity premium to protocols that have run longer with no token recorded. No protocol name is
// ever special-cased: one function scores every row, and every row carries its own inputs so the
// dashboard can show the arithmetic behind each number.

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

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ---------------------------------------------------------------- the model

/** A category ratio is trusted on its own only with at least this many token-bearing samples. */
export const MIN_RATIO_SAMPLES = 4;
/** Seven-day TVL change is clamped to this band before it moves a value. */
export const GROWTH_FLOOR_PCT = -50;
export const GROWTH_CAP_PCT = 100;
/** How much of the clamped seven-day change reaches the value. */
export const GROWTH_WEIGHT = 0.35;
/** Age multiplier: AGE_FLOOR for a brand-new listing, rising by AGE_RANGE over AGE_CAP_DAYS. */
export const AGE_FLOOR = 0.85;
export const AGE_RANGE = 0.3;
export const AGE_CAP_DAYS = 1460;
/** The model label the dashboard states. */
export const MODEL_VERSION = 'category-median-1';
/** How many token-bearing protocols the dashboard's "already trading" strip carries. */
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The ratio evidence the snapshot itself offers: one median per category, plus the global one. */
export interface RatioTable {
  globalRatio: number;
  globalSamples: number;
  byCategory: Map<string, { ratio: number; samples: number }>;
}

/** Medians of market-cap/TVL over every protocol in the snapshot that records a token value. */
export function buildRatios(snapshot: Snapshot): RatioTable {
  const all: number[] = [];
  const per = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const bucket = per.get(p.category) ?? [];
      bucket.push(ratio);
      per.set(p.category, bucket);
    }
  }
  const byCategory = new Map<string, { ratio: number; samples: number }>();
  for (const [category, values] of per) byCategory.set(category, { ratio: median(values), samples: values.length });
  return { globalRatio: median(all), globalSamples: all.length, byCategory };
}

/** The ratio one protocol is priced with, and whether it is its category's own or the global fallback. */
export function ratioFor(table: RatioTable, category: string | null): { ratio: number; basis: 'category' | 'global'; samples: number } {
  if (category !== null) {
    const own = table.byCategory.get(category);
    if (own !== undefined && own.samples >= MIN_RATIO_SAMPLES) return { ratio: own.ratio, basis: 'category', samples: own.samples };
  }
  return { ratio: table.globalRatio, basis: 'global', samples: table.globalSamples };
}

/** One protocol's full valuation: the implied value and every input that produced it. */
export interface Valuation {
  implied: number;
  ratio: number;
  ratioBasis: 'category' | 'global';
  ratioSamples: number;
  growthPct: number;
  growthMult: number;
  ageMult: number;
  age: number | null;
}

/** Score one protocol. The same function scores every row; nothing is keyed on a name. */
export function impliedValue(p: SnapshotProtocol, asOf: string, table: RatioTable): Valuation {
  const { ratio, basis, samples } = ratioFor(table, p.category);
  const age = ageDays(asOf, p.listed_at);
  const growthPct = p.change_7d === null ? 0 : Math.min(GROWTH_CAP_PCT, Math.max(GROWTH_FLOOR_PCT, p.change_7d));
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const ageMult = age === null ? 1 : AGE_FLOOR + AGE_RANGE * (Math.min(age, AGE_CAP_DAYS) / AGE_CAP_DAYS);
  const implied = Math.max(1, Math.round(p.tvl_usd * ratio * growthMult * ageMult));
  return { implied, ratio, ratioBasis: basis, ratioSamples: samples, growthPct, growthMult, ageMult, age };
}

// ---------------------------------------------------------------- row selection

/** Categories the house rule keeps off the board: wrapped, staked, bridged or exchange products. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A name ending in a release marker is a later version of another protocol's product. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Whole words that mark a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Names that open with an exchange's name are that exchange's own product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether the protocol's record carries no token: no CoinGecko id, no symbol, no market cap. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

/**
 * Whether a protocol may be ranked: it records no token and passes the house's exclusion rule —
 * not a bridge/staking/CEX category, no wrapped/staked/staking whole word, no version suffix,
 * no exchange name in front. The watchlist is this rule plus the $50M floor; the board applies
 * the rule at every size, so early protocols below the floor are found the same way.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

// ---------------------------------------------------------------- farm plans

/** A small deterministic pick from a slug, so sibling protocols do not all read the same sentence. */
function pick<T>(slug: string, options: readonly T[]): T {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return options[h % options.length]!;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 540) return 45;
  return 30;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's two core actions: what a farmer actually does inside this kind of protocol. */
function coreActions(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('cdp')) return [
    `Deposit $${capital} of collateral (ETH or a liquid staking token) into a ${n} vault on ${chain} and mint its stablecoin against it, keeping the collateral ratio above 200%.`,
    `Put half the minted stablecoin to work in a ${n} stability or liquidity pool so both sides of the position stay active on ${chain}.`,
  ];
  if (c.includes('lend') || c.includes('collateral')) return [
    `Supply $${capital} of USDC to ${n} on ${chain}; supplied balances are the activity lending protocols count first, so keep the position open rather than round-tripping it.`,
    `Borrow a small amount (under 40% of what you supplied) against the position and repay it a week later, so the wallet shows both sides of ${n}'s market without risking liquidation.`,
  ];
  if (c.includes('dex')) return [
    `Provide $${capital} split evenly between both sides of ${n}'s busiest stable or ETH pool on ${chain} and leave the LP position untouched while it accrues fees.`,
    `Route two or three real swaps a week through ${n} instead of a bigger aggregator; steady volume from one wallet is the pattern DEX point programs reward.`,
  ];
  if (c.includes('curator') || c.includes('allocator')) return [
    `Deposit $${capital} of USDC into one of ${n}'s curated vaults on ${chain} and hold the vault shares; curator vaults meter deposits and time in the vault.`,
    `Split a second, smaller deposit across a different ${n} vault on another chain it curates, so the wallet appears in more than one of its markets.`,
  ];
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity manager')) return [
    `Deposit $${capital} of USDC or ETH into ${n}'s main vault on ${chain} and switch on auto-compounding if the vault offers it, so rewards restake instead of idling.`,
    `Harvest and restake the vault's rewards once a week rather than selling them; the repeated claim transactions are visible, countable activity.`,
  ];
  if (c.includes('derivative') || c.includes('option') || c.includes('synthetic') || c.includes('basis')) return [
    `Deposit $${capital} of USDC as margin on ${n} and open one small, hedged position; close and reopen it weekly so the wallet builds a real trading history.`,
    `Post the same $${capital} as liquidity or vault collateral in ${n}'s counterparty pool if it has one, which earns fees while the trading position runs.`,
  ];
  if (c.includes('rwa')) return [
    `Complete ${n}'s onboarding or KYC if it asks for it, then mint $${capital} of its yield-bearing asset on ${chain} and hold it to term.`,
    `Keep the minted asset in the same wallet for a full interest period; RWA programs meter holders by duration, not by transaction count.`,
  ];
  if (c.includes('staking') || c.includes('restaking')) return [
    `Stake $${capital} of the chain's native or staking asset through ${n} on ${chain} and keep the receipt token in the wallet that staked it.`,
    `Restake or delegate a second tranche through a different ${n} operator or strategy, so the wallet is not riding on a single validator.`,
  ];
  if (c.includes('stable') || c.includes('reserve currency')) return [
    `Mint or deposit $${capital} of ${n}'s stable asset on ${chain} through its own app, not a third-party wrapper, so the mint is credited to your wallet.`,
    `Hold the stable asset in a ${n} savings or staking vault if one is offered, and let a full reward epoch pass before moving it.`,
  ];
  if (c.includes('bridge')) return [
    `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n}, then use the bridged funds in one app on the far side instead of bridging straight back.`,
    `Repeat the crossing once a month in the opposite direction with fresh funds; bridges meter distinct active months and total volume per wallet.`,
  ];
  if (c.includes('launchpad')) return [
    `Register the wallet on ${n} and complete its participation steps before a sale opens, so the address is on the list when allocations are counted.`,
    `Take part in one ${n} launch with about $${capital}, holding the allocation instead of flipping it on day one if the program tracks holders.`,
  ];
  if (c.includes('prediction')) return [
    `Fund the wallet with $${capital} and take one position in ${n}'s most liquid market, sized small enough to hold to settlement.`,
    `Trade in a second, unrelated market category on ${n} as well; breadth across markets is what prediction platforms can verify later.`,
  ];
  if (c.includes('insurance')) return [
    `Buy about $${capital} of cover from ${n} on ${chain} for a position you actually hold, and keep the policy to its expiry date.`,
    `Stake a smaller amount into ${n}'s underwriting pool if it is open, which is the side of the protocol that meters long-term capital.`,
  ];
  if (c.includes('chain')) return [
    `Bridge $${capital} to ${n} and use two or three native apps there (a DEX, a lending market, a name service) so the wallet has organic activity on the chain.`,
    `Keep a small balance and one open position on ${n} for the full holding window rather than draining the wallet after the first week.`,
  ];
  return [
    `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open; a deposit that stays is the baseline activity every program counts.`,
    `Use one more of ${n}'s features with the same wallet (a second pool, a borrow, a stake or a vote) so the address is not a one-transaction visitor.`,
  ];
}

/** The community/points step: rotated by slug so the plans do not read as one stamp. */
function engagementStep(p: SnapshotProtocol): string {
  const n = p.name;
  return pick(p.slug, [
    `Open ${n}'s own points, rewards or quests page from the link on its official site and finish the tasks listed there; never follow a claim link from a reply or a DM. Cost: nothing but time. Time: 20 minutes.`,
    `Join ${n}'s Discord or forum with the same handle you farm under, complete any intro or verification task, and vote in one governance poll if voting is open. Cost: nothing. Time: 15 minutes.`,
    `Check whether ${n} runs a quest campaign on Galxe, Layer3 or its own portal and complete the on-chain tasks with the farming wallet, so the credit lands on the right address. Cost: about $2 of gas. Time: 25 minutes.`,
  ]);
}

/**
 * A protocol's farm plan: five steps — set up, two category-specific core actions, one engagement
 * step, and a hold-and-review step. Every step names its cost and its time, and the figures come
 * from the protocol's own record (TVL sets the capital, age sets the hold), never from a name list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [first, second] = coreActions(p, capital, chain);
  return [
    `Set up a fresh wallet for ${p.name} and fund it on ${chain} with the position money plus about $10 of the chain's gas token; keep the seed phrase offline. Cost: about $3 in bridge and gas fees. Time: 10 minutes.`,
    `${first} Cost: $${capital} of capital plus a few dollars of gas. Time: 15 minutes to set up.`,
    `${second} Cost: gas only, about $2–$5 a week. Time: 10 minutes a week.`,
    engagementStep(p),
    `Hold the ${p.name} position for at least ${hold} days, then review: claim only from the protocol's own page, and log every transaction with its date so the position can be repeated or unwound. Cost: the $${capital} stays in the position. Time: ${hold} days, then 10 minutes to review.`,
  ];
}

// ---------------------------------------------------------------- the board

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  model: {
    ratio: number;
    ratio_basis: 'category' | 'global';
    ratio_samples: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
  };
  farm_steps: string[];
}

/** Build the ranked board: the watchlist in full, plus every other rankable protocol by TVL. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const table = buildRatios(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((q) => q.slug === slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, table) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.v.age,
    watchlist: watch.has(s.p.slug),
    implied_value_usd: s.v.implied,
    model: {
      ratio: round4(s.v.ratio),
      ratio_basis: s.v.ratioBasis,
      ratio_samples: s.v.ratioSamples,
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      age_multiplier: round4(s.v.ageMult),
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
}

// ---------------------------------------------------------------- dashboard data

/** A token-bearing protocol: already trading, shown for contrast, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The category ratio evidence, for the dashboard's model section. */
export interface CategoryRatio {
  category: string;
  ratio: number;
  samples: number;
  used: boolean;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: {
    global_ratio: number;
    global_samples: number;
    min_samples: number;
    growth_weight: number;
    growth_floor_pct: number;
    growth_cap_pct: number;
    age_floor: number;
    age_range: number;
    age_cap_days: number;
    categories: CategoryRatio[];
  };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** The token-bearing protocols by market cap, set apart from the ranked board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** The board plus everything the dashboard needs, from the snapshot alone. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const table = buildRatios(snapshot);
  const live = liveRows(snapshot);
  const categories: CategoryRatio[] = [...table.byCategory.entries()]
    .map(([category, e]) => ({ category, ratio: round4(e.ratio), samples: e.samples, used: e.samples >= MIN_RATIO_SAMPLES }))
    .sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      global_ratio: round4(table.globalRatio),
      global_samples: table.globalSamples,
      min_samples: MIN_RATIO_SAMPLES,
      growth_weight: GROWTH_WEIGHT,
      growth_floor_pct: GROWTH_FLOOR_PCT,
      growth_cap_pct: GROWTH_CAP_PCT,
      age_floor: AGE_FLOOR,
      age_range: AGE_RANGE,
      age_cap_days: AGE_CAP_DAYS,
      categories,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- input and checks

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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's data as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
