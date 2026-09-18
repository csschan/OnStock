'use client'

import { useAccount, useReadContracts } from 'wagmi'
import { erc20Abi, formatUnits, parseAbi } from 'viem'
import { useMemo, useState, useEffect } from 'react'
import { Wallet, TrendingUp, TrendingDown, ArrowUpRight, Vault } from 'lucide-react'
import type { FlatInstrument } from '@/lib/api'
type TrackedInstrument = FlatInstrument
import BuyFlow from '@/components/BuyFlow'
import { usePhantom } from '@/components/PhantomProvider'

// X Layer vault addresses + APY
const XLAYER_VAULTS = [
  { symbol: 'TSLAx',  name: 'Tesla',         address: '0x5903bfd01B729d37CaA742709Ec1BA036d483931' as `0x${string}`, apyPct: 4.20 },
  { symbol: 'NVDAx',  name: 'NVIDIA',        address: '0x244ECAc0d3458866d07B1E9e842F2b7dF00520AA' as `0x${string}`, apyPct: 4.20 },
  { symbol: 'SPYx',   name: 'S&P 500',       address: '0x339B7dC6A641A1F8393724528B56ea50E1d149e4' as `0x${string}`, apyPct: 3.80 },
  { symbol: 'AAPLx',  name: 'Apple',         address: '0xF2dB6823ae8cc56fa9eDf5D306960147CeB3e1ac' as `0x${string}`, apyPct: 4.20 },
  { symbol: 'GOOGLx', name: 'Google',        address: '0x5C1e6aC2cB991d2292d9ee01C0D3076aC99267cD' as `0x${string}`, apyPct: 4.20 },
  { symbol: 'METAx',  name: 'Meta',          address: '0xc0d75D94173bbfD8fe57eBF90011547bE815923D' as `0x${string}`, apyPct: 4.20 },
  { symbol: 'COINx',  name: 'Coinbase',      address: '0x1CF4212B49E4C966df7A0215d9d5c95086191BEF' as `0x${string}`, apyPct: 5.50 },
  { symbol: 'MSTRx',  name: 'MicroStrategy', address: '0x8841c470dD56d63D8e37868536fF42ACb4663584' as `0x${string}`, apyPct: 5.50 },
]

const VAULT_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
])

const XLAYER_CHAIN_ID = 195

interface XLayerVaultPos {
  symbol: string
  name: string
  address: string
  shares: number
  nav: number       // assets per share
  value: number     // shares * nav (in token units)
  apyPct: number
}

