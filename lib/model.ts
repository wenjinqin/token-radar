// Token Launch Radar — the valuation model.
//
// The board ranks protocols that record no token yet by what a token would be
// worth if it were valued the way the market already values that protocol's
// listed peers. The model reads only the sealed snapshot:
//
//   implied = TVL x peer multiple x momentum tilt x maturity tilt
//
// - peer multiple: the median market-cap / TVL ratio of the snapshot's own
//   tokenised protocols in the same category (the global median when a
//   category has fewer than three listed peers). No outside price, no
//   hardcoded name: change the snapshot and every number moves.
// - momentum tilt: seven-day TVL growth, clamped, moves the value by at most
//   a quarter either way. A hot week is evidence, not a re-rating.
// - maturity tilt: a protocol that has run longer at scale with no token
//   carries a larger eventual float, so age adds up to 30%.
//
// Products of a token that already trades (wrapped, staked and bridged
// variants), versioned pools of another protocol and centralised exchanges
// are set aside, not ranked: none of them is a launch still to come. The
// snapshot's watchlist is covered in full, and the board ranks every other
// rankable pre-token protocol down to the snapshot's $5M floor.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, named so the dashboard can state them verbatim. */
export const MODEL = {
  version: 'peer-multiple-1',
  min_peers: 3,
  momentum_clamp_low: -25,
  momentum_clamp_high: 40,
  momentum_weight: 0.6,
  maturity_days: 1460,
  maturity_bonus: 0.3,
  unknown_age_days: 365,
} as const;

/** Categories that are never a launch of their own. */
const SET_ASIDE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to `asOf`, or null when either date is missing. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is set aside instead of ranked, or null when it ranks. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) {
    return p.category === 'CEX'
      ? 'a centralised exchange: its equity is not a token launch this radar tracks'
      : `a ${p.category.toLowerCase()} product of assets whose tokens already trade`;
  }
  if (VERSIONED.test(p.name)) return 'a versioned deployment of another protocol';
  if (WRAPPED_WORD.test(p.name)) return 'a wrapped or staked product of a token that already trades';
  if (EXCHANGE_PREFIX.test(p.name)) return 'an exchange product, not a protocol launch';
  return null;
}

/** The peer table: per-category median market-cap / TVL over listed protocols. */
export interface PeerTable {
  byCategory: Map<string, { multiple: number; peers: number }>;
  global: { multiple: number; peers: number };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Build the peer table from the snapshot's tokenised protocols alone. */
export function peerTable(snapshot: Snapshot): PeerTable {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? '(uncategorised)';
    const list = ratios.get(key) ?? [];
    list.push(ratio);
    ratios.set(key, list);
  }
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [key, list] of ratios) {
    if (list.length >= MODEL.min_peers) byCategory.set(key, { multiple: median(list), peers: list.length });
  }
  return { byCategory, global: { multiple: median(all), peers: all.length } };
}

/** One protocol's valuation under the model, with every factor exposed. */
export interface Valuation {
  multiple: number;
  peers: number;
  peer_scope: string;
  momentum: number;
  maturity: number;
  age_days: number | null;
  implied: number;
}

export function value(p: SnapshotProtocol, asOf: string, peers: PeerTable): Valuation {
  const cat = p.category ?? '(uncategorised)';
  const scoped = peers.byCategory.get(cat);
  const multiple = scoped ? scoped.multiple : peers.global.multiple;
  const peerCount = scoped ? scoped.peers : peers.global.peers;
  const growth = Math.min(MODEL.momentum_clamp_high, Math.max(MODEL.momentum_clamp_low, p.change_7d ?? 0));
  const momentum = 1 + (growth / 100) * MODEL.momentum_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturity = 1 + MODEL.maturity_bonus * (Math.min(ageForModel, MODEL.maturity_days) / MODEL.maturity_days);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity));
  return {
    multiple,
    peers: peerCount,
    peer_scope: scoped ? `category ${cat}` : 'all listed protocols',
    momentum,
    maturity,
    age_days: age,
    implied,
  };
}

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
  on_watchlist: boolean;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_scope: string;
    momentum_multiplier: number;
    maturity_multiplier: number;
  };
  farm_steps: string[];
}

/** A protocol the board sets aside, with the reason, for the dashboard's side view. */
export interface AsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  reason: string;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  stats: {
    protocols: number;
    pre_token: number;
    ranked: number;
    watchlist: number;
    watchlist_covered: number;
    set_aside: number;
    listed_peers: number;
    global_multiple: number;
  };
  rows: BoardRow[];
  aside: AsideRow[];
}

