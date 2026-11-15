# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/riyanbaruna18/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/riyanbaruna18/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (model radar-2): a program that reads a sealed DefiLlama snapshot and ranks pre-token protocols by what a token launch could be worth, with a concrete farm plan for each. It scores 198 launch candidates from 758 protocols — market-derived category multiples, a bounded growth response, and a hump-shaped maturity curve — and ships a static, network-free dashboard.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

In the grader the snapshot is mounted at `/input` and the output goes to `/output`; `node main.ts` with no flags does exactly that. Node 22+, standard library only, no network, deterministic: two runs on the same snapshot write byte-identical output.

## Model (radar-2)

`implied = TVL × category multiple × growth × maturity × chains`

- **Category multiple** — the median mcap/TVL of the snapshot's own live-token protocols in each category, shrunk toward the global median. The market prices each category; the model reads that price.
- **Growth** — `1 + 0.6 × tanh(change_7d / 60)`, clamped to −80…+300%. Bounded, so a +4,448% week cannot hijack the board.
- **Maturity** — a hump peaking at 730 days. Protocols in their prime launch window (1–2 years old, no token yet) score highest; a protocol five years old with no token has likely chosen not to launch one.
- **Chains** — `1 + 0.02` per extra chain, capped at five.
- **Candidates only** — the board applies the snapshot's own watchlist definition to every row: no wrapped, staked or bridged products, no versioned pools, no exchanges. WBTC and staked ETH can never launch a token, so they never rank.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, builds the board, writes `board.json`, `data.js`, `dashboard/` and `screenshots/`, then `dossier.json` via the vendored library.
- `lib/model.ts` — the model, the farm-plan generator and the board validation.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte the scorer's copy.
- `dashboard/` — the static page: sortable/filterable board, per-protocol detail with model breakdown and farm plan, a live-token view, and the method.
- `screenshots/` — board, detail and filtered views of the dashboard.

---

<sub>Entered on [make.fun](https://make.fun/?ref=tvfbjxfd&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
