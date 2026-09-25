// Signal stabilization layer.
//
// The momentum engine (momentumCore.ts) scores every candidate *statelessly*, 
// it re-decides CHECK NOW vs WATCH from scratch on every 60s scan and every 5s
// live refresh. That makes the raw signal jump to "BUY NOW" the instant a price
// tick crosses the strict gate, then snap back if the very next tick fails. For
// manual practice that flicker is dangerous: it manufactures urgency out of one
// unconfirmed tick and invites entries on false breakouts.
//
// This module adds a small, time-aware state machine *on top of* the raw score,
// applied ONLY at the radar's HTTP boundary (see vite.config.ts). It does not
// touch scoreCandidate, the snapshot builder, or the paper bot, the bot keeps
// reacting to the raw, instantaneous signal so it stays stricter and fully
// independent of this display smoothing.
//
// Lifecycle for a setup:
//   armed -> triggered -> confirming -> confirmed        (clean, held breakout)
//   armed -> triggered -> confirming -> failed -> armed  (fake break + cooldown)
//
// Only the `confirmed` phase is allowed to present as CHECK NOW / BUY. Every
// other phase is held at WATCH, so the "Buy now" count and BUY styling only ever
// fire on a breakout that actually held with VWAP support for a short window.

import { MOMENTUM_RULES, type MomentumCandidate, type SignalEvent, type SignalPhase, type SignalStability } from './momentumCore'

// ---- tuning ---------------------------------------------------------------
// Live refresh cadence is ~5s and the full scan is ~60s. The model is built so a
// breakout the user can actually act on: stocks confirm only after the same
// multi-observation, 20-second dwell used by the default execution mode, then STAY
// confirmed (sticky) until the trade is genuinely invalidated, and never flip
// to FAILED on a single noisy tick.
const CONFIRM_HOLDS = 2 // crypto breakout evaluations needed to confirm
const CONFIRM_DWELL_MS = 4_000 // crypto minimum wall-clock hold
const STOCK_CONFIRM_HOLDS = 3
const STOCK_CONFIRM_DWELL_MS = 20_000
const CONFIRM_FAIL_STREAK = 3 // consecutive *misses* while confirming before the break is called failed
const DEMOTE_STREAK = 2 // consecutive stop-loss breaks before leaving `confirmed` (hysteresis)
const FAILED_COOLDOWN_MS = 45_000 // how long a genuinely failed break stays flagged before re-arming
const CONFIRMED_REARM_MS = 10 * 60_000 // a confirmed setup only quietly re-arms after a long quiet window
const TRIGGER_TOLERANCE = 0.999 // tiny slack so float noise at the trigger isn't a failback
const STOP_TOLERANCE = 0.998 // hard invalidation needs a real stop loss break, not one noisy print
// While still armed, re-anchor the locked trigger to the live breakout level once it
// has risen materially (>0.75%) above what we first locked. The raw engine anchors
// entryTrigger to the high of day, so after a big run the true trigger sits well
// above a level locked before the spike, but stop/targets are NOT frozen, so a
// stale-low trigger makes the card disagree with its own stop/targets. The deadband
// keeps small per-scan creep from moving the goalpost (the reason we froze it).
const TRIGGER_REANCHOR_RATIO = 1.0075
const HISTORY_LIMIT = 8
const STALE_RECORD_MS = 10 * 60_000 // forget tickers not seen for 10 minutes
const RADAR_STOCK_BUY_SPREAD_CAP_PCT = 0.4
const RADAR_STOCK_BUY_MAX_QUOTE_AGE_MINUTES = 1
const RADAR_MAX_CHASE_PCT = 1.2

type StateRecord = {
  phase: SignalPhase
  since: number
  triggeredAt: number
  holds: number
  failStreak: number
  demoteStreak: number
  triggerLevel: number | null
  confirmedAt: number | null
  failedAt: number | null
  cooldownUntil: number | null
  history: SignalEvent[]
  lastSeen: number
}

// Module-level, process-lifetime state. Shared by the 60s snapshot handler and
// the 5s live-refresh handler (same server process), so a setup's confirmation
// progress survives across both cadences and a full rescan.
const records = new Map<string, StateRecord>()

