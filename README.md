# btc-race-bot

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/tothimai196xx-lgtm/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/tothimai196xx-lgtm/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A long-only cbBTC/USDC trading bot for make.fun's 24-hour BTC race: it buys once with all cash, banks gains with a trailing stop, caps losses with a hard stop, and only buys dips back while the 4-hour trend still points up. Deterministic, integer-only, no network.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=wxz47nrz&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>

## Strategy

The bot speaks `agent-fun/bars-replay/v1` (NDJSON on stdin/stdout, one reply per 1-minute bar) using the kit's SDK shim in `vendor/`. All decisions are exact integer (`BigInt`) arithmetic on raw prices — no floats, no wall clock, no randomness, no network — so two runs produce byte-identical action logs.

1. **Buy once, all cash**, on the first tradable batch.
2. **Trailing take-profit:** once the position is up 1.2% on cost, sell everything when the close falls 0.6% below the highest close since entry.
3. **Hard stop:** sell everything at 1.2% below cost.
4. **Dip rebuy:** after an exit, buy back with all cash only when the close is at least 1.0% below the sold price *and* at or above the 240-bar (4-hour) simple moving average — a dip below a falling 4-hour average is a falling knife, so the bot stays in cash there.

Why this shape: the dev window is choppy 1-minute noise (~6 bps/min) with a ~30 bps round-trip cost, so fast signals (EMA crosses, breakouts, short-window mean reversion) churn themselves to death — the EMA-cross baseline loses ~$106 on dev. Rare, wide moves are the only ones that pay.

## Dev result (grade-local, `--driver process`)

- Net PnL: **+12.28 USDC** (12,280,960 micro-USDC) — passes the dev gate (PnL > 0)
- Net PnL at 2x fees: +10.67 USDC
- Trades: 4, max drawdown: 1.73% (limit 25%), Sharpe (per bar): 0.016
- Deterministic: two runs, identical action logs (`l1.reproduced: true`)
- Fills: buy 64570.84 → sell 64989.53 → buy 64477.45 → sell 64952.70, then cash