function useXLayerVaultPositions(evmAddress: `0x${string}` | undefined) {
  const contracts = useMemo(() => {
    if (!evmAddress) return []
    return XLAYER_VAULTS.flatMap(v => [
      { address: v.address, abi: VAULT_ABI, functionName: 'balanceOf' as const, args: [evmAddress], chainId: XLAYER_CHAIN_ID },
      { address: v.address, abi: VAULT_ABI, functionName: 'totalAssets' as const, chainId: XLAYER_CHAIN_ID },
      { address: v.address, abi: VAULT_ABI, functionName: 'totalSupply' as const, chainId: XLAYER_CHAIN_ID },
    ])
  }, [evmAddress])

  const { data, isLoading } = useReadContracts({ contracts, query: { enabled: !!evmAddress } })

  const positions: XLayerVaultPos[] = useMemo(() => {
    if (!data) return []
    const result: XLayerVaultPos[] = []
    for (let i = 0; i < XLAYER_VAULTS.length; i++) {
      const v = XLAYER_VAULTS[i]
      const base = i * 3
      const sharesRaw = data[base]?.status === 'success' ? (data[base].result as bigint) : 0n
      const totalAssetsRaw = data[base + 1]?.status === 'success' ? (data[base + 1].result as bigint) : 0n
      const totalSupplyRaw = data[base + 2]?.status === 'success' ? (data[base + 2].result as bigint) : 0n
      const shares = Number(formatUnits(sharesRaw, 18))
      if (shares < 0.000001) continue
      const nav = totalSupplyRaw > 0n
        ? Number(formatUnits(totalAssetsRaw, 18)) / Number(formatUnits(totalSupplyRaw, 18))
        : 1.0
      result.push({ symbol: v.symbol, name: v.name, address: v.address, shares, nav, value: shares * nav, apyPct: v.apyPct })
    }
    return result
  }, [data])

  return { positions, isLoading }
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

interface VaultPos {
  asset: string
  vaultPda: string
  receiptMint: string
  userShares: number
  depositedAmount: number
  currentValue: number
  nav: number
  pnl: number
  depositedAt: string | null
}

function useVaultPositions(solanaWallet: string | null) {
  const [positions, setPositions] = useState<VaultPos[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!solanaWallet) { setPositions([]); return }
    setLoading(true)
    fetch(`${API_BASE}/earn/vault/positions?wallet=${solanaWallet}`)
      .then(r => r.json())
      .then(j => { if (j.ok) setPositions(j.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [solanaWallet])

  return { positions, loading }
}

const CHAIN_COLORS: Record<number, string> = {
  1: '#627EEA',
  56: '#F0B90B',
  8453: '#0052FF',
  42161: '#28A0F0',
  4663: '#00C805',
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  56: 'BNB Chain',
  8453: 'Base',
  42161: 'Arbitrum',
  4663: 'Robinhood',
}

interface HoldingRow {
  instrument: TrackedInstrument
  balance: number       // token units
  valueUsd: number      // balance × price
  pnlPct: number | null // vs oracle price
}

export default function PortfolioView({ instruments }: { instruments: TrackedInstrument[] }) {
  const { address, isConnected } = useAccount()
  const [selling, setSelling] = useState<TrackedInstrument | null>(null)
  const [buying, setBuying] = useState<TrackedInstrument | null>(null)
  const { publicKey: solanaPubkey } = usePhantom()
  const solanaWallet = solanaPubkey?.toBase58() ?? null
  const { positions: vaultPositions, loading: vaultLoading } = useVaultPositions(solanaWallet)
  const { positions: xlayerPositions, isLoading: xlayerLoading } = useXLayerVaultPositions(address)

  // Build multicall contracts list — balanceOf(address) for every instrument
  const contracts = useMemo(() => {
    if (!address) return []
    return instruments.map(inst => ({
      address: inst.contractAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [address] as const,
      chainId: inst.chainId,
    }))
  }, [address, instruments])

  const { data: balances, isLoading } = useReadContracts({
    contracts,
    query: { enabled: !!address },
  })

  // Compute holdings where balance > 0
  const holdings: HoldingRow[] = useMemo(() => {
    if (!balances) return []
    const rows: HoldingRow[] = []
    for (let i = 0; i < instruments.length; i++) {
      const result = balances[i]
      if (result?.status !== 'success' || !result.result) continue
      const rawBalance = result.result as bigint
      if (rawBalance === 0n) continue

      const inst = instruments[i]
      const balance = Number(formatUnits(rawBalance, inst.decimals))
      if (balance < 0.000001) continue

      const price = inst.price ?? inst.marketPrice ?? 0
      const valueUsd = balance * price

      const pnlPct = inst.premiumPct  // positive = we're holding at premium

      rows.push({ instrument: inst, balance, valueUsd, pnlPct })
    }
    // Sort by USD value descending
    return rows.sort((a, b) => b.valueUsd - a.valueUsd)
  }, [balances, instruments])

  // Group by canonical asset
  const grouped = useMemo(() => {
    const map = new Map<string, HoldingRow[]>()
    for (const h of holdings) {
      const key = h.instrument.assetTicker
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(h)
    }
    return map
  }, [holdings])

  const totalValueUsd = holdings.reduce((s, h) => s + h.valueUsd, 0)
  const xlayerVaultTotalValue = xlayerPositions.reduce((s, p) => s + p.value, 0)
  const solanaVaultTotalValue = vaultPositions.reduce((s, p) => s + p.currentValue, 0)
  const crossChainNav = totalValueUsd + xlayerVaultTotalValue + solanaVaultTotalValue

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 bg-[#F1F5F9] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Wallet className="w-8 h-8 text-[#94A3B8]" />
        </div>
        <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Portfolio</h1>
        <p className="text-[#64748B] mb-6">Connect your wallet to see your tokenized stock holdings.</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Portfolio</h1>
          <p className="text-sm text-[#94A3B8] mt-0.5">
            {address?.slice(0, 6)}…{address?.slice(-4)} · {holdings.length} token positions
          </p>
        </div>
      </div>

      {/* Cross-chain NAV summary */}
      {(crossChainNav > 0 || xlayerPositions.length > 0 || vaultPositions.length > 0) && (
        <div style={{
          background: '#0F172A', borderRadius: 16, padding: '16px 20px',
          marginBottom: 24, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }}>
              CROSS-CHAIN PORTFOLIO NAV
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#14F195', fontFamily: 'monospace' }}>
              ${crossChainNav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {totalValueUsd > 0 && (
              <div style={{ background: '#1E293B', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>EVM Holdings</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>
                  ${totalValueUsd.toFixed(0)}
                </div>
              </div>
            )}
            {solanaVaultTotalValue > 0 && (
              <div style={{ background: '#1E293B', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>◎ Solana Vaults</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#14F195', fontFamily: 'monospace' }}>
                  {solanaVaultTotalValue.toFixed(4)}
                </div>
              </div>
            )}
            {xlayerVaultTotalValue > 0 && (
              <div style={{ background: '#1E1B4B', borderRadius: 10, padding: '10px 14px', textAlign: 'center', border: '1px solid #6366F133' }}>
                <div style={{ fontSize: 10, color: '#A5B4FC', marginBottom: 2 }}>⬡ X Layer Vaults</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#8B5CF6', fontFamily: 'monospace' }}>
                  {xlayerVaultTotalValue.toFixed(4)}
                </div>
              </div>
            )}
            {(xlayerPositions.length > 0 || vaultPositions.length > 0) && (
              <div style={{ background: '#1E293B', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>Est. APY</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#34D399', fontFamily: 'monospace' }}>
                  {xlayerPositions.length > 0
                    ? (xlayerPositions.reduce((s, p) => s + p.apyPct * p.value, 0) / (xlayerVaultTotalValue || 1)).toFixed(1)
                    : '4.2'}%
                </div>
              </div>
            )}
          </div>
          {!solanaWallet && (
            <div style={{ fontSize: 11, color: '#F59E0B', background: '#92400E20', borderRadius: 8, padding: '6px 10px' }}>
              ⚠ Connect Phantom to include Solana vault positions
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 gap-2 text-[#94A3B8]">
          <div className="w-5 h-5 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Reading balances across chains…</span>
        </div>
      )}

      {/* No holdings */}
      {!isLoading && holdings.length === 0 && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl py-20 text-center">
          <div className="w-14 h-14 bg-[#F1F5F9] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Wallet className="w-7 h-7 text-[#CBD5E1]" />
          </div>
          <p className="font-medium text-[#0F172A] mb-1">No tokenized stock holdings found</p>
          <p className="text-sm text-[#94A3B8] mb-6">Buy your first position to see it here.</p>
          <a
            href="/"
            className="inline-flex items-center gap-2 bg-[#2563EB] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#1D4ED8] transition-colors"
          >
            Browse Markets
          </a>
        </div>
      )}

      {/* Holdings grouped by asset */}
      {!isLoading && holdings.length > 0 && (
        <div className="space-y-4">
          {[...grouped.entries()].map(([assetTicker, rows]) => {
            const totalAssetValue = rows.reduce((s, r) => s + r.valueUsd, 0)
            const assetName = rows[0].instrument.assetName
            const marketPrice = rows[0].instrument.marketPrice

            return (
              <div key={assetTicker} className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
                {/* Asset header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#F1F5F9]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#EFF6FF] rounded-xl flex items-center justify-center">
                      <span className="font-bold text-sm text-[#2563EB]">{assetTicker}</span>
                    </div>
                    <div>
                      <a href={`/asset/${assetTicker}`} className="font-semibold text-[#0F172A] hover:text-[#2563EB] flex items-center gap-1 text-sm">
                        {assetName} <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                      {marketPrice && (
                        <p className="text-xs text-[#94A3B8]">Market ${marketPrice.toFixed(2)}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-[#0F172A]">
                      ${totalAssetValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-[#94A3B8]">{rows.length} position{rows.length > 1 ? 's' : ''}</p>
                  </div>
                </div>

                {/* Individual instrument rows */}
                {rows.map((h) => {
                  const inst = h.instrument
                  const chainColor = CHAIN_COLORS[inst.chainId] ?? '#94A3B8'
                  const canTrade = inst.liquidity.status === 'tradeable' || inst.liquidity.status === 'low_liquidity'

                  return (
                    <div key={inst.id} className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-[#F8FAFC]">
                      {/* Left: chain + issuer */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-2 h-8 rounded-full flex-shrink-0"
                          style={{ background: chainColor }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-[#0F172A]">{inst.issuerName}</span>
                            <span className="text-xs text-[#94A3B8]">{CHAIN_NAMES[inst.chainId] ?? inst.chain}</span>
                          </div>
                          <p className="text-xs text-[#94A3B8]">
                            {h.balance.toFixed(4)} {inst.tokenSymbol}
                          </p>
                        </div>
                      </div>

                      {/* Right: value + pnl + actions */}
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-semibold text-[#0F172A]">
                            ${h.valueUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          {h.pnlPct != null && (
                            <span className={`text-xs font-medium flex items-center gap-0.5 justify-end ${h.pnlPct >= 0 ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>
                              {h.pnlPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {h.pnlPct >= 0 ? '+' : ''}{h.pnlPct.toFixed(2)}% vs market
                            </span>
                          )}
                        </div>

                        {canTrade && (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setBuying(inst)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] transition-colors"
                            >
                              Buy
                            </button>
                            <button
                              onClick={() => setSelling(inst)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0] transition-colors"
                            >
                              Sell
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Vault Positions (Solana) */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <Vault className="w-4 h-4 text-[#14F195]" />
          <h2 className="text-base font-semibold text-[#0F172A]">Vault Positions</h2>
          <span className="text-xs text-[#94A3B8]">OnStock · Solana</span>
        </div>

        {!solanaWallet ? (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl py-10 text-center">
            <p className="text-sm text-[#94A3B8] mb-3">Connect your Solana wallet to view vault positions.</p>
          </div>
        ) : vaultLoading ? (
          <div className="flex items-center gap-2 py-6 text-[#94A3B8]">
            <div className="w-4 h-4 border-2 border-[#14F195] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Reading vault positions…</span>
          </div>
        ) : vaultPositions.length === 0 ? (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl py-10 text-center">
            <p className="text-sm text-[#94A3B8] mb-3">No vault positions found for this wallet.</p>
            <a
              href="/portfolio-builder"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#14F195] hover:underline"
            >
              Build a portfolio <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {vaultPositions.map(pos => (
              <div key={pos.asset} className="bg-white border border-[#E2E8F0] rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#F0FDF4] rounded-xl flex items-center justify-center">
                    <span className="font-bold text-sm text-[#16A34A]">{pos.asset.replace('x', '')}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#0F172A]">{pos.asset}</p>
                    <p className="text-xs text-[#94A3B8]">
                      {pos.userShares.toFixed(6)} shares · NAV {pos.nav.toFixed(4)}
                      {pos.depositedAt && (
                        <> · deposited {new Date(pos.depositedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[#0F172A]">
                      {pos.currentValue.toFixed(4)} <span className="text-xs font-normal text-[#94A3B8]">{pos.asset.replace('x', '')}</span>
                    </p>
                    <span className={`text-xs font-medium flex items-center gap-0.5 justify-end ${pos.pnl >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                      {pos.pnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(4)} PnL
                    </span>
                  </div>

                  <a
                    href={`/earn?asset=${pos.asset}`}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#F0FDF4] text-[#16A34A] hover:bg-[#DCFCE7] transition-colors whitespace-nowrap"
                  >
                    Redeem
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* X Layer Vault Positions */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <span style={{ color: '#8B5CF6', fontSize: 16 }}>⬡</span>
          <h2 className="text-base font-semibold text-[#0F172A]">X Layer Vault Positions</h2>
          <span className="text-xs text-[#94A3B8]">OnStock ERC4626 · OKX L2</span>
        </div>

        {!address ? (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl py-10 text-center">
            <p className="text-sm text-[#94A3B8] mb-3">Connect MetaMask or OKX Wallet to view X Layer vault positions.</p>
          </div>
        ) : xlayerLoading ? (
          <div className="flex items-center gap-2 py-6 text-[#94A3B8]">
            <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#8B5CF6', borderTopColor: 'transparent' }} />
            <span className="text-sm">Reading X Layer vaults…</span>
          </div>
        ) : xlayerPositions.length === 0 ? (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl py-10 text-center">
            <p className="text-sm text-[#94A3B8] mb-3">No X Layer vault positions found.</p>
            <a href="/earn" className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#8B5CF6' }}>
              Deposit to X Layer Vaults <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {xlayerPositions.map(pos => (
              <div key={pos.symbol} style={{
                background: '#fff', border: '1.5px solid #8B5CF633',
                borderRadius: 16, padding: '16px 20px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                    background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 10, fontWeight: 800,
                  }}>{pos.symbol.slice(0, 4)}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{pos.symbol}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>
                      {pos.shares.toFixed(6)} shares · NAV {pos.nav.toFixed(6)} · X Layer
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
                      {pos.value.toFixed(4)} <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>{pos.symbol}</span>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#8B5CF6' }}>
                      {pos.apyPct.toFixed(2)}% APY
                    </div>
                  </div>
                  <a
                    href={`https://www.okx.com/explorer/xlayer-test/address/${pos.address}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 8, background: '#EEF2FF', color: '#6366F1', textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
                    OKX Explorer →
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {buying && (
        <BuyFlow ticker={buying.assetTicker} instrument={buying} onClose={() => setBuying(null)} action="buy" />
      )}
      {selling && (
        <BuyFlow ticker={selling.assetTicker} instrument={selling} onClose={() => setSelling(null)} action="sell" />
      )}
    </div>
  )
}