function freshRecord(now: number, trigger: number | null): StateRecord {
  return {
    phase: 'armed',
    since: now,
    triggeredAt: now,
    holds: 0,
    failStreak: 0,
    demoteStreak: 0,
    triggerLevel: trigger,
    confirmedAt: null,
    failedAt: null,
    cooldownUntil: null,
    history: [],
    lastSeen: now,
  }
}

// Move to a new phase, stamping the time and appending one history event. A
// no-op when the phase is unchanged, so the trail records transitions only.
function transition(rec: StateRecord, phase: SignalPhase, now: number, price: number, note: string) {
  if (rec.phase === phase) return
  rec.phase = phase
  rec.since = now
  rec.history.push({ phase, at: new Date(now).toISOString(), note, price })
  if (rec.history.length > HISTORY_LIMIT) rec.history.splice(0, rec.history.length - HISTORY_LIMIT)
}

function isReversion(candidate: MomentumCandidate) {
  return candidate.strategy === 'reversion'
}

function hasExecutablePlan(candidate: MomentumCandidate) {
  const { entryTrigger, stopLoss, targetOne, targetTwo } = candidate.signal
  return (
    entryTrigger !== null &&
    stopLoss !== null &&
    targetOne !== null &&
    targetTwo !== null &&
    stopLoss < entryTrigger &&
    targetOne > entryTrigger
  )
}

function targetEdgePct(candidate: MomentumCandidate, trigger: number) {
  const target = candidate.signal.targetOne
  return target !== null && trigger > 0 ? ((target - trigger) / trigger) * 100 : null
}

function radarBuyBlocker(candidate: MomentumCandidate, lockedTrigger: number | null): string | null {
  if (candidate.status !== 'CHECK NOW') return 'waiting for scanner CHECK NOW'
  if (candidate.dataQuality !== 'VERIFIED') return 'data is not verified'
  if (candidate.spreadAvailable === false) return 'live bid/ask is unavailable'
  if (candidate.tradingHalted) return candidate.tradingHaltReason ? `trading halted: ${candidate.tradingHaltReason}` : 'trading halted'
  if (!hasExecutablePlan(candidate)) return 'missing valid stop/target plan'

  const trigger = lockedTrigger ?? candidate.signal.entryTrigger
  if (trigger === null || trigger <= 0) return 'missing trigger'
  if (candidate.price < trigger * TRIGGER_TOLERANCE) return `waiting for trigger ${formatLevel(trigger)}`

  const chasePct = ((candidate.price - trigger) / trigger) * 100
  if (chasePct > RADAR_MAX_CHASE_PCT) {
    return `price ${chasePct.toFixed(2)}% past trigger; wait for a reset`
  }

  if (candidate.assetClass === 'stock') {
    if (candidate.marketStatus === 'CLOSED' || candidate.marketStatus === 'WEEKEND') return 'stock market closed'
    if (candidate.quoteAgeMinutes === null) return 'fresh stock quote unavailable'
    if (candidate.quoteAgeMinutes > RADAR_STOCK_BUY_MAX_QUOTE_AGE_MINUTES) {
      return `stock quote stale by ${candidate.quoteAgeMinutes}m`
    }
    if (candidate.spreadPct > RADAR_STOCK_BUY_SPREAD_CAP_PCT) {
      return `spread ${candidate.spreadPct.toFixed(2)}% over buy cap ${RADAR_STOCK_BUY_SPREAD_CAP_PCT}%`
    }
    if (!isReversion(candidate)) {
      if (!candidate.aboveVwap) return 'not holding VWAP'
      if (candidate.microPullback?.state === 'FAILED') return 'micro pullback failed'
      if (candidate.microPullback?.state === 'FORMING') return 'micro pullback still forming'
      if (candidate.microPullback?.state === 'EXTENDED') return 'extended; wait for a micro pullback'
      if (candidate.microBars && candidate.microBars.bars >= 6 && (candidate.microBars.oneMinuteMovePct ?? 0) < -0.7) {
        return `10s tape fading ${candidate.microBars.oneMinuteMovePct?.toFixed(2)}% over 1m`
      }
      if ((candidate.oneHourMovePct ?? 0) < 0 && (candidate.fifteenMinuteMovePct ?? 0) <= 0) {
        return 'stock short-term tape fading'
      }
      const timeAdjustedRvol = candidate.sessionVolume?.timeAdjustedRelativeVolume ?? null
      if (timeAdjustedRvol !== null && timeAdjustedRvol < 1.1 && candidate.relativeVolume < 3) {
        return `time-adjusted relVol ${timeAdjustedRvol.toFixed(2)}x too weak`
      }
      if (candidate.volumePulse === null) return 'stock 5m volume pulse unavailable'
      if (candidate.volumePulse < 1.05) return `stock 5m volume pulse ${candidate.volumePulse.toFixed(2)}x below buy floor`
    } else if ((candidate.fifteenMinuteMovePct ?? -1) < 0) {
      return 'reclaim tape is not turning up'
    }
  } else {
    if (!candidate.aboveVwap) return 'not holding 4h VWAP'
    if ((candidate.quoteVolume ?? 0) < MOMENTUM_RULES.crypto.minConfirmationQuoteVolume) {
      return `confirmation quote volume below $${Math.round(MOMENTUM_RULES.crypto.minConfirmationQuoteVolume / 1_000_000)}M`
    }
    if (candidate.volumePulse === null) return 'confirmation 5m volume pulse unavailable'
    if (candidate.volumePulse < 1.2) return `confirmation 5m volume pulse ${candidate.volumePulse.toFixed(2)}x below buy floor`
    if (candidate.spreadPct > 0.2) return `spread ${candidate.spreadPct.toFixed(3)}% over buy cap 0.2%`
  }

  const edge = targetEdgePct(candidate, trigger)
  const requiredEdge = candidate.assetClass === 'stock'
    ? Math.max(0.6, candidate.spreadPct + 0.06)
    : Math.max(0.45, candidate.spreadPct + 0.2)
  if (edge !== null && edge < requiredEdge) {
    return `target1 edge ${edge.toFixed(2)}% cannot clear execution costs`
  }

  return null
}

