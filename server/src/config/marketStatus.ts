/**
 * US Market Status & NAV Freshness Module
 *
 * Provides market open/close awareness for RWA-specific risk assessment.
 * Not a prediction engine — simply measures "how stale is the current NAV"
 * and whether the traditional market is active.
 *
 * Production upgrade path: replace hardcoded calendar with a market data API.
 */

// ─── US Market Hours (Eastern Time) ─────────────────────────────────────────

const MARKET_OPEN_HOUR = 9   // 9:30 AM ET
const MARKET_OPEN_MIN  = 30
const MARKET_CLOSE_HOUR = 16 // 4:00 PM ET
const MARKET_CLOSE_MIN  = 0

// US holidays 2026 (NYSE closed)
const US_HOLIDAYS_2026 = new Set([
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas
])

export interface MarketStatusResult {
  isOpen: boolean
  status: 'open' | 'closed' | 'pre_market' | 'after_hours'
  reason: string              // Human-readable reason
  nextOpenAt: string | null   // ISO timestamp of next market open (null if open now)
  closedSinceHours: number    // Hours since last close (0 if open)
  timezone: string
}

export interface FreshnessResult {
  freshnessScore: number      // 0.0 (very stale) to 1.0 (fresh)
  navAgeSeconds: number       // Seconds since last NAV update
  navAgeLabel: string         // Human-readable e.g. "2h 15m ago"
  marketStatus: MarketStatusResult
  gapRiskLevel: 'none' | 'low' | 'medium' | 'high'
  gapRiskLabel: string
}

/**
 * Get current ET time components
 */
function getETTime(now?: Date): { year: number; month: number; day: number; hour: number; min: number; dayOfWeek: number; dateStr: string } {
  const d = now ?? new Date()
  // Convert to Eastern Time
  const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York' })
  const et = new Date(etStr)
  const year = et.getFullYear()
  const month = et.getMonth() + 1
  const day = et.getDate()
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return {
    year, month, day,
    hour: et.getHours(),
    min: et.getMinutes(),
    dayOfWeek: et.getDay(), // 0=Sun, 6=Sat
    dateStr,
  }
}

/**
 * Check if US market is currently open
 */
export function getMarketStatus(now?: Date): MarketStatusResult {
  const et = getETTime(now)
  const { hour, min, dayOfWeek, dateStr } = et

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  const isHoliday = US_HOLIDAYS_2026.has(dateStr)
  const timeMinutes = hour * 60 + min
  const openMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MIN
  const closeMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MIN

  if (isWeekend) {
    const hoursFromFriClose = dayOfWeek === 6
      ? (timeMinutes - closeMinutes) / 60
      : 24 + (timeMinutes - closeMinutes) / 60 // Sunday: 24h + time from 4pm
    return {
      isOpen: false,
      status: 'closed',
      reason: `Weekend — US market closed since Friday 4:00 PM ET`,
      nextOpenAt: null, // simplified
      closedSinceHours: Math.max(0, hoursFromFriClose + (dayOfWeek === 0 ? 24 : 0)),
      timezone: 'America/New_York',
    }
  }

  if (isHoliday) {
    return {
      isOpen: false,
      status: 'closed',
      reason: `US holiday — NYSE closed today`,
      nextOpenAt: null,
      closedSinceHours: Math.max(0, (timeMinutes - closeMinutes) / 60),
      timezone: 'America/New_York',
    }
  }

  if (timeMinutes < openMinutes) {
    return {
      isOpen: false,
      status: 'pre_market',
      reason: `Pre-market — NYSE opens at 9:30 AM ET`,
      nextOpenAt: null,
      closedSinceHours: (24 * 60 - closeMinutes + timeMinutes) / 60,
      timezone: 'America/New_York',
    }
  }

  if (timeMinutes >= closeMinutes) {
    return {
      isOpen: false,
      status: 'after_hours',
      reason: `After hours — NYSE closed at 4:00 PM ET`,
      nextOpenAt: null,
      closedSinceHours: (timeMinutes - closeMinutes) / 60,
      timezone: 'America/New_York',
    }
  }

  return {
    isOpen: true,
    status: 'open',
    reason: `US market open — live NAV updates`,
    nextOpenAt: null,
    closedSinceHours: 0,
    timezone: 'America/New_York',
  }
}

