'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { DefiYield } from '@/lib/api'

const EarnActionPanel = dynamic(() => import('./EarnActionPanel'), { ssr: false })

const PROTOCOL_META: Record<string, { color: string; bg: string; border: string; logo?: string }> = {
  kamino:  { color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' },
  nestusd: { color: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
  raydium: { color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
  shift:   { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  onstock: { color: '#059669', bg: '#F0FDF4', border: '#86EFAC', logo: '◎' },
}

const RISK_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  low:    { label: 'Low Risk',    color: '#16A34A', bg: '#F0FDF4' },
  medium: { label: 'Medium Risk', color: '#D97706', bg: '#FFFBEB' },
  high:   { label: 'High Risk',   color: '#DC2626', bg: '#FEF2F2' },
}

const TYPE_LABEL: Record<string, string> = {
  lending: 'Lending', cdp: 'CDP / Mint', lp: 'Liquidity Pool', leveraged: 'Leveraged Token',
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return n > 0 ? `$${n.toFixed(0)}` : '-'
}

export default function YieldCardClient({ y, autoExpand, defaultTab }: {
  y: DefiYield
  autoExpand?: boolean
  defaultTab?: 'deposit' | 'withdraw'
}) {
  const [expanded, setExpanded] = useState(autoExpand ?? false)
  const proto = PROTOCOL_META[y.protocol] ?? { color: '#64748B', bg: '#F8FAFC', border: '#E2E8F0' }
  const risk = RISK_BADGE[y.riskLevel] ?? RISK_BADGE.medium
  const apyColor = y.netApy >= 10 ? '#16A34A' : y.netApy >= 3 ? '#2563EB' : '#64748B'

  const actionLabel = y.protocol === 'kamino' ? 'Supply on OnStock'
    : y.protocol === 'onstock' ? 'Deposit into Vault'
    : 'View Strategy'

  return (
    <div
      style={{
        borderRadius: 12, border: `1px solid ${expanded ? proto.color + '66' : proto.border}`,
        background: 'white',
        boxShadow: expanded ? '0 4px 20px rgba(0,0,0,0.08)' : 'none',
        transition: 'box-shadow 0.2s, border-color 0.2s',
      }}
    >
      {/* Card body */}
      <div style={{ padding: '16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: proto.color, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: '#fff', fontSize: proto.logo ? 16 : 12, fontWeight: 800,
            }}>
              {proto.logo ?? y.protocolName.charAt(0)}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{y.protocolName}</div>
              <div style={{ fontSize: 10, color: '#94A3B8' }}>{TYPE_LABEL[y.type] ?? y.type}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: apyColor, lineHeight: 1 }}>
              {y.netApy > 0 ? `${y.netApy.toFixed(2)}%` : '—'}
            </div>
            <div style={{ fontSize: 9, color: '#94A3B8', textAlign: 'right' }}>APY</div>
          </div>
        </div>

        {/* Action label */}
        <div style={{ fontSize: 11, color: '#334155', marginBottom: 10, lineHeight: 1.4 }}>
          {y.actionLabel}
        </div>

        {/* OnStock Vault badges */}
        {y.protocol === 'onstock' && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
              background: '#F0FDF4', color: '#16A34A', border: '1px solid #86EFAC' }}>
              Receipt Token
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
              background: '#F0FDF4', color: '#16A34A', border: '1px solid #86EFAC' }}>
              Non-custodial
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
              background: '#FFF7ED', color: '#EA580C', border: '1px solid #FED7AA' }}>
              Devnet
            </span>
          </div>
        )}

        {/* Metrics */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          {y.ltv != null && (
            <div>
              <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase' }}>Max LTV</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>{Math.round(y.ltv)}%</div>
            </div>
          )}
          {y.borrowApy != null && y.borrowApy > 0 && (
            <div>
              <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase' }}>Borrow APR</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>{y.borrowApy.toFixed(1)}%</div>
            </div>
          )}
          {y.tvlUsd > 0 && (
            <div>
              <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase' }}>TVL</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>{fmt(y.tvlUsd)}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px',
            borderRadius: 10, color: risk.color, background: risk.bg,
          }}>
            {risk.label}
          </span>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: expanded ? proto.color : proto.bg,
              color: expanded ? '#fff' : proto.color,
              border: `1px solid ${proto.border}`,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {expanded ? 'Close ↑' : `${actionLabel} ↓`}
          </button>
        </div>
      </div>

      {/* Expandable action panel */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${proto.border}`, padding: '0 16px 16px' }}>
          <EarnActionPanel yield={y} defaultTab={defaultTab} />
        </div>
      )}
    </div>
  )
}
