'use client'

import { useState, useRef, useEffect } from 'react'
import { useSolanaNetwork, type SolanaNetwork } from './SolanaWalletProvider'

const NETWORKS: { id: SolanaNetwork; label: string; desc: string; color: string }[] = [
  { id: 'localnet', label: 'Localnet',  desc: 'localhost:8899',              color: '#F59E0B' },
  { id: 'devnet',   label: 'Devnet',    desc: 'api.devnet.solana.com',      color: '#8B5CF6' },
  { id: 'mainnet',  label: 'Mainnet',   desc: 'api.mainnet-beta.solana.com', color: '#16A34A' },
]

export default function SolanaNetworkSwitcher() {
  const { network, setNetwork, color } = useSolanaNetwork()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const current = NETWORKS.find(n => n.id === network)!

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
          background: `${color}18`, color, border: `1px solid ${color}40`,
          cursor: 'pointer',
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%', background: color,
          boxShadow: `0 0 6px ${color}`,
        }} />
        Solana {current.label}
        <span style={{ fontSize: 9, opacity: 0.6 }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 220, zIndex: 100,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 12px', fontSize: 10, color: '#94A3B8', fontWeight: 700, letterSpacing: '0.05em', borderBottom: '1px solid #F1F5F9' }}>
            SWITCH SOLANA NETWORK
          </div>
          {NETWORKS.map(n => (
            <button
              key={n.id}
              onClick={() => { setNetwork(n.id); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '10px 12px', border: 'none',
                background: network === n.id ? `${n.color}10` : 'transparent',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: n.color,
                boxShadow: network === n.id ? `0 0 8px ${n.color}` : 'none',
                flexShrink: 0,
              }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: network === n.id ? n.color : '#0F172A' }}>
                  {n.label} {network === n.id && '✓'}
                </div>
                <div style={{ fontSize: 10, color: '#94A3B8' }}>{n.desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