/** Build the ranked board and the dashboard's data from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const peers = peerTable(snapshot);
  const watch = new Set(snapshot.watchlist);
  const ranked: { p: SnapshotProtocol; v: Valuation }[] = [];
  const aside: AsideRow[] = [];
  let preToken = 0;
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) {
      if (p.mcap_usd !== null) {
        aside.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, reason: 'already trading: the market sets this value, not the model' });
      }
      continue;
    }
    preToken += 1;
    const reason = setAsideReason(p);
    if (reason !== null && !watch.has(p.slug)) {
      aside.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: null, reason });
      continue;
    }
    ranked.push({ p, v: value(p, snapshot.as_of, peers) });
  }
  ranked.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const board: BoardRow[] = ranked.map(({ p, v }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: v.age_days,
    on_watchlist: watch.has(p.slug),
    implied_value_usd: v.implied,
    model: {
      peer_multiple: v.multiple,
      peer_count: v.peers,
      peer_scope: v.peer_scope,
      momentum_multiplier: v.momentum,
      maturity_multiplier: v.maturity,
    },
    farm_steps: farmSteps(p, v),
  }));
  aside.sort((a, b) => b.tvl_usd - a.tvl_usd);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL.version,
    stats: {
      protocols: snapshot.protocols.length,
      pre_token: preToken,
      ranked: board.length,
      watchlist: snapshot.watchlist.length,
      watchlist_covered: board.filter((r) => r.on_watchlist).length,
      set_aside: aside.length,
      listed_peers: peers.global.peers,
      global_multiple: peers.global.multiple,
    },
    rows: board,
    aside: aside.slice(0, 60),
  };
  return { board, radar };
}

/** Money, compact: $1.24B, $860M, $45.2K. */
export function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n}`;
}

/** The chains a plan names: the first two, in the snapshot's order. */
function chainNames(p: SnapshotProtocol): string {
  if (p.chains.length === 0) return 'its main chain';
  if (p.chains.length === 1) return p.chains[0]!;
  return `${p.chains[0]} and ${p.chains[1]}`;
}

/** Working capital a plan assumes, scaled to the protocol's size. */
function capital(p: SnapshotProtocol): string {
  if (p.tvl_usd >= 1e9) return '$2,000-$5,000';
  if (p.tvl_usd >= 1e8) return '$1,000-$2,500';
  if (p.tvl_usd >= 1e7) return '$500-$1,500';
  return '$200-$800';
}

/** A concrete farm plan for one protocol: actions, costs and time, no slogans. */
export function farmSteps(p: SnapshotProtocol, v: Valuation): string[] {
  const name = p.name;
  const chains = chainNames(p);
  const cap = capital(p);
  const age = v.age_days;
  const horizon = age !== null && age > 900 ? '8-12 weeks' : '6-10 weeks';
  const cat = p.category ?? '';
  const steps: string[] = [];
  const open = `Open a dedicated wallet for ${name} and fund it with ${cap} on ${chains}; a fresh wallet keeps this farm separate from your main holdings if a points program later snapshots balances. Cost: bridge and gas fees of $5-$25. Time: 30 minutes to set up.`;
  const close = `Keep a simple log of every transaction hash, date and fee for ${name}; if a token or points conversion is announced, the log is your proof of early use and your record for taxes. Cost: nothing but 5 minutes a week. Time: ${horizon} of steady activity beats one large deposit made the week before a snapshot.`;
  let middle: string[];
  switch (cat) {
    case 'Dexs':
      middle = [
        `Swap on ${name} two to three times a week through ${chains}, $100-$400 a trade, rotating across at least four different pairs so the activity reads as real use rather than wash volume. Cost: swap fees plus $1-$8 gas a trade. Time: 10 minutes a session.`,
        `Add ${cap} of liquidity to one of ${name}'s busiest pools and leave it in place; withdraw and re-add once a month so the position spans several epochs. Cost: impermanent loss risk on the pair, plus $5-$20 in gas per adjustment. Time: 20 minutes to open, 5 minutes a month to maintain.`,
        `Use every surface ${name} offers on ${chains} at least once: limit orders, the aggregator route or the mobile app, so your wallet touches each product line a points program might weight. Cost: under $10 in fees. Time: one 30-minute session.`,
      ];
      break;
    case 'Lending':
      middle = [
        `Supply ${cap} to ${name}'s largest market on ${chains} and leave the deposit untouched; lenders who stay through quiet weeks are the wallets a launch usually rewards. Cost: gas of $2-$10 to supply. Time: 15 minutes to open the position.`,
        `Borrow 30-40% against the deposit and repay within a few days, twice a month, so the wallet shows both sides of ${name}'s market without risking liquidation. Cost: a few dollars of interest per borrow cycle. Time: 10 minutes per cycle.`,
        `Repeat the supply position on a second chain ${name} serves, even with $100, so the wallet appears in more than one of its deployments. Cost: $5-$25 to bridge. Time: 20 minutes, once.`,
      ];
      break;
    case 'Derivatives':
      middle = [
        `Trade small perpetual positions on ${name} two or three times a week, $50-$150 of margin a trade, closing each within the day; volume spread over weeks counts for more than one large trade. Cost: trading fees of roughly 0.05% a side plus funding. Time: 15 minutes a session.`,
        `Deposit ${cap} as collateral on ${chains} and keep it there between trades so your account holds a balance across snapshots. Cost: $2-$10 gas to deposit. Time: 10 minutes, once.`,
        `Enter one of ${name}'s trading competitions or fee-tier programs if it runs one during the farm; they are the closest public signal of how activity will be weighted. Cost: normal trading fees only. Time: the competition window.`,
      ];
      break;
    case 'Yield':
    case 'Yield Aggregator':
      middle = [
        `Deposit ${cap} into ${name}'s flagship vault on ${chains} and hold through at least two full harvest cycles; vault shares held over time are the standard measure a yield token launch rewards. Cost: $2-$12 gas to deposit. Time: 15 minutes to open.`,
        `Split a second, smaller deposit across one more of ${name}'s vaults so the wallet uses more than the default product. Cost: $2-$12 gas per vault. Time: 10 minutes each.`,
        `Claim and restake rewards monthly rather than selling them; a wallet that compounds reads as a holder, not a mercenary. Cost: a few dollars of gas a month. Time: 5 minutes a month.`,
      ];
      break;
    case 'CDP':
      middle = [
        `Mint a small position against ${cap} of collateral on ${name} via ${chains}, keeping the collateral ratio above 200% so the position survives a down week. Cost: $3-$15 gas to open. Time: 20 minutes.`,
        `Hold the minted stablecoin or deposit it back into ${name}'s own stability pool, so both sides of the system record your wallet. Cost: $2-$10 gas. Time: 10 minutes.`,
        `Adjust the position once a month (add or repay a small amount) so the account shows ongoing management rather than a single touch. Cost: under $5 a month in gas. Time: 5 minutes a month.`,
      ];
      break;
    case 'RWA':
      middle = [
        `Complete ${name}'s onboarding or allowlist step first if it has one; for real-world-asset protocols the verified list is usually the distribution list. Cost: identity verification time only. Time: one 20-minute session.`,
        `Buy or deposit ${cap} into ${name}'s most liquid product on ${chains} and hold it; RWA positions are slow by design, and holding through a full interest cycle is the signal. Cost: platform fees of 0.1-0.5%. Time: 20 minutes to open, then hold.`,
        `Reinvest one interest payment instead of withdrawing it, so the account shows a second purchase event. Cost: nothing beyond the position itself. Time: 5 minutes when the payment lands.`,
      ];
      break;
    default:
      middle = [
        `Use ${name}'s core product on ${chains} at least twice a week with real amounts, ${cap} of working capital in total; consistent weekly use over ${horizon} is the pattern points programs reward. Cost: $1-$10 a session in fees and gas. Time: 10-15 minutes a session.`,
        `Hold a balance or position in ${name} continuously rather than dipping in and out, so the wallet appears in every weekly snapshot the team might take. Cost: the opportunity cost of ${cap} parked. Time: set up once, 15 minutes.`,
        `Take part in one governance vote, testnet, or community task ${name} runs during the farm; off-chain participation lists are often merged into a launch allocation. Cost: usually free, occasionally a few dollars of gas. Time: 15-30 minutes, once.`,
      ];
      break;
  }
  steps.push(open, ...middle, close);
  return steps;
}

/** Parse and lightly validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot is missing its protocols or watchlist');
  }
  return raw;
}

/** The gate's shape, checked before anything is written: a refusal or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `board holds ${board.length} rows, fewer than 100`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row ${row.slug} is not a snapshot protocol`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.implied_value_usd > prev) return `implied value rises at rank ${row.rank}`;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const s of row.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${row.slug} has a farm step of ${len} characters`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: window.RADAR, written beside dashboard/. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
