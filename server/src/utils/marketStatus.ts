// US stock market status detection (Eastern Time)
// Regular hours: Mon-Fri 9:30 AM - 4:00 PM ET
// Pre-market: 4:00 AM - 9:30 AM ET
// After-hours: 4:00 PM - 8:00 PM ET

export type MarketStatus = 'open' | 'pre-market' | 'after-hours' | 'overnight' | 'weekend'

export interface MarketInfo {
  status: MarketStatus
  isOpen: boolean
  label: string
  description: string
  nextOpenISO: string | null   // UTC ISO string of next 9:30 AM ET open
  hoursUntilOpen: number | null
}

// Returns ET components AND the et-to-utc offset in ms
function getETComponents(now: Date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  })

  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(now)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }

  const year = parseInt(parts.year)
  const month = parseInt(parts.month) - 1  // 0-indexed
  const day = parseInt(parts.day)
  const hour = parseInt(parts.hour) % 24   // hour12:false can return 24 at midnight
  const minute = parseInt(parts.minute)
  const second = parseInt(parts.second)

  // ET wall-clock time as a "fake local" Date (no timezone info)
  const etLocal = new Date(year, month, day, hour, minute, second, 0)

  // ET offset from UTC: how many ms to ADD to ET local to get UTC
  const etOffsetMs = now.getTime() - etLocal.getTime()

  return {
    year, month, day, hour, minute, second,
    dayOfWeek: etLocal.getDay(),
    totalMinutes: hour * 60 + minute,
    etLocal,
    etOffsetMs,
  }
}

// Returns UTC Date of next 9:30 AM ET open on a weekday
function nextMarketOpenUTC(now: Date): Date {
  const { day, month, year, etLocal, etOffsetMs } = getETComponents(now)

  // Candidate: today at 9:30 AM ET (as fake local)
  const candidate = new Date(year, month, day, 9, 30, 0, 0)

  // If we're at or past 9:30 ET, advance to next day
  if (etLocal >= candidate) {
    candidate.setDate(candidate.getDate() + 1)
    candidate.setHours(9, 30, 0, 0)
  }

  // Skip weekends
  while (candidate.getDay() === 0 || candidate.getDay() === 6) {
    candidate.setDate(candidate.getDate() + 1)
    candidate.setHours(9, 30, 0, 0)
  }

  // Convert ET fake-local back to real UTC
  return new Date(candidate.getTime() + etOffsetMs)
}

export function getMarketStatus(now = new Date()): MarketInfo {
  const { dayOfWeek, totalMinutes } = getETComponents(now)

  const OPEN = 9 * 60 + 30   // 9:30 AM
  const CLOSE = 16 * 60      // 4:00 PM
  const PRE = 4 * 60         // 4:00 AM (pre-market start)
  const POST = 20 * 60       // 8:00 PM (after-hours end)

  const makeResult = (
    status: MarketStatus,
    label: string,
    description: string,
    includeNextOpen: boolean
  ): MarketInfo => {
    if (!includeNextOpen) {
      return { status, isOpen: true, label, description, nextOpenISO: null, hoursUntilOpen: null }
    }
    const nextOpenUTC = nextMarketOpenUTC(now)
    const hoursUntilOpen = Math.round((nextOpenUTC.getTime() - now.getTime()) / (1000 * 60 * 60) * 10) / 10
    return {
      status,
      isOpen: false,
      label,
      description,
      nextOpenISO: nextOpenUTC.toISOString(),
      hoursUntilOpen,
    }
  }

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    const nextOpenUTC = nextMarketOpenUTC(now)
    const hours = Math.round((nextOpenUTC.getTime() - now.getTime()) / (1000 * 60 * 60) * 10) / 10
    return {
      status: 'weekend',
      isOpen: false,
      label: 'Weekend',
      description: `Market closed. DEX prices may drift from Friday close. ${hours}h until Monday open.`,
      nextOpenISO: nextOpenUTC.toISOString(),
      hoursUntilOpen: hours,
    }
  }

  if (totalMinutes >= OPEN && totalMinutes < CLOSE) {
    return makeResult('open', 'Market Open', 'Live trading in progress. Oracle prices updating in real-time.', false)
  }

  if (totalMinutes >= PRE && totalMinutes < OPEN) {
    return makeResult('pre-market', 'Pre-Market', 'Pre-market session (4AM–9:30AM ET). Limited liquidity on DEX.', true)
  }

  if (totalMinutes >= CLOSE && totalMinutes < POST) {
    return makeResult('after-hours', 'After Hours', 'After-hours trading (4PM–8PM ET). Watch for DEX price gaps.', true)
  }

  return makeResult('overnight', 'Closed', 'Market closed overnight. Check DEX deviations before open.', true)
}
