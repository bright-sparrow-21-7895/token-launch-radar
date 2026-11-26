# Token Launch Radar

A token launch radar for the make.fun `token-radar-01` bounty: it reads a sealed DefiLlama
snapshot of 758 protocols, finds the ones that record no token yet, ranks them by the market
value a launch would carry if priced like the snapshot's own token-bearing protocols, and
gives every ranked protocol a concrete farm plan.

## Run it

Node 22.18 or later, standard library only, nothing to install:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

In the grader's container the snapshot is at `/input/snapshot.json` and the output goes to
`/output`. The program writes:

- `board.json` — the ranked board (198 rows: the full 40-protocol watchlist plus 158 early
  protocols below the watchlist floor that pass the same exclusion rule).
- `dashboard/` — the static dashboard (`index.html`, `app.css`, `app.js`) plus
  `zz-board-data.js`, the generated data file. The `zz-` name sorts it last in the dossier's
  path order, so the dossier's 65,536-byte text budget is spent on the hand-written source
  first and the generated data is what gets cut.
- `screenshots/` — the board, a protocol detail view and a filtered view.
- `dossier.json` — written last with the vendored `buildDossier` (`vendor/makefun-board.ts`),
  byte for byte what the scorer rebuilds from the same output.

The dashboard renders with no network. Views are addressed by URL hash, so each can be opened
directly: `#/board`, `#/board?chain=Ethereum&wl=1`, `#/protocol/<slug>`.

## The value model

No protocol name is ever special-cased; one function scores every row:

```
implied = TVL × category ratio × growth multiplier × age multiplier
```

- **Category ratio** — for each DefiLlama category, the median market-cap/TVL ratio of the
  snapshot's token-bearing protocols in that category. A category with fewer than 4 samples
  falls back to the global median over all token-bearing protocols (0.214× over 128 protocols
  in this snapshot). The median keeps one outlier from setting a whole category's price.
- **Growth multiplier** — `1 + clamp(change_7d, −50%, +100%) × 0.35`, so a hot week helps but
  cannot dominate; an unreported change is neutral.
- **Age multiplier** — `0.85 + 0.30 × min(age_days, 1460) / 1460`: a maturity premium for
  protocols that have run longer with no token recorded; an unreported listing date is neutral.

Every board row carries its own ratio, basis (category or global fallback), sample count and
multipliers, and the dashboard's detail view shows the arithmetic behind each value.

## Who is ranked

A protocol is ranked when its record carries no token (no CoinGecko id, no symbol, no market
cap) and it passes the house exclusion rule: its category is not Bridge, Canonical Bridge,
Liquid Staking, Liquid Restaking, Restaked BTC or CEX; its name carries no whole word
*wrapped*, *staked* or *staking*, does not end in a version marker and does not begin with an
exchange's name. The 40-protocol watchlist (that rule plus the $50M TVL floor) is covered in
full; the same rule below the floor adds the early protocols a radar exists to find. Protocols
whose token already trades are never ranked — the dashboard shows the largest of them in a
separate strip at the market's own prices, which is also the comparison set behind the ratios.

Wording discipline, as the rules require: a protocol is said to *record* no token, never to
*have* none — a DefiLlama record can lag a launch.

## Farm plans

Each row's plan has five steps: wallet setup on the protocol's main chain, two core actions
specific to its category (lending markets get a supply-and-borrow loop with a health-factor
guard; DEXes get LP provision plus routed volume; yield vaults get deposit plus weekly
restaking; CDPs get collateralised minting; and so on), one engagement step (the protocol's
own points/quests page, governance, community tasks), and a hold-and-review step. Capital is
scaled to the protocol's TVL ($50–$250) and the holding window to its age (30–60 days); every
step states its cost and its time.

## Layout

- `main.ts` — the entry program.
- `lib/model.ts` — snapshot parsing, the ratio model, row selection, farm plans, gate checks.
- `vendor/makefun-board.ts` — the vendored dossier library, used as-is.
- `dashboard/` — the hand-written page (kept well under the dossier's 64 KB source budget).
- `screenshots/` — three views of the page, 300–350 KB each.

License: MIT (see `LICENSE`).
