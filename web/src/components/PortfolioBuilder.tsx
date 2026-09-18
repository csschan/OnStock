'use client'

import { useState, useCallback, useEffect } from 'react'
import { Transaction } from '@solana/web3.js'
import { usePhantom } from './PhantomProvider'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

// Cross-chain route decision per asset
interface ChainRoute {
  ticker: string
  chain: 'xlayer' | 'solana'
  chainLabel: string
  apy: number
  reason: string
  premiumPct?: number
  savingsPct?: number  // entry price saving vs Solana
}

async function fetchChainRoutes(tickers: string[]): Promise<ChainRoute[]> {
  const routes: ChainRoute[] = []
  await Promise.all(tickers.map(async ticker => {
    try {
      const [priceResp, intentResp] = await Promise.all([
        fetch(`${API_BASE}/prices/${ticker}`),
        fetch(`${API_BASE}/intent/route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asset: ticker, amountUsd: 1000, riskTolerance: 'medium' }),
        }),
      ])
      const priceData = await priceResp.json()
      const intentData = await intentResp.json()

      const premiumPct: number = priceData.ok ? (priceData.data?.premiumPct ?? 0) : 0
      const xlayerApy: number = intentData.ok ? (intentData.data?.xlayerVaultApy ?? 4.2) : 4.2
      const solanaApy: number = intentData.ok
        ? Math.max(intentData.data?.bestVaultApy ?? 0, intentData.data?.bestKaminoApy ?? 0)
        : 4.2

      // Route to X Layer when: APY >= Solana AND (Solana has premium OR APY is higher)
      const xlayerWins = xlayerApy >= solanaApy
      if (xlayerWins) {
        routes.push({
          ticker,
          chain: 'xlayer',
          chainLabel: 'X Layer · OKX L2',
          apy: xlayerApy,
          reason: premiumPct > 0.3
            ? `Solana has +${premiumPct.toFixed(2)}% premium → X Layer entry at oracle price`
            : `X Layer Vault ${xlayerApy.toFixed(1)}% APY · lower L2 gas cost`,
          premiumPct,
          savingsPct: premiumPct > 0 ? premiumPct : undefined,
        })
      } else {
        routes.push({
          ticker,
          chain: 'solana',
          chainLabel: 'Solana',
          apy: solanaApy,
          reason: `Solana Vault ${solanaApy.toFixed(1)}% APY · higher than X Layer ${xlayerApy.toFixed(1)}%`,
          premiumPct,
        })
      }
    } catch {
      routes.push({ ticker, chain: 'xlayer', chainLabel: 'X Layer · OKX L2', apy: 4.2, reason: 'Default X Layer route' })
    }
  }))
  return routes
}

// Send signed tx to server relay — server re-broadcasts every 2s until confirmed
async function sendAndConfirm(txBytes: Uint8Array): Promise<string> {
  const resp = await fetch(`${API_BASE}/tx/send-confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: Buffer.from(txBytes).toString('base64') }),
  })
  const json = await resp.json()
  if (!json.ok) throw new Error(json.error)
  return json.signature as string
}

// Get fresh blockhash via server relay
async function relayGetBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const resp = await fetch(`${API_BASE}/tx/blockhash`)
  const json = await resp.json()
  if (!json.ok) throw new Error(json.error)
  return { blockhash: json.blockhash, lastValidBlockHeight: json.lastValidBlockHeight }
}

const ASSETS = [
  { ticker: 'TSLA',  name: 'Tesla',        sector: 'EV',      color: '#DC2626' },
  { ticker: 'NVDA',  name: 'NVIDIA',       sector: 'AI',      color: '#16A34A' },
  { ticker: 'SPY',   name: 'S&P 500',      sector: 'Index',   color: '#2563EB' },
  { ticker: 'AAPL',  name: 'Apple',        sector: 'Tech',    color: '#64748B' },
  { ticker: 'GOOGL', name: 'Google',       sector: 'Tech',    color: '#D97706' },
  { ticker: 'META',  name: 'Meta',         sector: 'Social',  color: '#7C3AED' },
  { ticker: 'COIN',  name: 'Coinbase',     sector: 'Crypto',  color: '#F59E0B' },
  { ticker: 'MSTR',  name: 'MicroStrategy',sector: 'BTC',     color: '#0EA5E9' },
]

type ExecStep = 'idle' | 'building' | 'executing' | 'done' | 'error'

interface BatchPosition {
  asset: string; xstockSymbol: string; pct: number; amountUsd: number
  xstockAmount: number; swapTransaction: string | null; swapLastValidBlockHeight: number | null
  depositTransaction: string; depositBlockhash: string; depositLastValidBlockHeight: number
  priceImpactPct: number; vaultPda: string; receiptMint: string
}

interface ExecProgress {
  asset: string; status: 'pending' | 'signing_swap' | 'confirming_swap' | 'signing_deposit' | 'confirming_deposit' | 'done' | 'error'
  swapTx?: string; depositTx?: string; error?: string
}

export default function PortfolioBuilder() {
  const { connected, publicKey: walletKey, connect: connectPhantom, signTransaction, signAllTransactions, signAndSendTransaction } = usePhantom()

  // Step 1: allocation builder
  const [selected, setSelected] = useState<Record<string, number>>({ TSLA: 40, NVDA: 30, SPY: 30 })
  const [totalUsd, setTotalUsd] = useState('3000')

  // Vault APY per asset — mirrors server-side VAULT_APY_BY_ASSET
  const VAULT_APY: Record<string, number> = {
    TSLA: 4.20, NVDA: 4.20, SPY: 3.80, AAPL: 4.20,
    GOOGL: 4.20, META: 4.20, COIN: 5.50, MSTR: 5.50,
  }
  const totalPctForApy = Object.values(selected).reduce((s, v) => s + v, 0)
  const projectedApy = totalPctForApy > 0
    ? Object.entries(selected).reduce((sum, [asset, pct]) => sum + (VAULT_APY[asset] ?? 4.20) * (pct / totalPctForApy), 0)
    : 4.20

  // Cross-chain routing
  const [chainRoutes, setChainRoutes] = useState<ChainRoute[]>([])
  const [routeLoading, setRouteLoading] = useState(false)

  useEffect(() => {
    const tickers = Object.keys(selected)
    if (!tickers.length) { setChainRoutes([]); return }
    setRouteLoading(true)
    fetchChainRoutes(tickers).then(r => { setChainRoutes(r); setRouteLoading(false) })
  }, [JSON.stringify(Object.keys(selected).sort())])

  // Step 2: batch result
  const [batchData, setBatchData] = useState<BatchPosition[] | null>(null)
  const [buildLoading, setBuildLoading] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)

  // Step 3: execution progress
  const [execStep, setExecStep] = useState<ExecStep>('idle')
  const [progress, setProgress] = useState<ExecProgress[]>([])

  const totalPct = Object.values(selected).reduce((s, v) => s + v, 0)
  const isValid = Math.abs(totalPct - 100) < 0.5 && parseFloat(totalUsd) > 0

  function toggleAsset(ticker: string) {
    setSelected(prev => {
      if (ticker in prev) {
        const next = { ...prev }
        delete next[ticker]
        return next
      }
      return { ...prev, [ticker]: 0 }
    })
    setBatchData(null)
  }

  function setPct(ticker: string, val: number) {
    setSelected(prev => ({ ...prev, [ticker]: val }))
    setBatchData(null)
  }

  function autoBalance() {
    const keys = Object.keys(selected)
    if (!keys.length) return
    const each = Math.floor(100 / keys.length)
    const rem = 100 - each * keys.length
    const balanced: Record<string, number> = {}
    keys.forEach((k, i) => { balanced[k] = each + (i === 0 ? rem : 0) })
    setSelected(balanced)
    setBatchData(null)
  }

  async function handleBuild() {
    // Get wallet key — connect first if needed, then proceed without returning
    let walletAddr = walletKey
    if (!walletAddr) {
      walletAddr = await connectPhantom()
      if (!walletAddr) return  // user rejected or no Phantom
    }
    setBuildLoading(true)
    setBuildError(null)
    setBatchData(null)
    setExecStep('idle')
    setProgress([])

    try {
      const positions = Object.entries(selected).map(([asset, pct]) => ({ asset, pct }))
      const resp = await fetch(`${API_BASE}/portfolio/build-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions, totalUsd: parseFloat(totalUsd), walletAddress: walletAddr.toBase58() }),
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error)
      setBatchData(json.data.positions)
      setProgress(json.data.positions.map((p: BatchPosition) => ({ asset: p.asset, status: 'pending' as const })))
    } catch (e: any) {
      setBuildError(e?.message ?? 'Build failed')
    } finally {
      setBuildLoading(false)
    }
  }

  const updateProgress = useCallback((asset: string, update: Partial<ExecProgress>) => {
    setProgress(prev => prev.map(p => p.asset === asset ? { ...p, ...update } : p))
  }, [])

  async function handleExecute() {
    if (!batchData) return
    if (!walletKey || !connected || !signTransaction) {
      await connectPhantom()
      return
    }
    setBuildError(null)
    setExecStep('executing')

    // Track per-asset errors locally (React state is async and stale inside this closure)
    const assetErrors = new Map<string, string>()

    // Detect devnet mode: build-batch returns swapTransaction=null on devnet (fetched fresh at execute-time)
    // Check if server is devnet by trying to call build-swap-txs
    const isDevnetMode = batchData.some(p => !p.swapTransaction) // devnet doesn't pre-build swap txs

    // Phase 0 (devnet): get mock USDC + ensure SOL for tx fees via faucet
    // Faucet server-side polls until both USDC mint and SOL airdrop confirm.
    // No extra wait needed — faucet returns only after on-chain confirmation.
    if (isDevnetMode) {
      try {
        const faucetResp = await fetch(`${API_BASE}/devnet/faucet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress: walletKey.toBase58(), symbol: 'USDC' }),
        })
        if (faucetResp.ok) {
          const fd = await faucetResp.json()
          if (fd.ok) console.log('[Faucet] USDC + SOL ready:', fd.data)
        }
      } catch { /* non-fatal */ }
    }

    // Phase 1 (devnet): server mints xStock directly — no user swap signing needed
    // Phase 1 (mainnet): would do Jupiter swap signing, but not implemented here
    if (isDevnetMode) {
      try {
        batchData.forEach(p => updateProgress(p.asset, { status: 'confirming_swap' }))
        const positions = batchData.map(p => ({ asset: p.asset, amountUsd: p.amountUsd }))
        const mintResp = await fetch(`${API_BASE}/devnet/mint-xstock-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ positions, walletAddress: walletKey.toBase58() }),
        })
        const mintJson = await mintResp.json()
        if (!mintJson.ok) throw new Error(mintJson.error ?? 'mint-xstock-batch failed')
        // Update progress with mint tx sigs
        for (const { asset, mintSig } of mintJson.data.results as { asset: string; mintSig: string }[]) {
          updateProgress(asset, { swapTx: mintSig })
        }
      } catch (e: any) {
        const msg = e?.message ?? 'xStock mint failed'
        batchData.forEach(p => {
          assetErrors.set(p.asset, msg)
          updateProgress(p.asset, { status: 'error', error: msg })
        })
        setExecStep('done')
        return
      }
    }

    // Phase 2: get fresh blockhash for deposit txs
    let blockhash: string
    try {
      ;({ blockhash } = await relayGetBlockhash())
    } catch (e: any) {
      setBuildError(`Failed to get blockhash: ${e?.message}`)
      setExecStep('idle')
      return
    }

    // Phase 3: collect deposit txs and sign all at once (one Phantom popup)
    const depositTxsToSign: Transaction[] = []
    const depositAssets: string[] = []
    for (const pos of batchData) {
      if (assetErrors.has(pos.asset)) continue
      const tx = Transaction.from(Buffer.from(pos.depositTransaction, 'base64'))
      tx.recentBlockhash = blockhash
      tx.feePayer = walletKey!
      depositTxsToSign.push(tx)
      depositAssets.push(pos.asset)
      updateProgress(pos.asset, { status: 'signing_deposit' })
    }

    let signedDeposits: Transaction[]
    try {
      signedDeposits = await signAllTransactions(depositTxsToSign)
    } catch (e: any) {
      const msg = e?.message ?? JSON.stringify(e)
      if (msg.includes('rejected') || msg.includes('User rejected')) { setExecStep('idle'); return }
      depositAssets.forEach(a => updateProgress(a, { status: 'error', error: msg }))
      setExecStep('done'); return
    }

    // Phase 4: relay each signed tx to server — server re-broadcasts every 2s until confirmed
    for (let i = 0; i < signedDeposits.length; i++) {
      const asset = depositAssets[i]
      updateProgress(asset, { status: 'confirming_deposit' })
      try {
        const sig = await sendAndConfirm(signedDeposits[i].serialize())
        updateProgress(asset, { status: 'done', depositTx: sig })
      } catch (e: any) {
        updateProgress(asset, { status: 'error', error: e?.message ?? 'Deposit failed' })
      }
    }

    setExecStep('done')
  }

  const STEP_LABEL: Record<string, string> = {
    pending: 'Pending',
    signing_swap: 'Signing Swap...',
    confirming_swap: 'Confirming Swap...',
    signing_deposit: 'Signing Deposit...',
    confirming_deposit: 'Confirming Deposit...',
    done: 'Done',
    error: 'Failed',
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 16px 48px' }}>

      {/* ── Step 1: Asset Picker ── */}
      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.05em' }}>STEP 1</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>Select Assets</div>
          </div>
          <button onClick={autoBalance} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700,
            background: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE', cursor: 'pointer',
          }}>Equal Split</button>
        </div>

        {/* Asset grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
          {ASSETS.map(a => {
            const isActive = a.ticker in selected
            return (
              <button key={a.ticker} onClick={() => toggleAsset(a.ticker)} style={{
                padding: '10px 6px', borderRadius: 10, border: '1.5px solid',
                borderColor: isActive ? a.color : '#E2E8F0',
                background: isActive ? `${a.color}12` : '#F8FAFC',
                cursor: 'pointer', textAlign: 'center',
              }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: isActive ? a.color : '#94A3B8' }}>{a.ticker}</div>
                <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 2 }}>{a.sector}</div>
              </button>
            )
          })}
        </div>

        {/* Pct sliders */}
        {Object.keys(selected).length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {Object.entries(selected).map(([ticker, pct]) => {
              const meta = ASSETS.find(a => a.ticker === ticker)!
              const amountUsd = (parseFloat(totalUsd) || 0) * pct / 100
              return (
                <div key={ticker} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 48, fontSize: 12, fontWeight: 700, color: meta.color }}>{ticker}</div>
                  <input type="range" min={0} max={100} value={pct}
                    onChange={e => setPct(ticker, parseInt(e.target.value))}
                    style={{ flex: 1, accentColor: meta.color }}
                  />
                  <div style={{ width: 36, fontSize: 12, fontWeight: 700, color: '#0F172A', textAlign: 'right' }}>{pct}%</div>
                  <div style={{ width: 64, fontSize: 11, color: '#64748B', textAlign: 'right' }}>
                    ${amountUsd.toFixed(0)}
                  </div>
                </div>
              )
            })}

            {/* Total bar */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 10px', borderRadius: 8,
              background: Math.abs(totalPct - 100) < 0.5 ? '#F0FDF4' : '#FEF2F2',
              border: `1px solid ${Math.abs(totalPct - 100) < 0.5 ? '#86EFAC' : '#FECACA'}`,
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: Math.abs(totalPct - 100) < 0.5 ? '#16A34A' : '#DC2626' }}>
                Total {totalPct}% {Math.abs(totalPct - 100) < 0.5 ? '✓' : `(${(100 - totalPct).toFixed(0)}% remaining)`}
              </span>
              <span style={{ fontSize: 11, color: '#64748B' }}>Must equal 100%</span>
            </div>
          </div>
        )}

        {/* Total USD */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Total Amount (USD)</div>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', fontWeight: 700 }}>$</span>
              <input type="number" value={totalUsd} onChange={e => { setTotalUsd(e.target.value); setBatchData(null) }}
                style={{
                  width: '100%', padding: '9px 10px 9px 22px', borderRadius: 8,
                  border: '1px solid #E2E8F0', fontSize: 14, fontWeight: 700,
                  background: '#F8FAFC', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
          <div style={{ paddingTop: 19 }}>
            <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Est. APY</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#16A34A' }}>{projectedApy.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* ── Cross-Chain Routing Table ── */}
      {Object.keys(selected).length > 0 && (
        <div style={{
          background: '#0F172A', borderRadius: 16, padding: '18px 20px',
          marginBottom: 16, color: '#fff',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 2 }}>
                CROSS-CHAIN ROUTING ENGINE
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>
                Optimal Chain Per Asset
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#14F195', background: '#14F19520', borderRadius: 4, padding: '2px 8px' }}>◎ Solana</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#8B5CF6', background: '#8B5CF620', borderRadius: 4, padding: '2px 8px' }}>⬡ X Layer</span>
            </div>
          </div>

          {routeLoading ? (
            <div style={{ fontSize: 12, color: '#64748B', textAlign: 'center', padding: '10px 0' }}>Querying chains...</div>
          ) : chainRoutes.length > 0 ? (
            <div>
              {chainRoutes.map(r => {
                const isXLayer = r.chain === 'xlayer'
                const meta = ASSETS.find(a => a.ticker === r.ticker)!
                const amountUsd = (parseFloat(totalUsd) || 0) * (selected[r.ticker] ?? 0) / 100
                return (
                  <div key={r.ticker} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '9px 12px', borderRadius: 8, marginBottom: 6,
                    background: isXLayer ? '#1E1B4B' : '#0F2027',
                    border: `1px solid ${isXLayer ? '#6366F1' : '#14F195'}33`,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                      background: `${meta.color}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 800, color: meta.color,
                    }}>{r.ticker}</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 800,
                          color: isXLayer ? '#8B5CF6' : '#14F195',
                          background: isXLayer ? '#8B5CF620' : '#14F19520',
                          borderRadius: 4, padding: '1px 6px',
                        }}>{isXLayer ? '⬡' : '◎'} {r.chainLabel}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#34D399' }}>{r.apy.toFixed(1)}% APY</span>
                        {r.savingsPct && r.savingsPct > 0 && (
                          <span style={{ fontSize: 9, color: '#A78BFA', fontWeight: 700 }}>
                            save +{r.savingsPct.toFixed(2)}% on entry
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.reason}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>${amountUsd.toFixed(0)}</div>
                      <div style={{ fontSize: 9, color: '#64748B' }}>{selected[r.ticker]}%</div>
                    </div>
                  </div>
                )
              })}

              {/* Chain summary */}
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                {[
                  {
                    chain: 'xlayer', label: '⬡ X Layer', color: '#8B5CF6',
                    count: chainRoutes.filter(r => r.chain === 'xlayer').length,
                    usd: chainRoutes.filter(r => r.chain === 'xlayer').reduce((s, r) => s + (parseFloat(totalUsd) || 0) * (selected[r.ticker] ?? 0) / 100, 0),
                  },
                  {
                    chain: 'solana', label: '◎ Solana', color: '#14F195',
                    count: chainRoutes.filter(r => r.chain === 'solana').length,
                    usd: chainRoutes.filter(r => r.chain === 'solana').reduce((s, r) => s + (parseFloat(totalUsd) || 0) * (selected[r.ticker] ?? 0) / 100, 0),
                  },
                ].filter(c => c.count > 0).map(c => (
                  <div key={c.chain} style={{
                    flex: 1, background: '#ffffff0a', borderRadius: 8, padding: '8px 12px',
                    border: `1px solid ${c.color}33`,
                  }}>
                    <div style={{ fontSize: 10, color: c.color, fontWeight: 700 }}>{c.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{c.count} assets · ${c.usd.toFixed(0)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Wallet status */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
        padding: '6px 12px', borderRadius: 8,
        background: connected ? '#F0FDF4' : '#FFF7ED',
        border: `1px solid ${connected ? '#86EFAC' : '#FED7AA'}`,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#16A34A' : '#F59E0B', flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: connected ? '#16A34A' : '#92400E', fontWeight: 600 }}>
          {connected && walletKey
            ? `Phantom connected: ${walletKey.toBase58().slice(0,4)}...${walletKey.toBase58().slice(-4)}`
            : 'Phantom not connected — will prompt on build'}
        </span>
      </div>

      {/* Build button */}
      <button onClick={handleBuild} disabled={!isValid || buildLoading}
        style={{
          width: '100%', padding: '13px', borderRadius: 10, fontSize: 15, fontWeight: 800, marginBottom: 16,
          background: !isValid || buildLoading ? '#E2E8F0' : 'linear-gradient(135deg, #0F172A 0%, #2563EB 100%)',
          color: !isValid || buildLoading ? '#94A3B8' : '#fff', border: 'none',
          cursor: !isValid || buildLoading ? 'not-allowed' : 'pointer',
        }}
      >
        {buildLoading ? 'Building...' : !isValid ? `Total ${totalPct}%, need 100%` : 'Build Portfolio →'}
      </button>
      {buildError && <div style={{ fontSize: 12, color: '#DC2626', textAlign: 'center', marginBottom: 12 }}>{buildError}</div>}

      {/* ── Step 2: Preview ── */}
      {batchData && execStep === 'idle' && (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '20px', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' }}>STEP 2</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', marginBottom: 14 }}>Confirm Portfolio Details</div>

          <div style={{ marginBottom: 14 }}>
            {batchData.map(pos => {
              const meta = ASSETS.find(a => a.ticker === pos.asset)!
              return (
                <div key={pos.asset} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', borderRadius: 8, marginBottom: 6,
                  background: '#F8FAFC', border: '1px solid #F1F5F9',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, background: `${meta.color}20`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 800, color: meta.color,
                    }}>{pos.asset}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{pos.xstockSymbol}</div>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>{pos.pct}% · ${pos.amountUsd.toFixed(0)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>
                      {pos.xstockAmount.toFixed(4)}
                    </div>
                    <div style={{ fontSize: 10, color: '#94A3B8' }}>
                      {pos.swapTransaction ? 'USDC→xStock + Vault' : 'Vault only'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Summary */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14,
            background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
            borderRadius: 10, padding: '12px 16px',
          }}>
            {[
              ['Total', `$${parseFloat(totalUsd).toLocaleString()}`],
              ['Assets', `${batchData.length}`],
              ['Est. APY', `${projectedApy.toFixed(1)}%`],
            ].map(([label, val]) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#14F195', fontFamily: 'monospace' }}>{val}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 12 }}>
            {batchData.some(p => p.swapTransaction)
              ? `2 signature prompts: ① USDC → xStock swap (${batchData.length} txs) ② Vault deposit (${batchData.length} txs)`
              : `1 signature prompt: Vault deposit (${batchData.length} txs)`}
          </div>

          <button onClick={connected ? handleExecute : connectPhantom}
            style={{
              width: '100%', padding: '13px', borderRadius: 10, fontSize: 15, fontWeight: 800,
              background: connected
                ? 'linear-gradient(135deg, #2563EB 0%, #0EA5E9 100%)'
                : '#9945FF',
              color: '#fff', border: 'none', cursor: 'pointer',
            }}
          >
            {connected ? 'Execute All →' : 'Connect Phantom Wallet'}
          </button>
          {connected && walletKey && (
            <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 6 }}>
              Wallet: {walletKey.toBase58().slice(0,4)}...{walletKey.toBase58().slice(-4)} · Devnet
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Execution progress ── */}
      {(execStep === 'executing' || execStep === 'done' || execStep === 'error') && progress.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' }}>STEP 3</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', marginBottom: 14 }}>
            {execStep === 'done' ? 'Portfolio Complete!' : 'Executing...'}
          </div>

          {progress.map(p => {
            const meta = ASSETS.find(a => a.ticker === p.asset)!
            const isDone = p.status === 'done'
            const isError = p.status === 'error'
            const isActive = !isDone && !isError && p.status !== 'pending'

            return (
              <div key={p.asset} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px',
                borderRadius: 8, marginBottom: 6,
                background: isDone ? '#F0FDF4' : isError ? '#FEF2F2' : isActive ? '#EFF6FF' : '#F8FAFC',
                border: `1px solid ${isDone ? '#86EFAC' : isError ? '#FECACA' : isActive ? '#BFDBFE' : '#F1F5F9'}`,
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: isDone ? '#16A34A' : isError ? '#DC2626' : isActive ? '#2563EB' : '#E2E8F0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 800, color: isDone || isError || isActive ? '#fff' : '#94A3B8',
                }}>
                  {isDone ? '✓' : isError ? '✗' : isActive ? (
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      border: '2px solid #fff', borderTopColor: 'transparent',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                  ) : p.asset.slice(0, 2)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{p.asset}</span>
                    <span style={{ fontSize: 11, color: isDone ? '#16A34A' : isError ? '#DC2626' : '#64748B' }}>
                      {STEP_LABEL[p.status]}
                    </span>
                  </div>
                  {p.swapTx && (
                    <a href={`https://solscan.io/tx/${p.swapTx}?cluster=devnet`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 10, color: '#7C3AED', display: 'block', marginTop: 2 }}>
                      Swap: {p.swapTx.slice(0, 12)}... →
                    </a>
                  )}
                  {p.depositTx && (
                    <a href={`https://solscan.io/tx/${p.depositTx}?cluster=devnet`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 10, color: '#2563EB', display: 'block', marginTop: 2 }}>
                      {isDone ? 'Vault deposit' : 'Tx sent'}: {p.depositTx.slice(0, 12)}... →
                    </a>
                  )}
                  {p.error && <div style={{ fontSize: 10, color: '#DC2626', marginTop: 2 }}>{p.error}</div>}
                </div>
              </div>
            )
          })}

          {execStep === 'done' && (() => {
            const doneCount = progress.filter(p => p.status === 'done').length
            const errCount = progress.filter(p => p.status === 'error').length
            const allFailed = doneCount === 0 && errCount > 0
            const partialFail = doneCount > 0 && errCount > 0
            return (
              <div style={{
                marginTop: 12, padding: '12px', borderRadius: 8,
                background: allFailed
                  ? 'linear-gradient(135deg, #450A0A 0%, #7F1D1D 100%)'
                  : 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: allFailed ? '#FCA5A5' : partialFail ? '#FCD34D' : '#14F195' }}>
                  {allFailed
                    ? 'All failed, please retry'
                    : partialFail
                      ? `Partial success: ${doneCount} deposited to Vault, ${errCount} failed`
                      : 'Portfolio built and deposited to Vault'}
                </div>
                {!allFailed && (
                  <>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 12 }}>
                      Holding receipt tokens, earning {projectedApy.toFixed(1)}% APY automatically. Redeem anytime.
                    </div>

                    {/* Cross-chain portfolio breakdown */}
                    <div style={{ background: '#ffffff08', borderRadius: 10, padding: '12px 14px', marginTop: 8 }}>
                      <div style={{ fontSize: 10, color: '#A5B4FC', fontWeight: 700, marginBottom: 10, letterSpacing: '0.05em' }}>
                        YOUR CROSS-CHAIN PORTFOLIO
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                        {[
                          {
                            chain: 'xlayer', label: '⬡ X Layer (OKX L2)', color: '#8B5CF6',
                            assets: progress.filter(p => p.status === 'done' && chainRoutes.find(r => r.ticker === p.asset)?.chain === 'xlayer'),
                            link: 'https://www.okx.com/explorer/xlayer-test',
                            linkLabel: 'OKX Explorer',
                          },
                          {
                            chain: 'solana', label: '◎ Solana', color: '#14F195',
                            assets: progress.filter(p => p.status === 'done' && chainRoutes.find(r => r.ticker === p.asset)?.chain === 'solana'),
                            link: 'https://solscan.io/?cluster=devnet',
                            linkLabel: 'Solscan',
                          },
                        ].filter(c => c.assets.length > 0).map(c => (
                          <div key={c.chain} style={{ flex: 1, minWidth: 160, background: '#ffffff08', borderRadius: 8, padding: '10px 12px' }}>
                            <div style={{ fontSize: 11, color: c.color, fontWeight: 700, marginBottom: 6 }}>{c.label}</div>
                            {c.assets.map(p => (
                              <div key={p.asset} style={{ fontSize: 11, color: '#E2E8F0', marginBottom: 3 }}>
                                • {p.asset} vault deposit
                                {p.depositTx && (
                                  <a
                                    href={c.chain === 'solana'
                                      ? `https://solscan.io/tx/${p.depositTx}?cluster=devnet`
                                      : `https://www.okx.com/explorer/xlayer-test/tx/${p.depositTx}`}
                                    target="_blank" rel="noopener noreferrer"
                                    style={{ marginLeft: 6, color: c.color, fontSize: 10 }}
                                  >
                                    tx →
                                  </a>
                                )}
                              </div>
                            ))}
                            <a href={c.link} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 10, color: c.color, display: 'block', marginTop: 6 }}>
                              View on {c.linkLabel} →
                            </a>
                          </div>
                        ))}
                      </div>

                      <div style={{ fontSize: 10, color: '#6366F1', borderTop: '1px solid #ffffff12', paddingTop: 8 }}>
                        💡 Connect Phantom + MetaMask on the Portfolio page to view unified cross-chain NAV →
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
