'use client'

import { useState, useCallback, useEffect } from 'react'
import { Transaction } from '@solana/web3.js'
import { usePhantom } from './PhantomProvider'
import { useAccount, useConnect, useWriteContract, useSwitchChain } from 'wagmi'
import { parseAbi, parseUnits, createPublicClient, http } from 'viem'
import { xlayerTestnet, arbitrumSepolia } from '@/components/Web3Provider'

const xlayerClient = createPublicClient({ chain: xlayerTestnet, transport: http('https://testrpc.xlayer.tech') })

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

const erc20Abi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
const erc4626Abi = parseAbi(['function deposit(uint256 assets, address receiver) returns (uint256)'])

// Cross-chain route decision per asset
interface ChainRoute {
  ticker: string
  chain: 'xlayer' | 'solana' | 'arbitrum'
  chainLabel: string
  apy: number
  reason: string
  premiumPct?: number
  savingsPct?: number
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
      const arbApy: number = intentData.ok ? (intentData.data?.arbitrumVaultApy ?? 0) : 0
      const solanaApy: number = intentData.ok
        ? Math.max(intentData.data?.bestVaultApy ?? 0, intentData.data?.bestKaminoApy ?? 0)
        : 4.2

      console.log(`[ChainRoute] ${ticker}: xlayer=${xlayerApy} arb=${arbApy} solana=${solanaApy}`)

      // Pick the best chain: compare all three
      // Priority order when APY equal: xlayer > arbitrum > solana (EVM vaults have 0 entry premium)
      const chainPriority: Record<string, number> = { xlayer: 0, arbitrum: 1, solana: 2 }
      const candidates = [
        { chain: 'xlayer' as const, label: 'X Layer · OKX L2', apy: xlayerApy },
        { chain: 'arbitrum' as const, label: 'Arbitrum · L2', apy: arbApy },
        { chain: 'solana' as const, label: 'Solana', apy: solanaApy },
      ].filter(c => c.apy > 0).sort((a, b) => b.apy - a.apy || chainPriority[a.chain] - chainPriority[b.chain])

      const best = candidates[0]
      console.log(`[ChainRoute] ${ticker}: best=${best.chain} ${best.apy}%`)
      routes.push({
        ticker, chain: best.chain, chainLabel: best.label, apy: best.apy,
        reason: best.chain === 'solana'
          ? `Solana Vault ${best.apy.toFixed(1)}% APY`
          : `${best.label} Vault ${best.apy.toFixed(1)}% APY${premiumPct > 0.3 ? ` · Solana has +${premiumPct.toFixed(2)}% premium` : ' · oracle price entry'}`,
        premiumPct,
        savingsPct: best.chain !== 'solana' && premiumPct > 0 ? premiumPct : undefined,
      })
    } catch {
      routes.push({ ticker, chain: 'xlayer', chainLabel: 'X Layer · OKX L2', apy: 4.2, reason: 'Default X Layer route' })
    }
  }))
  return routes
}

// Send signed tx to server relay
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

interface SplitInfo {
  totalTranches: number
  trancheAmountUsd: number
  reason: string          // e.g. "Order is 3.2% of pool TVL — split into 3 tranches"
  poolTvlUsd: number
  impactPctEstimate: number
}

interface BatchPosition {
  asset: string; xstockSymbol: string; pct: number; amountUsd: number
  xstockAmount: number; swapTransaction: string | null; swapLastValidBlockHeight: number | null
  depositTransaction: string; depositBlockhash: string; depositLastValidBlockHeight: number
  priceImpactPct: number; vaultPda: string; receiptMint: string
  // X Layer fields
  chain?: 'solana' | 'xlayer' | 'arbitrum'
  vaultAddress?: string; tokenAddress?: string; xstockOut?: number; mintTxHash?: string
  // Batch split info
  splitInfo?: SplitInfo
}

interface ExecProgress {
  asset: string
  chain: 'solana' | 'xlayer' | 'arbitrum'
  status: 'pending' | 'signing_swap' | 'confirming_swap' | 'signing_deposit' | 'confirming_deposit' | 'done' | 'error'
  swapTx?: string; depositTx?: string; error?: string
}

