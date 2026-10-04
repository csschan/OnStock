/**
 * RWA Issuer & Pool Health Labels
 *
 * Standardized metadata for RWA-specific risk dimensions that
 * generic DEX routers (1inch, Paraswap) completely ignore:
 *
 * - Issuer verification status & audit history
 * - Pool age & depth health
 * - Known warning flags
 *
 * Production upgrade: these labels would be pulled from an on-chain
 * registry or off-chain API. For demo, hardcoded is fine.
 */

export interface IssuerProfile {
  id: string
  name: string
  verified: boolean         // Known, audited, regulated issuer?
  regulatedEntity: boolean  // Is the issuer a regulated financial entity?
  custodian: string         // Who custodies the underlying asset
  auditFrequency: string    // 'daily' | 'monthly' | 'quarterly' | 'none'
  navSource: string         // Where NAV comes from
  warningFlags: string[]    // Known issues
  trustScore: number        // 0.0–1.0 composite trust metric
}

export const ISSUER_PROFILES: Record<string, IssuerProfile> = {
  ondo: {
    id: 'ondo',
    name: 'Ondo Finance',
    verified: true,
    regulatedEntity: true,
    custodian: 'Ankura Trust',
    auditFrequency: 'daily',
    navSource: 'Ondo Oracle (Chainlink-compatible)',
    warningFlags: [],
    trustScore: 0.92,
  },
  backed: {
    id: 'backed',
    name: 'Backed Finance (xStocks)',
    verified: true,
    regulatedEntity: true,
    custodian: 'Backed Assets GmbH (Swiss regulated)',
    auditFrequency: 'daily',
    navSource: 'Backed Oracle / Chainlink',
    warningFlags: [],
    trustScore: 0.88,
  },
  dinari: {
    id: 'dinari',
    name: 'Dinari',
    verified: true,
    regulatedEntity: true,
    custodian: 'Alpaca Securities',
    auditFrequency: 'daily',
    navSource: 'Dinari Oracle (real-time broker feed)',
    warningFlags: [],
    trustScore: 0.85,
  },
  binance: {
    id: 'binance',
    name: 'Binance bStocks',
    verified: true,
    regulatedEntity: false, // Binance tokenized stocks are not directly regulated securities
    custodian: 'CM-Equity AG (partner)',
    auditFrequency: 'monthly',
    navSource: 'Binance internal feed',
    warningFlags: [
      'Some jurisdictions restrict access to Binance stock tokens',
      'Monthly audit frequency — NAV verification less frequent than competitors',
    ],
    trustScore: 0.72,
  },
  robinhood: {
    id: 'robinhood',
    name: 'Robinhood Chain',
    verified: true,
    regulatedEntity: true,
    custodian: 'Robinhood Financial LLC (FINRA/SIPC)',
    auditFrequency: 'daily',
    navSource: 'Robinhood price API (real-time)',
    warningFlags: [],
    trustScore: 0.90,
  },
  prestocks: {
    id: 'prestocks',
    name: 'PreStocks',
    verified: false,
    regulatedEntity: false,
    custodian: 'None (synthetic exposure)',
    auditFrequency: 'none',
    navSource: 'PreStocks mark price (no independent audit)',
    warningFlags: [
      'Pre-IPO tokens — synthetic exposure, not backed by real shares',
      'No independent audit or NAV verification',
      'Liquidity may be very thin — high slippage risk',
    ],
    trustScore: 0.35,
  },
}

// ─── Pool Health Assessment ─────────────────────────────────────────────────

export interface PoolHealthLabel {
  tvlCategory: 'deep' | 'moderate' | 'thin' | 'empty'
  tvlUsd: number
  volume24h: number
  poolAgeCategory: 'mature' | 'established' | 'new' | 'unknown'
  healthScore: number       // 0.0–1.0
  warningFlags: string[]
}

export function assessPoolHealth(
  tvlUsd: number,
  volume24h: number = 0,
  poolCreatedDaysAgo: number = 90, // default to "established" if unknown
): PoolHealthLabel {
  // TVL categorization
  let tvlCategory: PoolHealthLabel['tvlCategory']
  if (tvlUsd >= 500_000) tvlCategory = 'deep'
  else if (tvlUsd >= 50_000) tvlCategory = 'moderate'
  else if (tvlUsd > 0) tvlCategory = 'thin'
  else tvlCategory = 'empty'

  // Pool age
  let poolAgeCategory: PoolHealthLabel['poolAgeCategory']
  if (poolCreatedDaysAgo >= 180) poolAgeCategory = 'mature'
  else if (poolCreatedDaysAgo >= 30) poolAgeCategory = 'established'
  else if (poolCreatedDaysAgo >= 0) poolAgeCategory = 'new'
  else poolAgeCategory = 'unknown'

  // Health score composite
  const tvlScore = Math.min(1.0, tvlUsd / 500_000)
  const volumeScore = Math.min(1.0, volume24h / 50_000)
  const ageScore = Math.min(1.0, poolCreatedDaysAgo / 180)
  const healthScore = Number((tvlScore * 0.5 + volumeScore * 0.3 + ageScore * 0.2).toFixed(3))

  // Warning flags
  const warningFlags: string[] = []
  if (tvlCategory === 'thin') warningFlags.push('Pool TVL is thin — large orders may cause significant slippage')
  if (tvlCategory === 'empty') warningFlags.push('Pool has no liquidity — trade execution will fail')
  if (poolAgeCategory === 'new') warningFlags.push('Pool is less than 30 days old — limited price history')
  if (volume24h < 1000 && tvlUsd > 0) warningFlags.push('Very low 24h trading volume — potential exit liquidity concern')

  return { tvlCategory, tvlUsd, volume24h, poolAgeCategory, healthScore, warningFlags }
}

/**
 * Get issuer profile for a given issuer ID
 */
export function getIssuerProfile(issuerId: string): IssuerProfile {
  return ISSUER_PROFILES[issuerId] ?? {
    id: issuerId,
    name: issuerId,
    verified: false,
    regulatedEntity: false,
    custodian: 'Unknown',
    auditFrequency: 'none',
    navSource: 'Unknown',
    warningFlags: ['Unknown issuer — exercise caution'],
    trustScore: 0.2,
  }
}
