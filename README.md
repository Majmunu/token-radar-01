# Token Radar — make.fun `token-radar-01`

Pre-token protocols ranked by implied launch value, from a DefiLlama snapshot.

**Entry for the make.fun competition `token-radar-01`** (deadline 2026-12-14 10:00 UTC).
Solo account `@nimble-robin-72-2882`.

## Model (radar-2)

```
implied = round( tvl_usd x 0.25
  x (1 + clamp(change_7d, -50, 100) / 100 x 0.6)
  x (0.55 + min(age_days, 1460) / 1460 x 0.45)
  x (1 + 0.04 x min(chains - 1, 4)) )
```

- **Board:** 178 rows — the full 40-protocol watchlist (every protocol with
  ≥ $50M TVL and no token) plus 138 early rows below the floor.
- **Exclusions:** wrapped, staked, bridged and exchange products of tokens that
  already trade are never ranked (Bridge, Liquid Staking/Restaking, Restaked
  BTC, CEX, versioned pools, wrapped/staked names, exchange-named products).
- **Farm plan:** 7 steps per protocol, derived from its category, chains, TVL
  and age — a main action, a second different qualifying action, weekly
  activity, hold period, claim check and log. Each step states cost and time.
- **Dashboard:** static, offline page (`dashboard/`) — sortable/filterable
  board, chain + watchlist filters, per-protocol detail with the model's own
  multipliers and farm plan, and the live-token protocols set aside.

## Run

```sh
node main.ts --input <snapshot.json|directory>   # writes /output (or $MAKEFUN_OUTPUT_DIR)
```

Node 22+, standard library only. The program runs twice with byte-identical
output. `screenshots/` shows the board, a protocol detail view and a filtered
view, all rendered from this dashboard.