export default function PortfolioBuilder() {
  // Solana wallet
  const { connected: solConnected, publicKey: walletKey, connect: connectPhantom, signTransaction, signAllTransactions, signAndSendTransaction } = usePhantom()

  // EVM wallet
  const { address: evmAddr, isConnected: evmConnected, chainId: evmChainId } = useAccount()
  const { connect: evmConnect, connectors } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  // Step 1: allocation builder
  const [selected, setSelected] = useState<Record<string, number>>({ TSLA: 40, NVDA: 30, SPY: 30 })
  const [totalUsd, setTotalUsd] = useState('3000')

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

  // RWA risk-aware allocation: market status + effective weights
  const [realMarketOpen, setRealMarketOpen] = useState(true)
  const [realFreshness, setRealFreshness] = useState(1.0)
  const [simulateClosed, setSimulateClosed] = useState(false) // Demo toggle
  const [allocMode, setAllocMode] = useState<'effective' | 'force' | 'wait'>('effective')

  // Tunable risk parameters (user-adjustable sliders)
  const [freshCutoff, setFreshCutoff] = useState(0.75)   // penalty when freshness < 0.4
  const [devMildCutoff, setDevMildCutoff] = useState(0.8) // penalty when deviation 2-5%
  const [devSevereCutoff, setDevSevereCutoff] = useState(0.5) // penalty when deviation >5%

  // Derived: simulated overrides real when toggled
  const marketOpen = simulateClosed ? false : realMarketOpen
  const freshness = simulateClosed ? 0.25 : realFreshness
  const gapRisk = simulateClosed ? 'medium' : (realFreshness >= 0.7 ? 'none' : realFreshness >= 0.4 ? 'low' : 'medium')

  // Fetch real market status on mount
  useEffect(() => {
    fetch(`${API_BASE}/intent/route`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset: 'TSLA', amountUsd: 100, riskTolerance: 'medium' }),
    }).then(r => r.json()).then(json => {
      if (json.ok && json.data.freshness) {
        setRealMarketOpen(json.data.freshness.marketStatus.isOpen)
        setRealFreshness(json.data.freshness.freshnessScore)
      }
    }).catch(() => {})
  }, [])

  // Compute effective weights: downweight assets with risk, buffer to USDC
  const effectiveWeights = (() => {
    if (allocMode === 'force') return { weights: selected, usdcBuffer: 0 }
    const entries = Object.entries(selected)
    if (!entries.length) return { weights: selected, usdcBuffer: 0 }

    // Risk multiplier per asset based on freshness + deviation from route data
    let totalAdjusted = 0
    const adjusted: Record<string, number> = {}
    for (const [ticker, pct] of entries) {
      const route = chainRoutes.find(r => r.ticker === ticker)
      const absDev = route?.premiumPct ? Math.abs(route.premiumPct) : 0
      const devPenalty = absDev > 5 ? devSevereCutoff : absDev > 2 ? devMildCutoff : 1.0
      const freshPenalty = freshness < 0.4 ? freshCutoff : freshness < 0.7 ? (1 - (1 - freshCutoff) * 0.4) : 1.0
      const mult = devPenalty * freshPenalty
      adjusted[ticker] = pct * mult
      totalAdjusted += pct * mult
    }

    const totalOriginal = entries.reduce((s, [, v]) => s + v, 0)
    if (totalOriginal <= 0) return { weights: selected, usdcBuffer: 0 }

    const usdcBuffer = Math.max(0, totalOriginal - totalAdjusted)
    // Normalize so adjusted + buffer = 100
    const scale = (totalOriginal - usdcBuffer) / totalAdjusted
    const normalized: Record<string, number> = {}
    for (const [ticker] of entries) {
      normalized[ticker] = Math.round(adjusted[ticker] * scale)
    }

    return { weights: normalized, usdcBuffer: Math.round(usdcBuffer) }
  })()

  const hasRiskAdjustment = effectiveWeights.usdcBuffer > 0
  // Active weights used for display and execution
  const activeWeights = allocMode === 'force' ? selected : effectiveWeights.weights
  const activeTotal = (parseFloat(totalUsd) || 0) * (1 - effectiveWeights.usdcBuffer / 100)
  const displayTotal = allocMode === 'force' ? (parseFloat(totalUsd) || 0) : activeTotal

  // Step 2: batch result
  const [batchData, setBatchData] = useState<BatchPosition[] | null>(null)
  const [buildLoading, setBuildLoading] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)

  // Step 3: execution progress
  const [execStep, setExecStep] = useState<ExecStep>('idle')
  const [progress, setProgress] = useState<ExecProgress[]>([])

  const totalPct = Object.values(selected).reduce((s, v) => s + v, 0)
  const isValid = Math.abs(totalPct - 100) < 0.5 && parseFloat(totalUsd) > 0

  // Check which chains are needed
  const needsSolana = chainRoutes.some(r => r.chain === 'solana' && r.ticker in selected)
  const needsXLayer = chainRoutes.some(r => (r.chain === 'xlayer' || r.chain === 'arbitrum') && r.ticker in selected)

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

  function connectEvmWallet() {
    const okx = connectors.find(c => c.id === 'okxwallet')
    if (okx) { evmConnect({ connector: okx }); return }
    const mm = connectors.find(c => c.id === 'metaMask')
    if (mm) { evmConnect({ connector: mm }); return }
    if (connectors[0]) evmConnect({ connector: connectors[0] })
  }

  async function handleBuild() {
    // Connect wallets as needed
    let walletAddr = walletKey
    if (needsSolana && !walletAddr) {
      walletAddr = await connectPhantom()
      if (!walletAddr) return
    }
    if (needsXLayer && !evmConnected) {
      connectEvmWallet()
      return
    }

    setBuildLoading(true)
    setBuildError(null)
    setBatchData(null)
    setExecStep('idle')
    setProgress([])

    try {
      const allPositions: BatchPosition[] = []

      // Split assets by chain route
      const solanaAssets = Object.entries(selected).filter(([asset]) => {
        const route = chainRoutes.find(r => r.ticker === asset)
        return !route || route.chain === 'solana'
      })
      const evmAssets = Object.entries(selected).filter(([asset]) => {
        const route = chainRoutes.find(r => r.ticker === asset)
        return route?.chain === 'xlayer' || route?.chain === 'arbitrum'
      })
      console.log('[Build] chainRoutes:', chainRoutes.map(r => `${r.ticker}→${r.chain}`))
      console.log('[Build] solanaAssets:', solanaAssets.map(([a]) => a), 'evmAssets:', evmAssets.map(([a]) => a))
      console.log('[Build] evmAddr:', evmAddr, 'evmConnected:', evmConnected)

      // Build Solana positions via existing batch API
      if (solanaAssets.length > 0 && walletAddr) {
        // Use effective weights if risk-adjusted; reduce totalUsd by USDC buffer
        const useWeights = allocMode === 'force' ? selected : effectiveWeights.weights
        const effectiveTotalUsd = allocMode === 'force'
          ? parseFloat(totalUsd)
          : parseFloat(totalUsd) * (1 - effectiveWeights.usdcBuffer / 100)
        const positions = solanaAssets.map(([asset]) => ({ asset, pct: useWeights[asset] ?? selected[asset] }))
        const resp = await fetch(`${API_BASE}/portfolio/build-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ positions, totalUsd: effectiveTotalUsd, walletAddress: walletAddr.toBase58() }),
        })
        const json = await resp.json()
        if (!json.ok) throw new Error(json.error)
        for (const p of json.data.positions) {
          // Compute split info: if order > 1.5% of pool TVL, recommend splitting
          const route = chainRoutes.find(r => r.ticker === p.asset)
          let splitInfo: SplitInfo | undefined
          // Fetch pool TVL from prices API
          try {
            const priceResp = await fetch(`${API_BASE}/prices/${p.asset}`)
            const priceJson = await priceResp.json()
            if (priceJson.ok) {
              const solSource = priceJson.data.sources?.find((s: any) => s.chain === 'solana')
              const tvl = solSource?.liquidityUsd ?? 0
              if (tvl > 0) {
                const pctOfPool = (p.amountUsd / tvl) * 100
                if (pctOfPool > 1.5) {
                  const tranches = Math.min(5, Math.ceil(pctOfPool / 1.5))
                  splitInfo = {
                    totalTranches: tranches,
                    trancheAmountUsd: Math.round(p.amountUsd / tranches),
                    reason: `Order is ${pctOfPool.toFixed(1)}% of pool TVL ($${(tvl/1000).toFixed(0)}K) — recommend ${tranches} tranches to reduce impact`,
                    poolTvlUsd: tvl,
                    impactPctEstimate: Math.min(10, pctOfPool * 0.3),
                  }
                }
              }
            }
          } catch { /* non-fatal */ }
          allPositions.push({ ...p, chain: 'solana', splitInfo })
        }
      }

      // Build EVM positions (X Layer / Arbitrum) via respective execute API
      const evmUseWeights = allocMode === 'force' ? selected : effectiveWeights.weights
      const evmTotalPct = Object.values(evmUseWeights).reduce((s, v) => s + v, 0)
      const evmEffTotal = allocMode === 'force'
        ? parseFloat(totalUsd)
        : parseFloat(totalUsd) * (1 - effectiveWeights.usdcBuffer / 100)
      for (const [asset] of evmAssets) {
        const route = chainRoutes.find(r => r.ticker === asset)
        const evmChain = route?.chain ?? 'xlayer'
        const apiPath = evmChain === 'arbitrum' ? 'arbitrum' : 'xlayer'
        const usePct = evmUseWeights[asset] ?? selected[asset] ?? 0
        const amountUsd = evmEffTotal * usePct / evmTotalPct
        if (amountUsd <= 0) continue
        const resp = await fetch(`${API_BASE}/${apiPath}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asset, amountUsd, walletAddress: evmAddr }),
        })
        const json = await resp.json()
        if (!json.ok) throw new Error(`${asset}: ${json.error}`)
        const d = json.data
        allPositions.push({
          asset, xstockSymbol: d.xstockSymbol, pct: usePct, amountUsd,
          xstockAmount: d.xstockOut, chain: evmChain,
          vaultAddress: d.vaultAddress, tokenAddress: d.tokenAddress,
          xstockOut: d.xstockOut, mintTxHash: d.mintTxHash,
          swapTransaction: null, swapLastValidBlockHeight: null,
          depositTransaction: '', depositBlockhash: '', depositLastValidBlockHeight: 0,
          priceImpactPct: 0, vaultPda: '', receiptMint: '',
        })
      }

      setBatchData(allPositions)
      setProgress(allPositions.map(p => ({
        asset: p.asset, chain: p.chain ?? 'solana', status: 'pending' as const,
      })))
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
    setBuildError(null)
    setExecStep('executing')

    const solanaPositions = batchData.filter(p => p.chain === 'solana')
    const evmPositions = batchData.filter(p => p.chain === 'xlayer' || p.chain === 'arbitrum')

    // ── Execute Solana positions ──
    if (solanaPositions.length > 0) {
      if (!walletKey || !solConnected || !signTransaction) {
        await connectPhantom()
        setExecStep('idle')
        return
      }

      const assetErrors = new Map<string, string>()
      const isDevnetMode = solanaPositions.some(p => !p.swapTransaction)

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

      if (isDevnetMode) {
        try {
          solanaPositions.forEach(p => updateProgress(p.asset, { status: 'confirming_swap' }))
          const positions = solanaPositions.map(p => ({ asset: p.asset, amountUsd: p.amountUsd }))
          const mintResp = await fetch(`${API_BASE}/devnet/mint-xstock-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ positions, walletAddress: walletKey.toBase58() }),
          })
          const mintJson = await mintResp.json()
          if (!mintJson.ok) throw new Error(mintJson.error ?? 'mint-xstock-batch failed')
          for (const { asset, mintSig } of mintJson.data.results as { asset: string; mintSig: string }[]) {
            updateProgress(asset, { swapTx: mintSig })
          }
        } catch (e: any) {
          const msg = e?.message ?? 'xStock mint failed'
          solanaPositions.forEach(p => { assetErrors.set(p.asset, msg); updateProgress(p.asset, { status: 'error', error: msg }) })
        }
      }

      // Deposit txs
      if (assetErrors.size < solanaPositions.length) {
        let blockhash: string
        try {
          ;({ blockhash } = await relayGetBlockhash())
        } catch (e: any) {
          setBuildError(`Failed to get blockhash: ${e?.message}`)
          // continue to X Layer positions
          solanaPositions.forEach(p => { if (!assetErrors.has(p.asset)) updateProgress(p.asset, { status: 'error', error: 'Blockhash failed' }) })
          // don't return — still execute xlayer
        }

        if (blockhash!) {
          const depositTxsToSign: Transaction[] = []
          const depositAssets: string[] = []
          for (const pos of solanaPositions) {
            if (assetErrors.has(pos.asset)) continue
            const tx = Transaction.from(Buffer.from(pos.depositTransaction, 'base64'))
            tx.recentBlockhash = blockhash
            tx.feePayer = walletKey!
            depositTxsToSign.push(tx)
            depositAssets.push(pos.asset)
            updateProgress(pos.asset, { status: 'signing_deposit' })
          }

          try {
            const signedDeposits = await signAllTransactions(depositTxsToSign)
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
          } catch (e: any) {
            const msg = e?.message ?? JSON.stringify(e)
            if (msg.includes('rejected') || msg.includes('User rejected')) {
              depositAssets.forEach(a => updateProgress(a, { status: 'error', error: 'User rejected' }))
            } else {
              depositAssets.forEach(a => updateProgress(a, { status: 'error', error: msg }))
            }
          }
        }
      }
    }

    // ── Execute X Layer positions ──
    if (evmPositions.length > 0) {
      if (!evmConnected || !evmAddr) {
        connectEvmWallet()
        setExecStep('idle')
        return
      }

      for (const pos of evmPositions) {
        try {
          // Determine target chain for this position
          const targetChain = pos.chain === 'arbitrum' ? arbitrumSepolia : xlayerTestnet

          // Switch chain if needed
          if (evmChainId !== targetChain.id) {
            try {
              await switchChainAsync({ chainId: targetChain.id })
            } catch (e: any) {
              updateProgress(pos.asset, { status: 'error', error: `Failed to switch to ${targetChain.name}` })
              continue
            }
          }

          const depositAmount = parseUnits((pos.xstockOut ?? pos.xstockAmount).toString(), 18)

          // Approve
          updateProgress(pos.asset, { status: 'signing_deposit', swapTx: pos.mintTxHash })
          const approveTxHash = await writeContractAsync({
            address: pos.tokenAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: 'approve',
            args: [pos.vaultAddress as `0x${string}`, depositAmount],
            chainId: targetChain.id,
          })

          // Wait for approve to actually confirm on-chain
          updateProgress(pos.asset, { status: 'confirming_deposit' })
          await new Promise(r => setTimeout(r, 8000))

          // Deposit
          const depHash = await writeContractAsync({
            address: pos.vaultAddress as `0x${string}`,
            abi: erc4626Abi,
            functionName: 'deposit',
            args: [depositAmount, evmAddr],
            chainId: targetChain.id,
          })

          updateProgress(pos.asset, { status: 'done', depositTx: depHash })
        } catch (e: any) {
          const msg = e?.shortMessage ?? e?.message ?? 'EVM deposit failed'
          if (msg.includes('rejected') || msg.includes('User rejected')) {
            updateProgress(pos.asset, { status: 'error', error: 'User rejected' })
          } else {
            updateProgress(pos.asset, { status: 'error', error: msg })
          }
        }
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
              const route = chainRoutes.find(r => r.ticker === ticker)
              const isXL = route?.chain === 'xlayer' || route?.chain === 'arbitrum'
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
                  <span style={{
                    fontSize: 8, fontWeight: 800, borderRadius: 4, padding: '1px 5px',
                    color: isXL ? '#8B5CF6' : '#14F195',
                    background: isXL ? '#8B5CF620' : '#14F19520',
                  }}>{route?.chain === 'arbitrum' ? '⬡ ARB' : isXL ? '⬡ XL' : '◎ SOL'}</span>
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

        {/* RWA Risk-Aware Allocation Panel — always visible */}
        {Object.keys(selected).length > 0 && (
          <div style={{
            marginBottom: 16, borderRadius: 10, overflow: 'hidden',
            border: `1px solid ${hasRiskAdjustment ? '#FDE68A' : '#86EFAC'}`,
            background: hasRiskAdjustment ? '#FFFBEB' : '#F0FDF4',
          }}>
            {/* Header with market status + simulate toggle */}
            <div style={{
              padding: '10px 14px',
              background: hasRiskAdjustment ? '#FEF3C7' : '#DCFCE7',
              borderBottom: `1px solid ${hasRiskAdjustment ? '#FDE68A' : '#86EFAC'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: hasRiskAdjustment ? '#92400E' : '#166534', letterSpacing: '0.05em' }}>
                  RWA RISK-AWARE ALLOCATION
                </div>
                <div style={{ fontSize: 11, color: hasRiskAdjustment ? '#92400E' : '#166534', marginTop: 2 }}>
                  {hasRiskAdjustment
                    ? `${!marketOpen ? 'US market closed' : 'NAV freshness low'} — weights adjusted, ${effectiveWeights.usdcBuffer}% buffered to USDC`
                    : `Market ${marketOpen ? 'open' : 'closed'} · Freshness ${(freshness * 100).toFixed(0)}% · All clear — target weights = effective weights`
                  }
                </div>
              </div>
              {/* Market status indicators + simulate toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 6,
                  background: marketOpen ? '#16A34A20' : '#DC262620',
                  border: `1px solid ${marketOpen ? '#16A34A' : '#DC2626'}40`,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: marketOpen ? '#16A34A' : '#DC2626',
                  }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: marketOpen ? '#16A34A' : '#DC2626' }}>
                    {marketOpen ? 'OPEN' : 'CLOSED'}
                  </span>
                </div>
                <button
                  onClick={() => { setSimulateClosed(v => !v); setAllocMode('effective') }}
                  style={{
                    padding: '4px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700,
                    background: simulateClosed ? '#7C3AED' : '#F1F5F9',
                    color: simulateClosed ? '#fff' : '#64748B',
                    border: `1px solid ${simulateClosed ? '#7C3AED' : '#E2E8F0'}`,
                    cursor: 'pointer',
                  }}
                >
                  {simulateClosed ? 'Simulating Closed' : 'Simulate Closed'}
                </button>
              </div>
            </div>

            {/* Freshness bar */}
            <div style={{ padding: '8px 14px 4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: '#64748B' }}>NAV Freshness</span>
                <div style={{ flex: 1, height: 6, background: '#E2E8F0', borderRadius: 3 }}>
                  <div style={{
                    height: '100%', borderRadius: 3, transition: 'width 0.5s',
                    width: `${freshness * 100}%`,
                    background: freshness >= 0.7 ? '#16A34A' : freshness >= 0.4 ? '#D97706' : '#DC2626',
                  }} />
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                  color: freshness >= 0.7 ? '#16A34A' : freshness >= 0.4 ? '#D97706' : '#DC2626',
                }}>{(freshness * 100).toFixed(0)}%</span>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                  background: gapRisk === 'none' ? '#DCFCE7' : gapRisk === 'low' ? '#FEF3C7' : '#FEE2E2',
                  color: gapRisk === 'none' ? '#166534' : gapRisk === 'low' ? '#92400E' : '#991B1B',
                }}>Gap: {gapRisk}</span>
              </div>
            </div>

            {/* Tunable Risk Parameters */}
            <div style={{ padding: '6px 14px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em' }}>
                  RISK PARAMETERS
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { label: 'Conservative', fresh: 0.60, mild: 0.65, severe: 0.30, color: '#16A34A' },
                    { label: 'Balanced',     fresh: 0.75, mild: 0.80, severe: 0.50, color: '#2563EB' },
                    { label: 'Aggressive',   fresh: 0.90, mild: 0.90, severe: 0.70, color: '#DC2626' },
                  ].map(preset => {
                    const isActive = Math.abs(freshCutoff - preset.fresh) < 0.02 && Math.abs(devMildCutoff - preset.mild) < 0.02
                    return (
                      <button key={preset.label}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFreshCutoff(preset.fresh); setDevMildCutoff(preset.mild); setDevSevereCutoff(preset.severe) }}
                        type="button"
                        style={{
                          padding: '3px 10px', borderRadius: 6, fontSize: 9, fontWeight: 700,
                          background: isActive ? preset.color : '#F8FAFC',
                          color: isActive ? '#fff' : '#64748B',
                          border: `1px solid ${isActive ? preset.color : '#E2E8F0'}`,
                          cursor: 'pointer',
                        }}>
                        {preset.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {/* Freshness penalty */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 9, color: '#64748B' }}>Stale NAV penalty</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>
                      {((1 - freshCutoff) * 100).toFixed(0)}% cut
                    </span>
                  </div>
                  <input type="range" min={50} max={100} value={freshCutoff * 100}
                    onChange={e => setFreshCutoff(parseInt(e.target.value) / 100)}
                    style={{ width: '100%', accentColor: '#D97706', height: 4 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#94A3B8' }}>
                    <span>Aggressive (50%)</span><span>Mild (0%)</span>
                  </div>
                </div>

                {/* Deviation mild penalty */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 9, color: '#64748B' }}>Dev 2-5% penalty</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>
                      {((1 - devMildCutoff) * 100).toFixed(0)}% cut
                    </span>
                  </div>
                  <input type="range" min={50} max={100} value={devMildCutoff * 100}
                    onChange={e => setDevMildCutoff(parseInt(e.target.value) / 100)}
                    style={{ width: '100%', accentColor: '#F59E0B', height: 4 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#94A3B8' }}>
                    <span>Aggressive (50%)</span><span>Mild (0%)</span>
                  </div>
                </div>

                {/* Deviation severe penalty */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 9, color: '#64748B' }}>Dev &gt;5% penalty</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>
                      {((1 - devSevereCutoff) * 100).toFixed(0)}% cut
                    </span>
                  </div>
                  <input type="range" min={20} max={100} value={devSevereCutoff * 100}
                    onChange={e => setDevSevereCutoff(parseInt(e.target.value) / 100)}
                    style={{ width: '100%', accentColor: '#DC2626', height: 4 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#94A3B8' }}>
                    <span>Aggressive (80%)</span><span>Mild (0%)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Risk adjustment details — only when there IS a risk adjustment */}
            {hasRiskAdjustment && (
              <div style={{ padding: '6px 14px 10px' }}>
                {/* Target vs Effective comparison */}
                <div style={{ fontSize: 10, color: '#92400E', fontWeight: 700, marginBottom: 6 }}>
                  Target → Effective Weights
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  {Object.entries(selected).map(([ticker, targetPct]) => {
                    const effPct = effectiveWeights.weights[ticker] ?? 0
                    const reduced = effPct < targetPct
                    return (
                      <div key={ticker} style={{
                        textAlign: 'center', minWidth: 60, padding: '6px 8px',
                        background: '#fff', borderRadius: 8, border: `1px solid ${reduced ? '#FDE68A' : '#E2E8F0'}`,
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#0F172A' }}>{ticker}</div>
                        <div style={{ fontSize: 10, color: '#94A3B8', textDecoration: reduced ? 'line-through' : 'none' }}>
                          {targetPct}%
                        </div>
                        {reduced ? (
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#D97706' }}>{effPct}%</div>
                        ) : (
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#16A34A' }}>{effPct}%</div>
                        )}
                      </div>
                    )
                  })}
                  {effectiveWeights.usdcBuffer > 0 && (
                    <div style={{
                      textAlign: 'center', minWidth: 60, padding: '6px 8px',
                      background: '#F0FDF4', borderRadius: 8, border: '1px solid #86EFAC',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#16A34A' }}>USDC</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#16A34A' }}>{effectiveWeights.usdcBuffer}%</div>
                      <div style={{ fontSize: 9, color: '#64748B' }}>buffer</div>
                    </div>
                  )}
                </div>

                {/* 3 choices */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setAllocMode('effective')} style={{
                    flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                    background: allocMode === 'effective' ? '#16A34A' : '#F8FAFC',
                    color: allocMode === 'effective' ? '#fff' : '#64748B',
                    border: `1px solid ${allocMode === 'effective' ? '#16A34A' : '#E2E8F0'}`,
                    cursor: 'pointer',
                  }}>
                    Accept risk-adjusted
                  </button>
                  <button onClick={() => setAllocMode('force')} style={{
                    flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                    background: allocMode === 'force' ? '#DC2626' : '#F8FAFC',
                    color: allocMode === 'force' ? '#fff' : '#64748B',
                    border: `1px solid ${allocMode === 'force' ? '#DC2626' : '#E2E8F0'}`,
                    cursor: 'pointer',
                  }}>
                    Force target weights
                  </button>
                  <button onClick={() => setAllocMode('wait')} style={{
                    flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                    background: allocMode === 'wait' ? '#2563EB' : '#F8FAFC',
                    color: allocMode === 'wait' ? '#fff' : '#64748B',
                    border: `1px solid ${allocMode === 'wait' ? '#2563EB' : '#E2E8F0'}`,
                    cursor: 'pointer',
                  }}>
                    Wait for market open
                  </button>
                </div>
              </div>
            )}
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
                const isXLayer = (r.chain === 'xlayer' || r.chain === 'arbitrum')
                const meta = ASSETS.find(a => a.ticker === r.ticker)!
                const effPct = activeWeights[r.ticker] ?? selected[r.ticker] ?? 0
                const amountUsd = (parseFloat(totalUsd) || 0) * effPct / 100
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
                      <div style={{ fontSize: 9, color: '#64748B' }}>{effPct}%</div>
                    </div>
                  </div>
                )
              })}

              {/* Chain summary */}
              {(() => {
                const total = parseFloat(totalUsd) || 0
                const chains = [
                  {
                    chain: 'xlayer', label: '⬡ X Layer', color: '#8B5CF6',
                    count: chainRoutes.filter(r => (r.chain === 'xlayer' || r.chain === 'arbitrum')).length,
                    usd: chainRoutes.filter(r => (r.chain === 'xlayer' || r.chain === 'arbitrum')).reduce((s, r) => s + total * (activeWeights[r.ticker] ?? selected[r.ticker] ?? 0) / 100, 0),
                  },
                  {
                    chain: 'solana', label: '◎ Solana', color: '#14F195',
                    count: chainRoutes.filter(r => r.chain === 'solana').length,
                    usd: chainRoutes.filter(r => r.chain === 'solana').reduce((s, r) => s + total * (activeWeights[r.ticker] ?? selected[r.ticker] ?? 0) / 100, 0),
                  },
                ].filter(c => c.count > 0)
                const executingUsd = chains.reduce((s, c) => s + c.usd, 0)
                const bufferUsd = Math.max(0, total - executingUsd)
                return (
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    {chains.map(c => (
                      <div key={c.chain} style={{
                        flex: 1, background: '#ffffff0a', borderRadius: 8, padding: '8px 12px',
                        border: `1px solid ${c.color}33`,
                      }}>
                        <div style={{ fontSize: 10, color: c.color, fontWeight: 700 }}>{c.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{c.count} assets · ${c.usd.toFixed(0)}</div>
                      </div>
                    ))}
                    {bufferUsd > 10 && allocMode === 'effective' && (
                      <div style={{
                        flex: 1, background: '#ffffff0a', borderRadius: 8, padding: '8px 12px',
                        border: '1px solid #16A34A33',
                      }}>
                        <div style={{ fontSize: 10, color: '#16A34A', fontWeight: 700 }}>USDC Buffer</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: '#14F195' }}>
                          ${bufferUsd.toFixed(0)} · {((bufferUsd / total) * 100).toFixed(0)}%
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          ) : null}
        </div>
      )}

      {/* Wallet status — show both chains */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {needsSolana && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', borderRadius: 8,
            background: solConnected ? '#F0FDF4' : '#FFF7ED',
            border: `1px solid ${solConnected ? '#86EFAC' : '#FED7AA'}`,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: solConnected ? '#16A34A' : '#F59E0B', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: solConnected ? '#16A34A' : '#92400E', fontWeight: 600 }}>
              {solConnected && walletKey
                ? `◎ Phantom: ${walletKey.toBase58().slice(0,4)}...${walletKey.toBase58().slice(-4)}`
                : '◎ Phantom not connected'}
            </span>
          </div>
        )}
        {needsXLayer && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', borderRadius: 8,
            background: evmConnected ? '#EEF2FF' : '#FFF7ED',
            border: `1px solid ${evmConnected ? '#C7D2FE' : '#FED7AA'}`,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: evmConnected ? '#6366F1' : '#F59E0B', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: evmConnected ? '#6366F1' : '#92400E', fontWeight: 600 }}>
              {evmConnected && evmAddr
                ? `⬡ EVM: ${evmAddr.slice(0,4)}...${evmAddr.slice(-4)}`
                : '⬡ EVM not connected'}
            </span>
            {!evmConnected && (
              <button onClick={connectEvmWallet} style={{
                marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#fff', background: '#6366F1',
                border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
              }}>Connect</button>
            )}
          </div>
        )}
        {!needsSolana && !needsXLayer && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', borderRadius: 8,
            background: solConnected ? '#F0FDF4' : '#FFF7ED',
            border: `1px solid ${solConnected ? '#86EFAC' : '#FED7AA'}`,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: solConnected ? '#16A34A' : '#F59E0B' }} />
            <span style={{ fontSize: 11, color: solConnected ? '#16A34A' : '#92400E', fontWeight: 600 }}>
              {solConnected && walletKey
                ? `Phantom: ${walletKey.toBase58().slice(0,4)}...${walletKey.toBase58().slice(-4)}`
                : 'Phantom not connected — will prompt on build'}
            </span>
          </div>
        )}
      </div>

      {/* Build button */}
      <button onClick={handleBuild} disabled={!isValid || buildLoading || allocMode === 'wait'}
        style={{
          width: '100%', padding: '13px', borderRadius: 10, fontSize: 15, fontWeight: 800, marginBottom: 16,
          background: !isValid || buildLoading || allocMode === 'wait' ? '#E2E8F0' : allocMode === 'force' && hasRiskAdjustment ? '#DC2626' : 'linear-gradient(135deg, #0F172A 0%, #2563EB 100%)',
          color: !isValid || buildLoading || allocMode === 'wait' ? '#94A3B8' : '#fff', border: 'none',
          cursor: !isValid || buildLoading || allocMode === 'wait' ? 'not-allowed' : 'pointer',
        }}
      >
        {buildLoading ? 'Building...'
          : allocMode === 'wait' ? 'Waiting for market open...'
          : !isValid ? `Total ${totalPct}%, need 100%`
          : allocMode === 'force' && hasRiskAdjustment ? 'Build Portfolio (ignoring risk) →'
          : 'Build Portfolio →'}
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
              const isXL = pos.chain === 'xlayer' || pos.chain === 'arbitrum'
              return (
                <div key={pos.asset}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', borderRadius: pos.splitInfo ? '8px 8px 0 0' : 8, marginBottom: pos.splitInfo ? 0 : 6,
                    background: isXL ? '#F5F3FF' : '#F8FAFC',
                    border: `1px solid ${isXL ? '#DDD6FE' : '#F1F5F9'}`,
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
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                        <span style={{
                          fontSize: 9, fontWeight: 800, borderRadius: 4, padding: '1px 5px',
                          color: isXL ? '#8B5CF6' : '#14F195',
                          background: isXL ? '#8B5CF620' : '#14F19520',
                        }}>{pos.chain === 'arbitrum' ? '⬡ Arbitrum' : isXL ? '⬡ X Layer' : '◎ Solana'}</span>
                        {pos.splitInfo && (
                          <span style={{
                            fontSize: 8, fontWeight: 800, borderRadius: 4, padding: '1px 5px',
                            color: '#D97706', background: '#FFFBEB', border: '1px solid #FDE68A',
                          }}>{pos.splitInfo.totalTranches} tranches</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {pos.splitInfo && (
                    <div style={{
                      marginBottom: 6, padding: '6px 12px',
                      background: '#FFFBEB', borderRadius: '0 0 8px 8px', border: '1px solid #FDE68A',
                      borderTop: 'none', fontSize: 10, color: '#92400E',
                    }}>
                      {pos.splitInfo.reason} · ~${pos.splitInfo.trancheAmountUsd.toLocaleString()} per tranche · est. impact {pos.splitInfo.impactPctEstimate.toFixed(1)}%
                    </div>
                  )}
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
            {(() => {
              const total = parseFloat(totalUsd) || 0
              const executing = batchData.reduce((s, p) => s + p.amountUsd, 0)
              const buffer = Math.max(0, total - executing)
              return [
                ['Executing', `$${executing.toLocaleString(undefined, { maximumFractionDigits: 0 })}`],
                ...(buffer > 10 ? [['USDC Buffer', `$${buffer.toFixed(0)}`]] : []),
                ['Assets', `${batchData.length}`],
                ['Est. APY', `${projectedApy.toFixed(1)}%`],
              ].map(([label, val]) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: label === 'USDC Buffer' ? '#16A34A' : '#14F195', fontFamily: 'monospace' }}>{val}</div>
                </div>
              ))
            })()}
          </div>

          <button onClick={handleExecute}
            style={{
              width: '100%', padding: '13px', borderRadius: 10, fontSize: 15, fontWeight: 800,
              background: 'linear-gradient(135deg, #2563EB 0%, #6366F1 100%)',
              color: '#fff', border: 'none', cursor: 'pointer',
            }}
          >
            Execute All →
          </button>
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
            const isXL = p.chain === 'xlayer' || p.chain === 'arbitrum'
            const explorerBase = p.chain === 'arbitrum'
              ? 'https://sepolia.arbiscan.io/tx/'
              : p.chain === 'xlayer'
              ? 'https://www.okx.com/explorer/xlayer-test/tx/'
              : 'https://solscan.io/tx/'
            const explorerSuffix = isXL ? '' : '?cluster=devnet'

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
                    <span style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>
                      {p.asset}
                      <span style={{
                        marginLeft: 6, fontSize: 8, fontWeight: 800, borderRadius: 4, padding: '1px 5px',
                        color: isXL ? '#8B5CF6' : '#14F195',
                        background: isXL ? '#8B5CF620' : '#14F19520',
                      }}>{p.chain === 'arbitrum' ? '⬡ ARB' : isXL ? '⬡ XL' : '◎ SOL'}</span>
                    </span>
                    <span style={{ fontSize: 11, color: isDone ? '#16A34A' : isError ? '#DC2626' : '#64748B' }}>
                      {STEP_LABEL[p.status]}
                    </span>
                  </div>
                  {p.swapTx && (
                    <a href={`${explorerBase}${p.swapTx}${explorerSuffix}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 10, color: '#7C3AED', display: 'block', marginTop: 2 }}>
                      {isXL ? 'Mint' : 'Swap'}: {p.swapTx.slice(0, 12)}... →
                    </a>
                  )}
                  {p.depositTx && (
                    <a href={`${explorerBase}${p.depositTx}${explorerSuffix}`}
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
            return (
              <div style={{
                marginTop: 12, padding: '12px', borderRadius: 8,
                background: allFailed
                  ? 'linear-gradient(135deg, #450A0A 0%, #7F1D1D 100%)'
                  : 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: allFailed ? '#FCA5A5' : doneCount < progress.length ? '#FCD34D' : '#14F195' }}>
                  {allFailed
                    ? 'All failed, please retry'
                    : doneCount < progress.length
                      ? `Partial: ${doneCount} deposited, ${errCount} failed`
                      : 'Portfolio built and deposited across chains'}
                </div>
                {!allFailed && (
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>
                    Holding receipt tokens, earning {projectedApy.toFixed(1)}% APY automatically. Redeem anytime.
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