function requiredHolds(candidate: MomentumCandidate) {
  return candidate.assetClass === 'stock' ? STOCK_CONFIRM_HOLDS : CONFIRM_HOLDS
}

function requiredDwellMs(candidate: MomentumCandidate) {
  return candidate.assetClass === 'stock' ? STOCK_CONFIRM_DWELL_MS : CONFIRM_DWELL_MS
}

// Advance one candidate's state machine by a single observation.
function advance(rec: StateRecord, candidate: MomentumCandidate, now: number): StateRecord {
  rec.lastSeen = now
  const liveTrigger = candidate.signal.entryTrigger
  // Lock the trigger to the level present when the setup was first armed (or last
  // re-armed). The raw engine recomputes entryTrigger = max(price, high) * buffer
  // every 60s scan, so on a live move it ratchets the breakout line up just above
  // price every minute, making the "Wait > $X" goalpost run away from the user.
  // Freezing it here keeps a single, actionable level until a real reset.
  if (rec.triggerLevel === null) rec.triggerLevel = liveTrigger
  // Keep the locked level honest while we are still waiting (armed). After a real
  // run the high, and thus the raw trigger, can sit well above the level we first
  // locked; leaving it stale shows a "BUY ABOVE" below current price whose value
  // disagrees with the live stop/targets. Re-anchor only on a material rise, and
  // never once a break is being tagged (triggered/confirming/confirmed) so the
  // goalpost can't shift under an active entry.
  if (
    rec.phase === 'armed' &&
    liveTrigger !== null &&
    rec.triggerLevel !== null &&
    liveTrigger > rec.triggerLevel * TRIGGER_REANCHOR_RATIO
  ) {
    rec.triggerLevel = liveTrigger
  }
  const trigger = rec.triggerLevel
  // The raw scanner decides what is interesting; the radar BUY state only
  // advances when the same practical entry gates a human would need are also
  // clean: valid plan, fresh quote, trigger reached, sane spread/costs, and no
  // fading tape. Reversion intentionally bypasses the momentum VWAP rule and
  // instead requires the reclaim trigger and turning tape.
  const breakout = radarBuyBlocker(candidate, trigger) === null
  const stop = candidate.signal.stopLoss
  const hardInvalidated = stop !== null && candidate.price <= stop * STOP_TOLERANCE
  const price = candidate.price
  const holdsNeeded = requiredHolds(candidate)
  const dwellMs = requiredDwellMs(candidate)

  // An active cooldown after a failed break pins the phase to `failed`, even if
  // price momentarily re-qualifies, a fake break must not instantly re-trigger.
  if (rec.cooldownUntil && now < rec.cooldownUntil) {
    transition(rec, 'failed', now, price, 'cooling down after a failed break')
    return rec
  }

  switch (rec.phase) {
    case 'armed': {
      if (breakout) {
        transition(rec, 'triggered', now, price, 'trigger tagged, confirming the break holds')
        rec.triggeredAt = now
        rec.holds = 1
        rec.failStreak = 0
      }
      break
    }
    case 'triggered':
    case 'confirming': {
      // Losing the hard stop before confirming is an immediate, structural fail, 
      // the break is clearly dead, no need to wait it out.
      if (hardInvalidated) {
        transition(rec, 'failed', now, price, 'broke the stop before confirming, fake break')
        rec.failedAt = now
        rec.cooldownUntil = now + FAILED_COOLDOWN_MS
        rec.holds = 0
        rec.failStreak = 0
        break
      }
      if (breakout) {
        rec.failStreak = 0
        rec.holds += 1
        const heldLongEnough = now - rec.triggeredAt >= dwellMs
        if (rec.holds >= holdsNeeded && heldLongEnough) {
          transition(rec, 'confirmed', now, price, 'breakout held with VWAP support, confirmed')
          rec.confirmedAt = now
          rec.demoteStreak = 0
        } else {
          transition(rec, 'confirming', now, price, 'holding above the trigger with VWAP support')
        }
      } else {
        // A single soft miss (one wick under the trigger, one flickered score) is
        // NOT a failure, decay the hold count and keep waiting for it to reclaim.
        // Only a *streak* of misses means the break genuinely didn't hold. This is
        // the fix for "it said confirming, I went to buy, and it flipped to FAILED".
        rec.failStreak += 1
        rec.holds = Math.max(0, rec.holds - 1)
        if (rec.failStreak >= CONFIRM_FAIL_STREAK) {
          transition(rec, 'failed', now, price, 'pulled back under the trigger, the break did not hold')
          rec.failedAt = now
          rec.cooldownUntil = now + FAILED_COOLDOWN_MS
          rec.holds = 0
          rec.failStreak = 0
        } else {
          transition(rec, 'confirming', now, price, 'dipped under the trigger, waiting for it to reclaim')
        }
      }
      break
    }
    case 'confirmed': {
      // Confirmed is sticky: it stays a live buy until it actually loses the hard
      // stop (twice, for hysteresis) or sits quiet for a long time. It does NOT
      // "cool" back to WAIT just because a couple of minutes passed.
      if (hardInvalidated) {
        rec.demoteStreak += 1
        if (rec.demoteStreak >= DEMOTE_STREAK) {
          transition(rec, 'failed', now, price, 'lost the hard stop after confirmation')
          rec.failedAt = now
          rec.cooldownUntil = now + FAILED_COOLDOWN_MS
          rec.holds = 0
        }
      } else {
        rec.demoteStreak = 0
        const confirmedAt = rec.confirmedAt ?? rec.since
        if (!breakout && now - confirmedAt >= CONFIRMED_REARM_MS) {
          transition(rec, 'armed', now, price, 'confirmed setup went quiet; watching for a fresh break')
          rec.holds = 0
          rec.failStreak = 0
          rec.triggerLevel = liveTrigger // re-anchor to the current breakout level
        }
      }
      break
    }
    case 'failed': {
      // Cooldown has elapsed (guarded above), re-arm and re-anchor the trigger so
      // a fresh breakout builds from the current level.
      transition(rec, 'armed', now, price, 're-armed after cooldown')
      rec.holds = 0
      rec.demoteStreak = 0
      rec.failStreak = 0
      rec.triggerLevel = liveTrigger
      break
    }
  }

  return rec
}

