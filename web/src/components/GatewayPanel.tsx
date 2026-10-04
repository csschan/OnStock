'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { arbitrumSepolia } from 'wagmi/chains'
import { usePhantom } from './PhantomProvider'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

const STOCKS = ['TSLA', 'NVDA', 'AAPL', 'SPY', 'GOOGL', 'META', 'COIN', 'MSTR']

interface ChainPrice {
  price: number
  source: string
  liquidity: number
  allSources?: { price: number; source: string; liquidity: number }[]
}

interface AssetData {
  ticker: string
  oraclePrice: number
  yahooPrice: number | null
  marketOpen: boolean
  totalSupply: number
  osToken: string
  prices?: {
    arbitrum: ChainPrice | null
    solana: ChainPrice | null
    robinhood: ChainPrice | null
  }
}

export default function GatewayPanel() {
  const { address, isConnected, chain } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChain } = useSwitchChain()
  const { publicKey: solPubkey, connected: solConnected } = usePhantom()

  const [mode, setMode] = useState<'buy' | 'sell' | 'swap'>('buy')
  const [ticker, setTicker] = useState('TSLA')
  const [amount, setAmount] = useState('')
  const [assets, setAssets] = useState<Record<string, AssetData>>({})
  const [loading, setLoading] = useState(false)
  const [txStatus, setTxStatus] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  // Intent Router best routes
  const [bestRoutes, setBestRoutes] = useState<any[]>([])
  const [routeLoading, setRouteLoading] = useState(false)

  // Cross-chain swap state
  type ChainId = 'arbitrum' | 'solana' | 'robinhood'
  const CHAINS: { id: ChainId; label: string }[] = [
    { id: 'arbitrum', label: 'Arbitrum' },
    { id: 'solana', label: 'Solana' },
    { id: 'robinhood', label: 'Robinhood' },
  ]
  const [swapSrc, setSwapSrc] = useState<ChainId>('arbitrum')
  const [swapDest, setSwapDest] = useState<ChainId>('solana')
  const [swapDestAddr, setSwapDestAddr] = useState('')

  // User token balances per chain
  const [arbBalance, setArbBalance] = useState<Record<string, number>>({})
  const [arbUsdcBalance, setArbUsdcBalance] = useState(0)
  const [rhBalance, setRhBalance] = useState<Record<string, number>>({})
  const [rhBreakdown, setRhBreakdown] = useState<Record<string, { native: number; osToken: number; total: number }>>({})
  const [rhUsdcBalance, setRhUsdcBalance] = useState(0)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [solBalance, setSolBalance] = useState<Record<string, number>>({})
  const [solUsdcBalance, setSolUsdcBalance] = useState(0)

  const fetchAssets = useCallback(async () => {
    try {
      const results = await Promise.all(
        STOCKS.map(async (t) => {
          const res = await fetch(`${API_BASE}/gateway/asset/${t}`)
          const json = await res.json()
          return json.ok ? json.data : null
        })
      )
      const map: Record<string, AssetData> = {}
      results.forEach((r) => { if (r) map[r.ticker] = r })
      setAssets(map)
    } catch {}
  }, [])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  // Fetch user balances on both chains
  const fetchBalances = useCallback(async () => {
    if (!address) return

    // Arbitrum balances (EVM)
    try {
      const res = await fetch(`${API_BASE}/gateway/info`)
      const json = await res.json()
      if (!json.ok) return
      const { osTokens, usdc } = json.data

      const { createPublicClient, http } = await import('viem')
      const { arbitrumSepolia: arbChain } = await import('viem/chains')
      const client = createPublicClient({ chain: arbChain, transport: http() })

      const erc20Abi = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }] as const

      const uBal = await client.readContract({ address: usdc as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
      setArbUsdcBalance(Number(uBal) / 1e6)

      const bals: Record<string, number> = {}
      for (const [t, addr] of Object.entries(osTokens as Record<string, string>)) {
        try {
          const b = await client.readContract({ address: addr as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
          bals[t] = Number(b) / 1e6
        } catch { bals[t] = 0 }
      }
      setArbBalance(bals)
    } catch {}

    // Robinhood balances (native stock tokens + osTokens + USDC via backend API)
    try {
      const rhRes = await fetch(`${API_BASE}/rh-gateway/balances/${address}`)
      const rhJson = await rhRes.json()
      if (rhJson.ok) {
        const bals: Record<string, number> = {}
        let rhUsdc = 0
        for (const [t, v] of Object.entries(rhJson.data.balances as Record<string, number>)) {
          if (t === 'USDC') { rhUsdc = v }
          else if (t !== 'ETH') { bals[t] = v }
        }
        setRhBalance(bals)
        setRhBreakdown(rhJson.data.breakdown ?? {})
        if (rhUsdc > 0) setRhUsdcBalance(rhUsdc)
      }
    } catch {}

    // Solana balances (SPL tokens) — requires Phantom wallet
    setSolBalance({})
    setSolUsdcBalance(0)
  }, [address])

  useEffect(() => { fetchBalances() }, [fetchBalances])

  // Auto-refresh balances every 15 seconds
  useEffect(() => {
    if (!address) return
    const timer = setInterval(fetchBalances, 15000)
    return () => clearInterval(timer)
  }, [address, fetchBalances])

  const currentAsset = assets[ticker]
  const price = currentAsset?.oraclePrice ?? 0
  const numAmount = parseFloat(amount) || 0

  // Per-chain prices for swap: sell at best (highest) on source, buy at best (lowest) on dest
  const srcSources = currentAsset?.prices?.[swapSrc]?.allSources ?? []
  const destSources = currentAsset?.prices?.[swapDest]?.allSources ?? []

  // Best sell = highest price on source chain
  const srcChainPrice = srcSources.length > 0
    ? srcSources.reduce((a, b) => b.price > a.price ? b : a, srcSources[0]).price
    : (currentAsset?.prices?.[swapSrc]?.price ?? price)
  const srcBestSource = srcSources.length > 0
    ? srcSources.reduce((a, b) => b.price > a.price ? b : a, srcSources[0]).source
    : (currentAsset?.prices?.[swapSrc]?.source ?? '')

  // Best buy = lowest price on dest chain
  const destChainPrice = destSources.length > 0
    ? destSources.reduce((a, b) => b.price < a.price ? b : a, destSources[0]).price
    : (currentAsset?.prices?.[swapDest]?.price ?? price)
  const destBestSource = destSources.length > 0
    ? destSources.reduce((a, b) => b.price < a.price ? b : a, destSources[0]).source
    : (currentAsset?.prices?.[swapDest]?.source ?? '')

  // Expected output
  const expectedOut = mode === 'buy'
    ? price > 0 ? (numAmount * 0.995 / price) : 0             // USDC → token (0.5% fee)
    : mode === 'sell'
    ? numAmount * price * 0.995                                 // token → USDC (0.5% fee)
    : (srcChainPrice > 0 && destChainPrice > 0)                 // cross-chain: sell at src, buy at dest
    ? (numAmount * srcChainPrice * 0.9995) / destChainPrice
    : 0

  // Detect which chain user is on for buy/sell
  const activeEvmChain: ChainId = chain?.id === 46630 ? 'robinhood' : 'arbitrum'


  // Chain configs for tx handling
  const CHAIN_RPC: Record<string, { chainId: number; rpc: string; explorer: string }> = {
    arbitrum: { chainId: 421614, rpc: 'https://sepolia-rollup.arbitrum.io/rpc', explorer: 'https://sepolia.arbiscan.io' },
    robinhood: { chainId: 46630, rpc: 'https://rpc.testnet.chain.robinhood.com', explorer: 'https://explorer.testnet.chain.robinhood.com' },
  }

  // Active chain balance for buy/sell
  const activeBalance = activeEvmChain === 'robinhood' ? rhBalance : arbBalance
  const activeUsdcBalance = activeEvmChain === 'robinhood' ? rhUsdcBalance : arbUsdcBalance

  // Helper: wait for tx receipt on any EVM chain
  const waitForTx = async (hash: string, chainKey = 'arbitrum'): Promise<boolean> => {
    const { createPublicClient, http } = await import('viem')
    const chainCfg = CHAIN_RPC[chainKey] ?? CHAIN_RPC.arbitrum
    const client = createPublicClient({
      chain: { id: chainCfg.chainId, name: chainKey, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [chainCfg.rpc] } } } as any,
      transport: http(chainCfg.rpc),
    })
    for (let i = 0; i < 15; i++) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` })
        return receipt.status === 'success'
      } catch {
        await new Promise(r => setTimeout(r, 2000))
      }
    }
    return false
  }

  // Get API base path and target chain for current mode
  const getTradeChain = () => {
    // For now buy/sell default to arbitrum, but could be extended
    return 'arbitrum'
  }

  const handleBuySell = async () => {
    if (!isConnected || !walletClient || !address) return setTxStatus('Connect wallet first')

    // Check user is on a supported chain
    const supportedChains = [421614, 46630] // Arbitrum Sepolia, Robinhood Testnet
    if (!chain || !supportedChains.includes(chain.id)) {
      try { switchChain({ chainId: 421614 }) } catch {}
      return setTxStatus('Switch to Arbitrum Sepolia or Robinhood Testnet')
    }

    setLoading(true); setTxStatus(null); setTxHash(null)
    try {
      // Route to correct API based on active chain
      const isRh = activeEvmChain === 'robinhood'
      const apiBase = isRh ? '/rh-gateway' : '/gateway'
      const endpoint = mode === 'buy' ? `${apiBase}/mint` : `${apiBase}/redeem`
      const body = mode === 'buy'
        ? { ticker, usdcAmount: numAmount, walletAddress: address }
        : { ticker, osAmount: numAmount, walletAddress: address }

      setTxStatus(`Preparing on ${isRh ? 'Robinhood' : 'Arbitrum'}...`)
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)

      const data = json.data

      // Step 1: Approve (skip if null — e.g. Robinhood native token transfer)
      if (data.approveTx) {
        setTxStatus('Step 1/2: Approving...')
        const h1 = await walletClient.sendTransaction({
          to: data.approveTx.to as `0x${string}`,
          data: data.approveTx.data as `0x${string}`,
          chain: chain as any, account: address,
        })
        setTxStatus('Step 1/2: Waiting for approval confirmation...')
        const approved = await waitForTx(h1, activeEvmChain)
        if (!approved) throw new Error('Approval transaction failed on chain')
      }

      // Step 2: Execute (Buy / Sell / Transfer)
      const actionTx = mode === 'buy' ? data.mintTx : data.redeemTx
      setTxStatus(data.approveTx ? (mode === 'buy' ? 'Step 2/2: Buying...' : 'Step 2/2: Selling...') : 'Selling...')
      const h2 = await walletClient.sendTransaction({
        to: actionTx.to as `0x${string}`,
        data: actionTx.data as `0x${string}`,
        chain: chain as any, account: address,
      })
      setTxHash(h2)
      setTxStatus('Confirming on chain...')
      const success = await waitForTx(h2, activeEvmChain)
      if (!success) throw new Error('Transaction reverted on chain. Price may have expired — try again.')

      setTxStatus('Success!')
      fetchAssets()
      fetchBalances()
    } catch (err: any) {
      setTxStatus(`Error: ${err?.message?.slice(0, 120)}`)
    } finally { setLoading(false) }
  }

  const [solTxHash, setSolTxHash] = useState<string | null>(null)
  const [swapStep, setSwapStep] = useState<string | null>(null)

  // Clear status when mode or chain changes
  useEffect(() => {
    setTxStatus(null); setTxHash(null); setSolTxHash(null); setSwapStep(null)
    setBestRoutes([])
  }, [mode, swapSrc, swapDest, ticker])

  // Fetch Intent Router best routes when Buy amount changes
  useEffect(() => {
    if (mode !== 'buy' || !numAmount || numAmount <= 0) { setBestRoutes([]); return }
    const timer = setTimeout(async () => {
      setRouteLoading(true)
      try {
        const res = await fetch(`${API_BASE}/intent/route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asset: ticker, amountUsd: numAmount, riskTolerance: 'medium' }),
        })
        const json = await res.json()
        if (json.ok && json.data?.routes) {
          setBestRoutes(json.data.routes.slice(0, 4))
        }
      } catch {}
      setRouteLoading(false)
    }, 600) // debounce 600ms
    return () => clearTimeout(timer)
  }, [mode, ticker, numAmount])

  const handleSwap = async () => {
    if (!isConnected || !walletClient || !address) return setTxStatus('Connect wallet first')
    if (!swapDestAddr) return setTxStatus('Enter destination address')

    // Check user is on the SOURCE chain
    const srcChainId = CHAIN_RPC[swapSrc]?.chainId
    if (srcChainId && chain?.id !== srcChainId) {
      try { switchChain({ chainId: srcChainId }) } catch {}
      return setTxStatus(`Switch to ${swapSrc === 'robinhood' ? 'Robinhood Testnet' : swapSrc === 'arbitrum' ? 'Arbitrum Sepolia' : swapSrc}`)
    }

    setLoading(true); setTxStatus(null); setTxHash(null); setSolTxHash(null); setSwapStep(null)
    try {
      // Step 1: Initiate bridge
      setSwapStep('1/4')
      setTxStatus('Preparing cross-chain swap...')
      const res = await fetch(`${API_BASE}/bridge/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker, amount: numAmount,
          srcChain: swapSrc, destChain: swapDest,
          destAddress: swapDestAddr, walletAddress: address,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      const data = json.data

      if (data.burnTx) {
        // Step 2: Approve (skip if null — Robinhood native transfer doesn't need approve)
        if (data.approveTx) {
          setSwapStep('2/4')
          setTxStatus('Step 2/4: Approve token spend...')
          const h1 = await walletClient.sendTransaction({
            to: data.approveTx.to as `0x${string}`,
            data: data.approveTx.data as `0x${string}`,
            chain: chain as any, account: address,
          })
          setTxStatus('Step 2/4: Waiting for approval confirmation...')
          await waitForTx(h1, swapSrc)
        }

        // Step 3: Burn/Transfer on source chain
        setSwapStep('3/4')
        setTxStatus('Step 3/4: Selling token on ' + swapSrc + '...')
        const h2 = await walletClient.sendTransaction({
          to: data.burnTx.to as `0x${string}`,
          data: data.burnTx.data as `0x${string}`,
          chain: chain as any, account: address,
        })
        setTxHash(h2)
        setTxStatus('Step 3/4: Waiting for confirmation on ' + swapSrc + '...')

        // Wait for source chain tx to confirm before minting on dest
        const burnSuccess = await waitForTx(h2, swapSrc)
        if (!burnSuccess) throw new Error('Source chain transaction failed. No tokens were swapped.')

        setTxStatus('Step 3/4: Confirmed on ' + swapSrc + '!')

        // Step 4: Backend mints on dest chain
        setSwapStep('4/4')
        setTxStatus('Step 4/4: Buying token on ' + swapDest + '...')

        // Call bridge/complete to mint on dest chain
        const completeRes = await fetch(`${API_BASE}/bridge/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bridgeId: data.bridgeId, burnTxHash: h2 }),
        })
        const completeJson = await completeRes.json()

        if (completeJson.ok) {
          const mintTx = completeJson.data?.mintTxHash ?? ''
          if (mintTx && mintTx.length > 20) {
            if (swapDest === 'solana') {
              setSolTxHash(mintTx)
            } else {
              // EVM dest (arbitrum/robinhood) — show as second tx hash
              setTxHash(mintTx)
            }
          }
          setTxStatus(`Cross-chain swap complete! Token delivered to ${swapDest}.`)
          setSwapStep(null)
        } else {
          setTxStatus(`Swap sent. Delivery pending — auto-relay will process shortly.`)
          setSwapStep(null)
        }

        fetchAssets()
        fetchBalances()
      } else {
        setTxStatus(`${swapSrc} → ${swapDest} swap: coming soon`)
      }
    } catch (err: any) {
      setTxStatus(`Error: ${err?.message?.slice(0, 80)}`)
      setSwapStep(null)
    } finally { setLoading(false) }
  }

  const cardStyle: React.CSSProperties = {
    maxWidth: 520, margin: '0 auto', padding: 24,
    background: '#fff', borderRadius: 16,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    border: '1px solid #E2E8F0',
  }

  const tabStyle = (active: boolean, color?: string): React.CSSProperties => ({
    padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontWeight: 700, fontSize: 13,
    background: active ? (color ?? '#059669') : '#F1F5F9',
    color: active ? '#fff' : '#64748B',
  })

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', borderRadius: 10,
    border: '1.5px solid #E2E8F0', fontSize: 16, fontWeight: 600,
    outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={cardStyle}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button type="button" style={tabStyle(mode === 'buy')} onClick={() => setMode('buy')}>Buy</button>
        <button type="button" style={tabStyle(mode === 'sell')} onClick={() => setMode('sell')}>Sell</button>
        <button type="button" style={tabStyle(mode === 'swap', '#7C3AED')} onClick={() => setMode('swap')}>
          Cross-Chain Swap
        </button>
      </div>

      {/* Asset selector */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Stock
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {STOCKS.map(t => (
            <button key={t} type="button" onClick={() => setTicker(t)} style={{
              padding: '6px 12px', borderRadius: 8, border: ticker === t ? '2px solid #059669' : '1px solid #E2E8F0',
              background: ticker === t ? '#ECFDF5' : '#fff', cursor: 'pointer',
              fontWeight: 700, fontSize: 12, color: ticker === t ? '#059669' : '#64748B',
            }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Price display for Buy/Sell — shows chain-specific price */}
      {currentAsset && mode !== 'swap' && (
        <div style={{
          padding: 12, borderRadius: 10, background: '#F8FAFC', marginBottom: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>
              Price ({activeEvmChain === 'robinhood' ? 'Robinhood' : 'Arbitrum'})
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>
              ${(currentAsset.prices?.[activeEvmChain]?.price ?? currentAsset.oraclePrice).toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: '#94A3B8' }}>
              {currentAsset.prices?.[activeEvmChain]?.source ?? ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>Network</div>
            <div style={{
              fontSize: 12, fontWeight: 700,
              color: activeEvmChain === 'robinhood' ? '#00C805' : '#28A0F0',
            }}>
              {activeEvmChain === 'robinhood' ? 'Robinhood' : 'Arbitrum'}
            </div>
          </div>
        </div>
      )}

      {/* Swap: show both chain prices */}
      {currentAsset && mode === 'swap' && (
        <div style={{
          padding: 12, borderRadius: 10, background: '#F5F3FF', marginBottom: 16,
          border: '1px solid #DDD6FE',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: '#7C3AED', fontWeight: 700 }}>SELL ON {swapSrc.toUpperCase()}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#5B21B6' }}>
                ${srcChainPrice.toFixed(2)}
              </div>
              <div style={{ fontSize: 10, color: '#94A3B8' }}>
                {srcBestSource || 'loading...'} (best sell)
              </div>
            </div>
            <div style={{ fontSize: 20, color: '#7C3AED', alignSelf: 'center' }}>→</div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#7C3AED', fontWeight: 700 }}>BUY ON {swapDest.toUpperCase()}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#5B21B6' }}>
                ${destChainPrice.toFixed(2)}
              </div>
              <div style={{ fontSize: 10, color: '#94A3B8' }}>
                {destBestSource || 'loading...'} (best buy)
              </div>
            </div>
          </div>
          {srcChainPrice > 0 && destChainPrice > 0 && (
            <div style={{
              fontSize: 11, fontWeight: 700, textAlign: 'center', padding: '4px 8px',
              borderRadius: 6,
              background: srcChainPrice < destChainPrice ? '#FEF2F2' : '#F0FDF4',
              color: srcChainPrice < destChainPrice ? '#DC2626' : '#059669',
            }}>
              Spread: {((destChainPrice - srcChainPrice) / srcChainPrice * 100).toFixed(2)}%
              {srcChainPrice < destChainPrice ? ' (you lose on price)' : ' (you gain on price)'}
            </div>
          )}
        </div>
      )}

      {/* Cross-chain swap: chain selector */}
      {mode === 'swap' && (
        <div style={{ marginBottom: 16, padding: 14, borderRadius: 10, background: '#F5F3FF', border: '1px solid #DDD6FE' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: '#7C3AED', fontWeight: 700, marginBottom: 4 }}>FROM</div>
              <select value={swapSrc} onChange={e => {
                const v = e.target.value as ChainId
                setSwapSrc(v)
                // Auto-set dest to first chain that isn't src
                const other = CHAINS.find(c => c.id !== v)
                if (other) setSwapDest(other.id)
              }} style={{ ...inputStyle, fontSize: 13, padding: '8px 10px' }}>
                {CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 20, color: '#7C3AED', fontWeight: 800, paddingTop: 18 }}>→</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: '#7C3AED', fontWeight: 700, marginBottom: 4 }}>TO</div>
              <select value={swapDest} onChange={e => setSwapDest(e.target.value as ChainId)}
                style={{ ...inputStyle, fontSize: 13, padding: '8px 10px', background: '#EDE9FE', color: '#5B21B6' }}>
                {CHAINS.filter(c => c.id !== swapSrc).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#7C3AED', fontWeight: 700, marginBottom: 4 }}>Destination Address</div>
            <input
              value={swapDestAddr}
              onChange={e => setSwapDestAddr(e.target.value)}
              placeholder={swapDest === 'solana' ? 'Solana address (base58)' : '0x... EVM address (Arbitrum/Robinhood)'}
              style={{ ...inputStyle, fontSize: 12 }}
            />
          </div>
        </div>
      )}

      {/* Amount input with balance */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' }}>
            {mode === 'buy' ? 'USDC Amount' : mode === 'sell' ? `${ticker} Amount` : `${ticker} to Swap`}
          </label>
          {isConnected && (() => {
            // Show balance from the correct chain
            const isSwap = mode === 'swap'
            const balChain = isSwap ? swapSrc : activeEvmChain

            if (mode === 'buy') {
              // Buy mode: show USDC (or MockUSDC) balance for active chain
              const uBal = activeUsdcBalance
              return (
                <div style={{ fontSize: 11, color: '#64748B' }}>
                  Balance: <span style={{ fontWeight: 700, color: uBal > 0 ? '#0F172A' : '#DC2626' }}>
                    {uBal.toFixed(2)} USDC
                  </span>
                  {uBal > 0 && (
                    <button type="button" onClick={() => setAmount(uBal.toFixed(2))} style={{
                      marginLeft: 6, padding: '2px 6px', borderRadius: 4,
                      border: '1px solid #CBD5E1', background: '#F8FAFC',
                      fontSize: 10, fontWeight: 700, color: '#2563EB', cursor: 'pointer',
                    }}>MAX</button>
                  )}
                </div>
              )
            }

            // Sell / Swap mode: show token balance from correct chain
            // On Robinhood: show native stock token (rhBalance, 18 dec)
            // On Arbitrum: show osToken (arbBalance, 6 dec)
            const nativeBal = rhBalance[ticker] ?? 0
            const osBal = arbBalance[ticker] ?? 0
            const tokenBal = balChain === 'robinhood' ? nativeBal
              : balChain === 'solana' ? (solBalance[ticker] ?? 0)
              : osBal
            const chainLabel = ` (${balChain})`

            return (
              <div style={{ fontSize: 11, color: '#64748B' }}>
                Balance{chainLabel}: <span style={{ fontWeight: 700, color: tokenBal > 0 ? '#0F172A' : '#DC2626' }}>
                  {tokenBal.toFixed(6)} {ticker}
                </span>
                {tokenBal > 0 && (
                  <button type="button" onClick={() => setAmount(tokenBal.toFixed(6))} style={{
                    marginLeft: 6, padding: '2px 6px', borderRadius: 4,
                    border: '1px solid #CBD5E1', background: '#F8FAFC',
                    fontSize: 10, fontWeight: 700, color: '#2563EB', cursor: 'pointer',
                  }}>MAX</button>
                )}
                {balChain === 'robinhood' && tokenBal > 0 && (
                  <button type="button" onClick={() => setShowBreakdown(!showBreakdown)} style={{
                    marginLeft: 6, padding: '1px 5px', borderRadius: 4,
                    border: '1px solid #CBD5E1', background: '#F8FAFC',
                    fontSize: 9, fontWeight: 700, color: '#7C3AED', cursor: 'pointer',
                  }}>{showBreakdown ? '▲' : '▼'} Details</button>
                )}
              </div>
            )
          })()}
          {/* Breakdown panel for Robinhood */}
          {activeEvmChain === 'robinhood' && showBreakdown && rhBreakdown[ticker] && mode !== 'buy' && (
            <div style={{
              marginTop: 4, marginBottom: 8, padding: '8px 12px', borderRadius: 8,
              background: '#F8FAFC', border: '1px solid #E2E8F0', fontSize: 11,
            }}>
              <div style={{ fontWeight: 700, color: '#334155', marginBottom: 4 }}>Holdings Breakdown — {ticker}</div>
              {rhBreakdown[ticker].native > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span style={{ color: '#00C805' }}>● Robinhood (native)</span>
                  <span style={{ fontWeight: 700 }}>{rhBreakdown[ticker].native.toFixed(6)}</span>
                </div>
              )}
              {rhBreakdown[ticker].osToken > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span style={{ color: '#7C3AED' }}>● OnStock (osToken)</span>
                  <span style={{ fontWeight: 700 }}>{rhBreakdown[ticker].osToken.toFixed(6)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 0', borderTop: '1px solid #E2E8F0', marginTop: 4 }}>
                <span style={{ fontWeight: 700, color: '#0F172A' }}>Total</span>
                <span style={{ fontWeight: 800, color: '#0F172A' }}>{rhBreakdown[ticker].total.toFixed(6)}</span>
              </div>
            </div>
          )}
        </div>
        <input
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder={mode === 'buy' ? 'e.g. 500' : 'e.g. 1.5'}
          style={{ ...inputStyle, marginTop: 6 }}
        />
      </div>

      {/* Expected output: Buy/Sell */}
      {numAmount > 0 && price > 0 && mode !== 'swap' && (
        <div style={{
          padding: 12, borderRadius: 10, marginBottom: 16,
          background: '#F0FDF4', border: '1px solid #BBF7D0',
        }}>
          <div style={{ fontSize: 11, color: '#059669', fontWeight: 700 }}>You Receive</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#065F46' }}>
            {mode === 'buy'
              ? `${expectedOut.toFixed(6)} ${ticker}`
              : `$${expectedOut.toFixed(2)} USDC`
            }
          </div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
            @ ${price.toFixed(2)} per {ticker} | 0.5% fee
          </div>
        </div>
      )}

      {/* Intent Router: Best routes for Buy */}
      {mode === 'buy' && numAmount > 0 && (bestRoutes.length > 0 || routeLoading) && (
        <div style={{
          padding: 12, borderRadius: 10, marginBottom: 16,
          background: '#EFF6FF', border: '1px solid #BFDBFE',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8', marginBottom: 8 }}>
            Optimal Routes (Intent Router)
          </div>
          {routeLoading ? (
            <div style={{ fontSize: 12, color: '#64748B' }}>Scanning all chains...</div>
          ) : (
            bestRoutes.map((r: any, i: number) => {
              const nv = r.netValue ?? {}
              const score = r.rwaScore?.overall ?? 0
              const isFirst = i === 0
              return (
                <div key={i} style={{
                  padding: '8px 10px', borderRadius: 8, marginBottom: 4,
                  background: isFirst ? '#DBEAFE' : '#fff',
                  border: isFirst ? '2px solid #3B82F6' : '1px solid #E2E8F0',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: isFirst ? '#1D4ED8' : '#334155' }}>
                        {isFirst ? '★ ' : ''}{r.tagLabel}
                      </span>
                      {r.projectedApy > 0 && (
                        <span style={{ fontSize: 10, color: '#059669', marginLeft: 6 }}>
                          +{r.projectedApy.toFixed(1)}% APY
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: isFirst ? '#1D4ED8' : '#334155' }}>
                        ${nv.netValueUsd?.toFixed(2) ?? '—'}
                      </div>
                      <div style={{ fontSize: 9, color: '#94A3B8' }}>
                        net value | score {score}
                      </div>
                    </div>
                  </div>
                  {isFirst && nv.chain && (
                    <div style={{ fontSize: 10, color: '#6B7280', marginTop: 4 }}>
                      Best on <b>{nv.chain}</b> | Gas ${nv.gasCostUsd?.toFixed(2)} | Entry {nv.entryPremiumPct?.toFixed(2)}%
                      {nv.breakEvenDays && ` | Break-even ${nv.breakEvenDays}d`}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Expected output: Cross-Chain Swap — detailed breakdown */}
      {numAmount > 0 && mode === 'swap' && srcChainPrice > 0 && destChainPrice > 0 && (
        <div style={{
          padding: 14, borderRadius: 10, marginBottom: 16,
          background: '#F5F3FF', border: '1px solid #DDD6FE',
        }}>
          <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.8 }}>
            <div>Sell <b>{numAmount} {ticker}</b> on {swapSrc} @ <b>${srcChainPrice.toFixed(2)}</b> = ${(numAmount * srcChainPrice).toFixed(2)}</div>
            <div>Cross-chain fee (0.05%): <span style={{ color: '#DC2626' }}>-${(numAmount * srcChainPrice * 0.0005).toFixed(2)}</span></div>
            <div>USDC bridged to {swapDest}: <b>${(numAmount * srcChainPrice * 0.9995).toFixed(2)}</b></div>
            <div>Buy {ticker} on {swapDest} @ <b>${destChainPrice.toFixed(2)}</b></div>
          </div>
          <div style={{ marginTop: 10, borderTop: '1px solid #DDD6FE', paddingTop: 10 }}>
            <div style={{ fontSize: 11, color: '#7C3AED', fontWeight: 700 }}>You Receive on {swapDest}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#5B21B6' }}>
              {expectedOut.toFixed(6)} {ticker}
            </div>
          </div>
        </div>
      )}

      {/* Execute button */}
      <button
        type="button"
        onClick={mode === 'swap' ? handleSwap : handleBuySell}
        disabled={loading || numAmount <= 0}
        style={{
          width: '100%', padding: 14, borderRadius: 12, border: 'none',
          background: loading ? '#94A3B8' : mode === 'swap' ? '#7C3AED' : '#059669',
          color: '#fff', fontWeight: 800, fontSize: 15,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {(() => {
          // Check correct wallet based on mode and source chain
          const needsSol = mode === 'swap' && swapSrc === 'solana'
          const needsEvm = !needsSol
          const walletReady = needsEvm ? isConnected : needsSol ? solConnected : isConnected

          if (!walletReady) return needsSol ? 'Connect Phantom' : 'Connect Wallet'
          if (loading) return 'Processing...'
          if (mode === 'buy') return `Buy ${ticker}`
          if (mode === 'sell') return `Sell ${ticker}`
          return `Swap ${ticker}: ${swapSrc} → ${swapDest}`
        })()}
      </button>

      {/* Status */}
      {txStatus && (
        <div style={{
          marginTop: 12, padding: 12, borderRadius: 8, fontSize: 13, color: '#334155',
          background: txStatus.includes('complete') || txStatus.includes('Success') ? '#F0FDF4' : '#F1F5F9',
          border: txStatus.includes('complete') || txStatus.includes('Success') ? '1px solid #BBF7D0' : '1px solid #E2E8F0',
          wordBreak: 'break-all', overflowWrap: 'break-word',
        }}>
          {swapStep && <span style={{ fontWeight: 700, color: '#7C3AED', marginRight: 6 }}>[{swapStep}]</span>}
          {txStatus}
        </div>
      )}
      {txHash && (
        <a
          href={`${(CHAIN_RPC[activeEvmChain] ?? CHAIN_RPC.arbitrum).explorer}/tx/${txHash}`}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'block', marginTop: 8, fontSize: 12, color: '#2563EB', fontWeight: 600 }}
        >
          {activeEvmChain === 'robinhood' ? 'Robinhood' : 'Arbitrum'} Tx →
        </a>
      )}
      {solTxHash && (
        <a
          href={`https://explorer.solana.com/tx/${solTxHash}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'block', marginTop: 4, fontSize: 12, color: '#059669', fontWeight: 600 }}
        >
          Solana Tx →
        </a>
      )}

      {/* Info */}
      <div style={{
        marginTop: 20, padding: 14, borderRadius: 10,
        background: '#F8FAFC', border: '1px solid #E2E8F0',
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
          How it works
        </div>
        <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>
          {mode === 'buy' && `Pay USDC to buy ${ticker} at real-time market price. No platform fee.`}
          {mode === 'sell' && `Sell your ${ticker} for USDC at current market price. No platform fee.`}
          {mode === 'swap' && `Swap ${ticker} from ${swapSrc} to ${swapDest}. Your token is sold on the source chain, USDC is bridged, and the same token is bought on the destination chain. 0.05% fee covers cross-chain costs.`}
        </div>
      </div>
    </div>
  )
}
