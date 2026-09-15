'use client'

import { useEffect, useRef, useState } from 'react'

interface JupiterSwapWidgetProps {
  outputMint: string   // token contract address on Solana
  tokenSymbol: string
  action: 'buy' | 'sell'
}

// Jupiter Terminal V2 — 嵌入式 swap widget
// 文档: https://station.jup.ag/docs/jupiter-terminal/jupiter-terminal
declare global {
  interface Window {
    Jupiter?: {
      init: (config: any) => void
      close: () => void
    }
  }
}

export default function JupiterSwapWidget({ outputMint, tokenSymbol, action }: JupiterSwapWidgetProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Load Jupiter Terminal script
    if (document.getElementById('jupiter-terminal-script')) {
      setLoaded(true)
      return
    }

    const script = document.createElement('script')
    script.id = 'jupiter-terminal-script'
    script.src = 'https://terminal.jup.ag/main-v3.js'
    script.async = true
    script.onload = () => setLoaded(true)
    script.onerror = () => setError('Failed to load Jupiter Terminal')
    document.head.appendChild(script)
  }, [])

  useEffect(() => {
    if (!loaded || !window.Jupiter || !containerRef.current) return

    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

    try {
      window.Jupiter.init({
        displayMode: 'integrated',
        integratedTargetId: 'jupiter-swap-container',
        endpoint: 'https://mainnet.helius-rpc.com/?api-key=0a09a4a3-a442-4f09-a45a-5506873ab0db',
        formProps: action === 'buy'
          ? { initialInputMint: USDC_MINT, initialOutputMint: outputMint, fixedOutputMint: true }
          : { initialInputMint: outputMint, initialOutputMint: USDC_MINT, fixedInputMint: true },
        strictTokenList: false,
        defaultExplorer: 'Solscan',
      })
    } catch (e: any) {
      setError(e.message || 'Failed to initialize Jupiter')
    }

    return () => {
      try { window.Jupiter?.close() } catch {}
    }
  }, [loaded, outputMint, action])

  if (error) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[#DC2626] mb-2">{error}</p>
        <a
          href={`https://jup.ag/swap/USDC-${outputMint}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-medium text-[#9945FF] hover:underline"
        >
          Open Jupiter directly →
        </a>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-[#94A3B8]">
        <div className="w-4 h-4 border-2 border-[#9945FF] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Loading Jupiter...</span>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border"
          style={{ color: '#9945FF', borderColor: '#9945FF40', background: '#9945FF10' }}>
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#9945FF' }} />
          Solana
        </span>
        <span className="text-xs text-[#94A3B8]">via Jupiter</span>
      </div>
      <div
        id="jupiter-swap-container"
        ref={containerRef}
        style={{ minHeight: 400 }}
      />
    </div>
  )
}