function secondsLeft(untilMs: number, now: number) {
  return Math.max(1, Math.round((untilMs - now) / 1000))
}

function formatLevel(value: number | null) {
  return value === null ? 'the level' : `$${value}`
}

function confirmationContext(candidate: MomentumCandidate) {
  return isReversion(candidate) ? 'reversion reclaim structure' : 'VWAP support'
}

// What a *confirmed* setup means right now. Kept in one place so the copy
// (describe) and the actual BUY/WAIT shaping (applyPhase) can never disagree.
//   buy, live, actionable confirmed trigger
//   waiting, confirmed earlier, but the live buy gate is no longer clean
//   stop-risk, confirmed but price is sitting on the hard stop; manage/exit
//   extended, confirmed and already ran past the final target; don't chase
type ConfirmedMode = 'buy' | 'waiting' | 'stop-risk' | 'extended'
function confirmedMode(candidate: MomentumCandidate, lockedTrigger: number | null = candidate.signal.entryTrigger): ConfirmedMode {
  const stop = candidate.signal.stopLoss
  if (stop !== null && candidate.price <= stop * STOP_TOLERANCE) return 'stop-risk'
  const targetTwo = candidate.signal.targetTwo
  if (targetTwo !== null && candidate.price >= targetTwo) return 'extended'
  if (radarBuyBlocker(candidate, lockedTrigger) !== null) return 'waiting'
  return 'buy'
}

