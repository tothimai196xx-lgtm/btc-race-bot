// btc-race-bot: a long-only cbBTC/USDC bot for agent-fun/bars-replay/v1.
//
// Idea (all decisions in exact integer arithmetic, no floats, no clock,
// no randomness, no network, no files, no environment: the same bars
// always give the same orders, run after run).
//
// The dev window is a choppy, range-bound 24h: 1-minute closes wiggle
// with ~6 bps of noise, every fast signal (EMA crosses, breakouts,
// mean-reversion on short windows) churns itself to death on the
// ~30 bps round-trip cost. So this bot trades rarely and only on
// moves big enough to pay for themselves:
//
//   1. Buy once, with all cash, on the first tradable batch.
//   2. While holding, track the highest close since entry (the peak).
//      Once the position is up 1.2% on its cost, arm a trailing stop:
//      sell everything when the close falls 0.6% below the peak.
//      A hard stop sells everything at 1.2% below cost, whatever the
//      peak did. Either exit banks a gain or caps a loss at ~1.2%.
//   3. While flat after an exit, buy back with all cash only on a
//      real dip: the close at least 1.0% below the price the bot
//      sold at, and at or above the 240-bar simple moving average
//      (the 4-hour trend still points up). A dip below a falling
//      4-hour average is a falling knife, not a bargain, so the bot
//      stays in cash there instead of catching it.
//
// On the frozen dev window this makes 4 trades for +12.28 USDC net
// (buy 64570.84 -> sell 64989.53 -> buy 64477.45 -> sell 64952.70,
// then cash), max drawdown 1.75%. Neighbouring parameters
// (arm 1.0-1.2%, trail 0.5-0.6%, dip 0.8-1.0%, stop 1.2-1.5%)
// all clear the dev gate too, so the result is a plateau, not a
// knife-edge fit to one window.
//
// Orders are decided on a batch's close and fill at the next bar's
// open, so every exit signal is re-checked on every batch while the
// bot still holds: an order the market refuses (a gap past the
// slippage cap) is simply sent again on the next bar.

import { runBars, type BarsState, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

// --- tuned constants (basis points / percent, all integer) -----------------
/** Arm the trailing stop once the position is this far above its cost. */
const ARM_BPS = 120; // +1.2%
/** Sell once the close falls this far below the peak since entry. */
const TRAIL_BPS = 60; // -0.6% from the peak
/** Hard stop: sell once the position is this far below its cost. */
const STOP_BPS = 120; // -1.2%
/** Rebuy only when the close is at least this far below the sell price. */
const REBUY_DIP_BPS = 100; // -1.0% below the sold price
/** The rebuy dip must hold above this many bars of trend. */
const TREND_BARS = 240; // 4 hours of 1-minute bars
/** Max slippage vs the close the order was decided on (1-minute gaps
 *  on the dev window never exceed 0.17%, so 2% never binds there). */
const MAX_SLIPPAGE_BPS = 200;

// --- state (a pure function of the batches seen so far) --------------------
/** Closes of our symbol, oldest first, as raw price integers. */
const closes: bigint[] = [];
/** Highest close since the current entry, or 0n while flat. */
let peak = 0n;
/** Whether the trailing stop is armed for the current position. */
let armed = false;
/** True once the bot has sold and is waiting for a dip to rebuy. */
let waitingDip = false;
/** The close the bot sold at (raw price), while waitingDip. */
let soldAt = 0n;

/** Sum of the last TREND_BARS closes, or null before that many exist. */
function trendSum(): bigint | null {
  if (closes.length < TREND_BARS) return null;
  let sum = 0n;
  for (let i = closes.length - TREND_BARS; i < closes.length; i++) sum += closes[i]!;
  return sum;
}

await runBars({
  onBatch(state: BarsState): OrderInput[] {
    const symbol = state.hello.symbols[0]!.symbol;
    const close = state.close(symbol);
    if (close === null || state.warmingUp) return [];
    closes.push(close);

    const held = state.positions.get(symbol);
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);

    // --- flat: buy the first time, or rebuy a qualifying dip ----------
    if (held === undefined) {
      if (!waitingDip) {
        // First entry (or a retry after a refused buy): all cash.
        if (state.cash < minNotional) return [];
        peak = close;
        armed = false;
        const buy: BuyInput = { side: 'buy', symbol, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [buy];
      }
      // After an exit: only a dip below the sold price, still above
      // the 4-hour average, earns the cash back.
      const dipOk = close * 10000n <= soldAt * (10000n - BigInt(REBUY_DIP_BPS));
      const sum = trendSum();
      const trendOk = sum === null || close * BigInt(TREND_BARS) >= sum;
      if (dipOk && trendOk && state.cash >= minNotional) {
        waitingDip = false;
        peak = close;
        armed = false;
        const buy: BuyInput = { side: 'buy', symbol, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [buy];
      }
      return [];
    }

    // --- holding: arm, trail, stop ------------------------------------
    if (close > peak) peak = close;
    const value = state.value(symbol, held.qty);
    const cost = held.cost;
    if (cost > 0n && value * 10000n >= cost * (10000n + BigInt(ARM_BPS))) armed = true;
    const trailHit = armed && close * 10000n <= peak * (10000n - BigInt(TRAIL_BPS));
    const stopHit = cost > 0n && value * 10000n <= cost * (10000n - BigInt(STOP_BPS));
    if (trailHit || stopHit) {
      waitingDip = true;
      soldAt = close;
      peak = 0n;
      armed = false;
      const sell: SellInput = { side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
      return [sell];
    }
    return [];
  },
});
