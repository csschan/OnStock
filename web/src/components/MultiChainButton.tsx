'use client'

import { useState, useRef, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { useSolanaNetwork, type SolanaNetwork } from './SolanaWalletProvider'
import { usePhantom } from './PhantomProvider'

const SOLANA_NETS: { id: SolanaNetwork; label: string; desc: string; color: string }[] = [
  { id: 'localnet', label: 'Localnet',  desc: 'localhost:8899',              color: '#F59E0B' },
  { id: 'devnet',   label: 'Devnet',    desc: 'api.devnet.solana.com',      color: '#8B5CF6' },
  { id: 'mainnet',  label: 'Mainnet',   desc: 'api.mainnet-beta.solana.com', color: '#16A34A' },
]

const EVM_CHAINS: { id: number; label: string; color: string }[] = [
  { id: 1,     label: 'Ethereum',        color: '#627EEA' },
  { id: 56,    label: 'BNB Chain',       color: '#F0B90B' },
  { id: 8453,  label: 'Base',            color: '#0052FF' },
  { id: 42161, label: 'Arbitrum',        color: '#28A0F0' },
  { id: 4663,  label: 'Robinhood Chain', color: '#00C805' },
  { id: 195,   label: 'X Layer Testnet', color: '#6366F1' },
]

function shortAddr(addr: string) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`
}

export default function MultiChainButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Solana — direct Phantom API
  const { network, setNetwork, color: solColor, label: solLabel } = useSolanaNetwork()
  const { publicKey, connected: solConnected, connect: connectPhantom, disconnect: solDisconnect } = usePhantom()

  // EVM
  const { address: evmAddr, isConnected: evmConnected, chain: evmChain } = useAccount()
  const { connect: evmConnect, connectors } = useConnect()
  const { disconnect: evmDisconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()

  function connectEvm() {
    // Priority: OKX Wallet (window.okxwallet) → MetaMask → any injected
    // window.okxwallet is separate from window.ethereum, never Phantom
    const okx = connectors.find(c => c.id === 'okxwallet')
    if (okx) { evmConnect({ connector: okx }); return }
    const mm = connectors.find(c => c.id === 'metaMask')
    if (mm) { evmConnect({ connector: mm }); return }
    if (connectors[0]) evmConnect({ connector: connectors[0] })
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const hasAnyWallet = solConnected || evmConnected
  const activeColor = solConnected ? solColor : evmChain ? (EVM_CHAINS.find(c => c.id === evmChain.id)?.color ?? '#64748B') : '#2563EB'

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Main button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
          background: hasAnyWallet ? `${activeColor}14` : '#2563EB',
          color: hasAnyWallet ? '#0F172A' : '#fff',
          border: hasAnyWallet ? `1px solid ${activeColor}40` : 'none',
          cursor: 'pointer',
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: hasAnyWallet ? activeColor : '#fff',
          boxShadow: `0 0 6px ${hasAnyWallet ? activeColor : '#fff'}`,
        }} />
        {hasAnyWallet ? (
          <>
            {solConnected && <span>SOL {solLabel}</span>}
            {solConnected && evmConnected && <span style={{ color: '#CBD5E1' }}>|</span>}
            {evmConnected && <span>{evmChain?.name ?? 'EVM'}</span>}
          </>
        ) : (
          'Connect Wallet'
        )}
        <span style={{ fontSize: 9, opacity: 0.5 }}>▼</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 8,
          background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14,
          boxShadow: '0 12px 40px rgba(0,0,0,0.15)', width: 300, zIndex: 100,
          overflow: 'hidden',
        }}>
          {/* ── Solana section ── */}
          <div style={{ padding: '10px 14px 6px', borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.08em' }}>SOLANA</span>
              {solConnected ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#64748B', fontFamily: 'monospace' }}>
                    {shortAddr(publicKey!.toBase58())}
                  </span>
                  <button onClick={() => solDisconnect()} style={{
                    fontSize: 9, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer',
                  }}>Disconnect</button>
                </div>
              ) : (
                <button
                  onClick={async () => { setOpen(false); await connectPhantom() }}
                  style={{
                    fontSize: 10, fontWeight: 700, color: '#fff', background: '#9945FF',
                    border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
                  }}
                >
                  Connect Phantom
                </button>
              )}
            </div>
            {SOLANA_NETS.map(n => (
              <button
                key={n.id}
                onClick={() => { setNetwork(n.id); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '7px 8px', marginBottom: 2, borderRadius: 8, border: 'none',
                  background: network === n.id ? `${n.color}14` : 'transparent',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', background: n.color,
                  boxShadow: network === n.id ? `0 0 8px ${n.color}` : 'none', flexShrink: 0,
                }} />
                <span style={{ fontSize: 11, fontWeight: network === n.id ? 700 : 500, color: network === n.id ? n.color : '#334155', flex: 1 }}>
                  {n.label}
                </span>
                <span style={{ fontSize: 9, color: '#94A3B8' }}>{n.desc}</span>
                {network === n.id && <span style={{ fontSize: 10, color: n.color }}>✓</span>}
              </button>
            ))}
          </div>

          {/* ── EVM section ── */}
          <div style={{ padding: '10px 14px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.08em' }}>EVM CHAINS</span>
              {evmConnected ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#64748B', fontFamily: 'monospace' }}>
                    {shortAddr(evmAddr!)}
                  </span>
                  <button onClick={() => evmDisconnect()} style={{
                    fontSize: 9, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer',
                  }}>Disconnect</button>
                </div>
              ) : (
                <button
                  onClick={() => { connectEvm(); setOpen(false) }}
                  style={{
                    fontSize: 10, fontWeight: 700, color: '#fff', background: '#627EEA',
                    border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
                  }}
                >Connect EVM (MetaMask / OKX)</button>
              )}
            </div>
            {EVM_CHAINS.map(c => {
              const isActive = evmChain?.id === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    if (evmConnected && switchChain) switchChain({ chainId: c.id })
                    setOpen(false)
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '7px 8px', marginBottom: 2, borderRadius: 8, border: 'none',
                    background: isActive ? `${c.color}14` : 'transparent',
                    cursor: evmConnected ? 'pointer' : 'default',
                    opacity: evmConnected ? 1 : 0.5, textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', background: c.color,
                    border: c.color === '#000000' ? '1px solid #CBD5E1' : 'none',
                    boxShadow: isActive ? `0 0 8px ${c.color}` : 'none', flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 11, fontWeight: isActive ? 700 : 500, color: isActive ? c.color : '#334155', flex: 1 }}>
                    {c.label}
                  </span>
                  {isActive && <span style={{ fontSize: 10, color: c.color }}>✓</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