function describe(rec: StateRecord, candidate: MomentumCandidate, now: number): SignalStability {
  const trigger = rec.triggerLevel ?? candidate.signal.entryTrigger
  const triggerText = trigger === null ? 'the trigger' : `$${trigger}`
  const holdsNeeded = requiredHolds(candidate)
  const context = confirmationContext(candidate)
  let label: string
  let detail: string

  switch (rec.phase) {
    case 'triggered':
      label = 'Triggered'
      detail = `Price tagged ${triggerText}. Confirming the break holds (1/${holdsNeeded}).`
      break
    case 'confirming': {
      const held = Math.max(rec.holds, 1)
      label = `Confirming ${Math.min(held, holdsNeeded)}/${holdsNeeded}`
      detail =
        rec.failStreak > 0
          ? `Dipped under ${triggerText}, giving it room to reclaim before this is a buy.`
          : `Holding above ${triggerText} with ${context}, needs to keep holding before it is a buy.`
      break
    }
    case 'confirmed': {
      const heldSecs = rec.confirmedAt ? Math.max(1, Math.round((now - rec.triggeredAt) / 1000)) : null
      const mode = confirmedMode(candidate, trigger)
      if (mode === 'stop-risk') {
        label = 'Confirmed · stop risk'
        detail = `Confirmed earlier but price is back on the stop near ${formatLevel(candidate.signal.stopLoss)}. If you are in, manage the stop; this is not a fresh buy.`
      } else if (mode === 'extended') {
        label = 'Confirmed · extended'
        detail = `Already ran to the final target ${formatLevel(candidate.signal.targetTwo)}. Manage the trade you have, don't start a new chase up here.`
      } else if (mode === 'waiting') {
        label = 'Confirmed · waiting'
        detail = `Confirmed earlier, but buy gate is holding: ${radarBuyBlocker(candidate, trigger)}.`
      } else {
        label = 'Confirmed · buy'
        detail = heldSecs
          ? `Trigger held above ${triggerText} with ${context} for ~${heldSecs}s. Entry zone is live while it holds the stop.`
          : `Trigger held above ${triggerText} with ${context}. Entry zone is live while it holds the stop.`
      }
      break
    }
    case 'failed': {
      const cd = rec.cooldownUntil && now < rec.cooldownUntil ? ` Re-arming in ~${secondsLeft(rec.cooldownUntil, now)}s.` : ''
      label = 'Failed break'
      detail = `Tagged ${triggerText} then fell back, treat as a fake break, not a buy.${cd}`
      break
    }
    default:
      label = 'Armed'
      detail =
        candidate.status === 'CHECK NOW'
          ? `Raw trigger is present, but buy gate is holding: ${radarBuyBlocker(candidate, trigger)}.`
          : isReversion(candidate)
            ? `Watching for a clean reclaim above ${triggerText} back toward VWAP.`
            : `Watching for a clean break above ${triggerText} with VWAP support.`
      break
  }

  return {
    phase: rec.phase,
    label,
    detail,
    since: new Date(rec.since).toISOString(),
    holds: rec.holds,
    holdsNeeded,
    confirmedAt: rec.confirmedAt ? new Date(rec.confirmedAt).toISOString() : null,
    failedAt: rec.failedAt ? new Date(rec.failedAt).toISOString() : null,
    cooldownUntil: rec.cooldownUntil && now < rec.cooldownUntil ? new Date(rec.cooldownUntil).toISOString() : null,
    history: rec.history.slice(-HISTORY_LIMIT),
  }
}