/**
 * Calculate NAV freshness score
 *
 * freshnessScore decays from 1.0 to 0.0 based on:
 * - Time since last NAV update (navAgeSeconds)
 * - Whether market is open/closed
 *
 * Decay function:
 * - During open market: score stays 1.0 if NAV updated within 5 min
 * - After close: begins slow decay (half-life ~6 hours)
 * - Weekend: continues decay, floors at 0.15 (NAV is technically valid, just old)
 */
export function calculateFreshness(
  lastNavUpdateTimestamp: number | null, // Unix timestamp (seconds)
  now?: Date,
): FreshnessResult {
  const currentTime = now ?? new Date()
  const market = getMarketStatus(currentTime)

  // Default: if no NAV timestamp, assume very stale
  if (!lastNavUpdateTimestamp) {
    return {
      freshnessScore: 0.2,
      navAgeSeconds: 999999,
      navAgeLabel: 'unknown',
      marketStatus: market,
      gapRiskLevel: 'high',
      gapRiskLabel: 'No NAV update timestamp available — price data may be significantly outdated',
    }
  }

  const nowSec = Math.floor(currentTime.getTime() / 1000)
  const ageSec = Math.max(0, nowSec - lastNavUpdateTimestamp)
  const ageHours = ageSec / 3600

  // Freshness decay: exponential with half-life of 6 hours
  // score = max(0.15, e^(-0.1155 * ageHours))
  // 0.1155 = ln(2)/6  (half-life = 6 hours)
  const rawScore = Math.exp(-0.1155 * ageHours)
  const freshnessScore = Math.max(0.15, Math.min(1.0, rawScore))

  // If market is open and NAV is fresh (<5min), boost to 1.0
  const boostedScore = (market.isOpen && ageSec < 300) ? 1.0 : freshnessScore

  // Nav age label
  let navAgeLabel: string
  if (ageSec < 60) navAgeLabel = 'just now'
  else if (ageSec < 3600) navAgeLabel = `${Math.floor(ageSec / 60)}m ago`
  else if (ageSec < 86400) navAgeLabel = `${Math.floor(ageHours)}h ${Math.floor((ageSec % 3600) / 60)}m ago`
  else navAgeLabel = `${Math.floor(ageHours / 24)}d ${Math.floor(ageHours % 24)}h ago`

  // Gap risk assessment
  let gapRiskLevel: 'none' | 'low' | 'medium' | 'high'
  let gapRiskLabel: string

  if (market.isOpen && ageSec < 300) {
    gapRiskLevel = 'none'
    gapRiskLabel = 'Market open, NAV live — minimal gap risk'
  } else if (market.isOpen && ageSec < 1800) {
    gapRiskLevel = 'low'
    gapRiskLabel = `Market open but NAV is ${navAgeLabel} — slight staleness`
  } else if (!market.isOpen && ageHours < 16) {
    gapRiskLevel = 'low'
    gapRiskLabel = `Market closed (${market.reason}) — NAV from ${navAgeLabel}, next update at open`
  } else if (!market.isOpen && ageHours < 48) {
    gapRiskLevel = 'medium'
    gapRiskLabel = `Market closed ${market.closedSinceHours.toFixed(0)}h — NAV ${navAgeLabel}, moderate gap risk at next open`
  } else {
    gapRiskLevel = 'high'
    gapRiskLabel = `NAV is ${navAgeLabel} — significant price uncertainty, gap risk is elevated`
  }

  return {
    freshnessScore: Number(boostedScore.toFixed(3)),
    navAgeSeconds: ageSec,
    navAgeLabel,
    marketStatus: market,
    gapRiskLevel,
    gapRiskLabel,
  }
}