// Re-shape a candidate so only a `confirmed` phase can present as CHECK NOW/BUY.
// Every other phase is pinned to WATCH (the row stays visible as context, just
// never as a buy), and the rich phase data rides along on `signalPhase`.
function applyPhase(candidate: MomentumCandidate, rec: StateRecord, now: number): MomentumCandidate {
  const stability = describe(rec, candidate, now)
  // Trigger locking is a breakout concept, it stops the high-of-day goalpost from
  // running away. A stock micro-pullback's trigger is the pause high and is *meant*
  // to track live, so for those pass the live (already micro-synced) trigger through
  // instead of the locked level; otherwise the locked breakout trigger applies.
  const isMicroSetup =
    candidate.assetClass === 'stock' &&
    (candidate.microPullback?.state === 'FORMING' || candidate.microPullback?.state === 'READY')
  const lockedTrigger = isMicroSetup
    ? candidate.signal.entryTrigger
    : rec.triggerLevel ?? candidate.signal.entryTrigger

  if (rec.phase === 'confirmed') {
    // Sticky: a confirmed setup stays an actionable BUY until it actually loses
    // the stop ("stop-risk") or has already run past the final target
    // ("extended"). It is no longer demoted to WAIT just because time passed.
    const mode = confirmedMode(candidate, lockedTrigger)
    const activeBuyWindow = mode === 'buy'
    return {
      ...candidate,
      status: activeBuyWindow ? 'CHECK NOW' : 'WATCH',
      signal: {
        ...candidate.signal,
        action: activeBuyWindow ? 'BUY' : 'WAIT',
        label: activeBuyWindow
          ? 'BUY · CONFIRMED'
          : mode === 'extended'
            ? 'TARGET HIT'
            : mode === 'stop-risk'
              ? 'STOP RISK'
              : isReversion(candidate)
                ? 'WAIT FOR RECLAIM'
                : 'WAIT FOR TRIGGER',
        entryTrigger: lockedTrigger,
      },
      signalPhase: stability,
    }
  }

  // Hold back any raw CHECK NOW that has not yet confirmed: downgrade to WATCH
  // and present the WAIT plan so the UI cannot read as an actionable buy.
  const downgradeFromBuy = candidate.status === 'CHECK NOW'
  return {
    ...candidate,
    status: 'WATCH',
    signal: downgradeFromBuy
      ? {
          ...candidate.signal,
          action: 'WAIT',
          label: rec.phase === 'failed' ? 'FAILED BREAK' : 'CONFIRMING',
          entryTrigger: lockedTrigger,
        }
      : { ...candidate.signal, entryTrigger: lockedTrigger },
    signalPhase: stability,
  }
}

function prune(now: number, seen: Set<string>) {
  for (const [ticker, rec] of records) {
    if (!seen.has(ticker) && now - rec.lastSeen > STALE_RECORD_MS) records.delete(ticker)
  }
}

// Apply the confirmation state machine to a list of radar candidates. Actionable
// setups (WATCH / CHECK NOW) advance their state and gain a `signalPhase`;
// IGNORE / DATA ERROR rows are passed through untouched and their state cleared.
export function applySignalStability(candidates: MomentumCandidate[], now = new Date()): MomentumCandidate[] {
  const nowMs = now.getTime()
  const seen = new Set<string>()

  const out = candidates.map((candidate) => {
    const actionable = candidate.status === 'WATCH' || candidate.status === 'CHECK NOW'
    if (!actionable) {
      records.delete(candidate.ticker)
      return candidate
    }
    seen.add(candidate.ticker)
    const rec = advance(records.get(candidate.ticker) ?? freshRecord(nowMs, candidate.signal.entryTrigger), candidate, nowMs)
    records.set(candidate.ticker, rec)
    return applyPhase(candidate, rec, nowMs)
  })

  prune(nowMs, seen)
  return out
}

// Test/utility hook, clears all confirmation memory.
export function resetSignalStability() {
  records.clear()
}
