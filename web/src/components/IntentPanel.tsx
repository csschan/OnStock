'use client'

import { useState } from 'react'
import { usePhantom } from '@/components/PhantomProvider'
import { useIntentExecute } from '@/hooks/useIntentExecute'
import { useXLayerExecute } from '@/hooks/useXLayerExecute'
import { useAccount, useConnect } from 'wagmi'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

const XSTOCK_ASSETS = [
  { ticker: 'TSLA',  name: 'Tesla'          },
  { ticker: 'NVDA',  name: 'NVIDIA'         },
  { ticker: 'SPY',   name: 'S&P 500'        },
  { ticker: 'AAPL',  name: 'Apple'          },
  { ticker: 'GOOGL', name: 'Google'         },
  { ticker: 'META',  name: 'Meta'           },
  { ticker: 'COIN',  name: 'Coinbase'       },
  { ticker: 'MSTR',  name: 'MicroStrategy'  },
]

const PRE_IPO_ASSETS = [
  { ticker: 'ANTHROPIC',  name: 'Anthropic'       },
  { ticker: 'OPENAI',     name: 'OpenAI'          },
  { ticker: 'SPACEX',     name: 'SpaceX'          },
  { ticker: 'ANDURIL',    name: 'Anduril'         },
  { ticker: 'NEURALINK',  name: 'Neuralink'       },
  { ticker: 'FIGUREAI',   name: 'Figure AI'       },
  { ticker: 'XAI',        name: 'xAI'             },
  { ticker: 'POLYMARKET', name: 'Polymarket'      },
  { ticker: 'KALSHI',     name: 'Kalshi'          },
]

const ACTION_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  buy_spot:      { label: 'Buy Spot',       color: '#2563EB', bg: '#EFF6FF' },
  vault_deposit: { label: 'Vault Deposit',  color: '#0EA5E9', bg: '#F0F9FF' },
  kamino_supply: { label: 'Kamino Supply',  color: '#2563EB', bg: '#EFF6FF' },
  shift_long:    { label: '2x Long',        color: '#16A34A', bg: '#F0FDF4' },
  shift_short:   { label: '1x Short',       color: '#DC2626', bg: '#FEF2F2' },
  hold_usdc:     { label: 'Hold USDC',      color: '#64748B', bg: '#F8FAFC' },
}

const TAG_STYLE: Record<string, { border: string; bg: string; color: string }> = {
  best_entry:  { border: '#2563EB', bg: '#EFF6FF', color: '#2563EB' },
  max_yield:   { border: '#16A34A', bg: '#F0FDF4', color: '#16A34A' },
  leveraged:   { border: '#F59E0B', bg: '#FFFBEB', color: '#B45309' },
  defensive:   { border: '#94A3B8', bg: '#F8FAFC', color: '#475569' },
}

interface RouteStep {
  action: string; protocol: string; asset: string; amountUsd: number
  description: string; apy?: number; leverage?: string; url?: string
}
interface RecommendedRoute {
  id: string; title: string; tag: string; tagLabel: string
  steps: RouteStep[]; projectedApy: number | null; totalAmountUsd: number
  reasoning: string; warnings: string[]; confidence: string
  disabled?: boolean; disabledReason?: string
}
interface RouterResult {
  asset: string; xstockSymbol: string; amountUsd: number
  oraclePrice: number | null; onchainPrice: number | null
  premiumPct: number; momentum24h: number
  bestVaultApy: number; bestKaminoApy: number; xlayerVaultApy?: number
  routes: RecommendedRoute[]; marketSummary: string; generatedAt: string
}

function SignalBadge({ value, suffix, label, goodWhen }: {
  value: number; suffix: string; label: string; goodWhen: 'negative' | 'positive' | 'zero'
}) {
  const isGood = goodWhen === 'negative' ? value < 0
    : goodWhen === 'positive' ? value > 0
    : Math.abs(value) < 0.5
  const isWarn = goodWhen === 'negative' ? value > 1.5
    : goodWhen === 'positive' ? value < -2
    : Math.abs(value) > 1.5
  const color = isGood ? '#16A34A' : isWarn ? '#DC2626' : '#D97706'
  const bg = isGood ? '#F0FDF4' : isWarn ? '#FEF2F2' : '#FFFBEB'

  return (
    <div style={{ textAlign: 'center', background: bg, borderRadius: 10, padding: '10px 16px', minWidth: 100 }}>
      <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: 'monospace' }}>
        {value > 0 ? '+' : ''}{value.toFixed(2)}{suffix}
      </div>
    </div>
  )
}

function StepCard({ step, index }: { step: RouteStep; index: number }) {
  const meta = ACTION_LABELS[step.action] ?? { label: step.action, color: '#64748B', bg: '#F8FAFC' }
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '10px 12px',
      background: '#F8FAFC', borderRadius: 8, marginBottom: 6,
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%', background: '#E2E8F0',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 800, color: '#64748B', flexShrink: 0,
      }}>{index + 1}</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: meta.color,
            background: meta.bg, borderRadius: 4, padding: '2px 7px',
          }}>{meta.label}</span>
          <span style={{ fontSize: 11, color: '#94A3B8' }}>{step.protocol}</span>
          {step.apy && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#16A34A' }}>
              {step.apy.toFixed(2)}% APY
            </span>
          )}
          {step.leverage && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#F59E0B' }}>{step.leverage}</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>{step.description}</div>
        {step.url && (
          <a href={step.url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: '#2563EB', display: 'inline-block', marginTop: 3 }}>
            Open {step.protocol} →
          </a>
        )}
      </div>
    </div>
  )
}

const EXEC_STATUS_LABEL: Record<string, string> = {
  building:            'Building transaction...',
  requesting_usdc:     'Requesting test USDC...',
  signing_swap:        'Sign USDC → xStock swap...',
  confirming_swap:     'Confirming swap...',
  signing_deposit:     'Sign Vault deposit...',
  confirming_deposit:  'Confirming deposit...',
  switching_chain:     'Switching to X Layer...',
  approving:           'Approve xStock spend...',
  confirming_approve:  'Confirming approval...',
  depositing:          'Deposit to X Layer Vault...',
  confirming_deposit2: 'Confirming vault deposit...',
  success:             'Execution complete!',
  error:               'Execution failed',
}

function RouteCard({ route, isTop, isPreIpo, isXLayer, evmConnected, onConnectEvm, onExecute, execStatus, execError, execResult }: {
  route: RecommendedRoute
  isTop: boolean
  isPreIpo?: boolean
  isXLayer?: boolean
  evmConnected?: boolean
  onConnectEvm?: () => void
  onExecute?: () => void
  execStatus?: string
  execError?: string | null
  execResult?: { swapTxHash: string; depositTxHash: string | null; xstockOut: number; xstockSymbol: string; mode?: string } | null
}) {
  const [expanded, setExpanded] = useState(isTop)
  const tagStyle = TAG_STYLE[route.tag] ?? TAG_STYLE.defensive

  const borderColor = isXLayer ? '#8B5CF6' : isTop ? tagStyle.border : '#E2E8F0'
  const bgColor = isXLayer ? '#F5F3FF' : isTop ? tagStyle.bg : '#fff'

  return (
    <div style={{
      border: `1.5px solid ${borderColor}`,
      borderRadius: 12, padding: '14px 16px', marginBottom: 12,
      background: bgColor,
      opacity: route.disabled ? 0.6 : 1,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            {isXLayer && (
              <span style={{
                fontSize: 9, fontWeight: 800, color: '#fff',
                background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                borderRadius: 4, padding: '2px 8px', letterSpacing: '0.05em',
              }}>⬡ X LAYER · OKX L2</span>
            )}
            {isTop && !isXLayer && (
              <span style={{
                fontSize: 9, fontWeight: 800, color: '#fff',
                background: tagStyle.border, borderRadius: 4, padding: '2px 8px', letterSpacing: '0.05em',
              }}>RECOMMENDED</span>
            )}
            <span style={{
              fontSize: 10, fontWeight: 700, color: tagStyle.color,
              background: '#fff', borderRadius: 4, padding: '2px 8px',
              border: `1px solid ${tagStyle.border}`,
            }}>{route.tagLabel}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{route.title}</span>
          </div>

          {route.projectedApy !== null && (
            <div style={{ fontSize: 13, color: '#16A34A', fontWeight: 700 }}>
              Est. APY: {route.projectedApy.toFixed(2)}%
            </div>
          )}
          {route.disabled && route.disabledReason && (
            <div style={{ fontSize: 11, color: '#DC2626', marginTop: 2 }}>{route.disabledReason}</div>
          )}
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
            background: '#F1F5F9', color: '#64748B', border: 'none', cursor: 'pointer', flexShrink: 0,
          }}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          {/* Reasoning */}
          <div style={{
            background: '#fff', borderRadius: 8, padding: '10px 12px', marginBottom: 10,
            fontSize: 12, color: '#334155', lineHeight: 1.6,
            borderLeft: `3px solid ${tagStyle.border}`,
          }}>
            {route.reasoning}
          </div>

          {/* Steps */}
          <div style={{ marginBottom: 8 }}>
            {route.steps.map((step, i) => <StepCard key={i} step={step} index={i} />)}
          </div>

          {/* Warnings */}
          {route.warnings.length > 0 && (
            <div style={{
              background: '#FFFBEB', borderRadius: 8, padding: '8px 12px',
              border: '1px solid #FDE68A',
            }}>
              {route.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 11, color: '#B45309', lineHeight: 1.5 }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}

          {/* Confidence */}
          <div style={{ marginTop: 8, textAlign: 'right' }}>
            <span style={{ fontSize: 10, color: '#94A3B8' }}>
              Signal confidence: {route.confidence === 'high' ? '🟢 High' : route.confidence === 'medium' ? '🟡 Medium' : '🔴 Low'}
            </span>
          </div>

          {/* X Layer wallet status */}
          {isXLayer && (
            <div style={{
              background: evmConnected ? '#EEF2FF' : '#1E1B4B',
              border: `1px solid ${evmConnected ? '#C7D2FE' : '#6366F1'}`,
              borderRadius: 8, padding: '10px 14px', marginBottom: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span style={{ fontSize: 11, color: evmConnected ? '#6366F1' : '#A5B4FC', fontWeight: 600 }}>
                {evmConnected ? '⬡ EVM wallet connected — ready to execute on X Layer' : '⬡ Connect MetaMask or OKX Wallet to execute on X Layer'}
              </span>
              {!evmConnected && onConnectEvm && (
                <button
                  onClick={onConnectEvm}
                  style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                    color: '#fff', border: 'none', cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  Connect EVM Wallet
                </button>
              )}
            </div>
          )}

          {/* Execute button — any recommended (top) route that isn't disabled */}
          {onExecute && (
            <div style={{ marginTop: 14 }}>
              {execStatus === 'success' && execResult ? (
                <div style={{
                  background: '#F0FDF4', border: '1px solid #86EFAC',
                  borderRadius: 10, padding: '12px 14px',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#16A34A', marginBottom: 8 }}>
                    Success! Received {execResult.xstockOut.toFixed(4)} {execResult.xstockSymbol}
                    {execResult.depositTxHash ? ', deposited to Vault' : ' (held in wallet)'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {execResult.swapTxHash && (
                      <a href={execResult.mode === 'xlayer-testnet'
                        ? `https://www.okx.com/explorer/xlayer-test/tx/${execResult.swapTxHash}`
                        : `https://solscan.io/tx/${execResult.swapTxHash}?cluster=devnet`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: '#2563EB' }}>
                        {execResult.mode === 'xlayer-testnet' ? 'Mint' : 'Swap'} tx: {execResult.swapTxHash.slice(0, 12)}... →
                      </a>
                    )}
                    {execResult.depositTxHash && (
                      <a href={execResult.mode === 'xlayer-testnet'
                        ? `https://www.okx.com/explorer/xlayer-test/tx/${execResult.depositTxHash}`
                        : `https://solscan.io/tx/${execResult.depositTxHash}?cluster=devnet`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: '#0EA5E9' }}>
                        Vault deposit tx: {execResult.depositTxHash.slice(0, 12)}... →
                      </a>
                    )}
                  </div>
                </div>
              ) : execStatus && execStatus !== 'idle' && execStatus !== 'error' ? (
                <div style={{
                  background: '#EFF6FF', border: '1px solid #BFDBFE',
                  borderRadius: 10, padding: '12px 14px',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%',
                    border: '2px solid #2563EB', borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite', flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#2563EB' }}>
                    {EXEC_STATUS_LABEL[execStatus] ?? execStatus}
                  </span>
                </div>
              ) : (
                <>
                  <button
                    onClick={onExecute}
                    disabled={!!execStatus && execStatus !== 'idle' && execStatus !== 'error'}
                    style={{
                      width: '100%', padding: '13px', borderRadius: 10,
                      background: route.tagLabel === 'X Layer Vault'
                        ? 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)'
                        : isPreIpo
                        ? 'linear-gradient(135deg, #7C3AED 0%, #9945FF 100%)'
                        : 'linear-gradient(135deg, #2563EB 0%, #0EA5E9 100%)',
                      color: '#fff', border: 'none', fontSize: 14, fontWeight: 800,
                      cursor: 'pointer', letterSpacing: '0.02em',
                    }}
                  >
                    {route.tagLabel === 'X Layer Vault' ? 'Execute on X Layer: Approve + Vault Deposit →' : isPreIpo ? 'Execute: Buy Pre-IPO Token →' : 'Execute: Swap + Vault Deposit →'}
                  </button>
                  {execError && (
                    <div style={{ fontSize: 11, color: '#DC2626', marginTop: 6, textAlign: 'center' }}>
                      {execError}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function IntentPanel({ initialAsset = 'TSLA' }: { initialAsset?: string }) {
  const { connected, publicKey, connect: connectPhantom } = usePhantom()
  const { address: evmAddress, isConnected: evmConnected } = useAccount()
  const { connect: connectEvm, connectors } = useConnect()
  const [asset, setAsset] = useState(initialAsset)
  const [amountUsd, setAmountUsd] = useState('1000')
  const [risk, setRisk] = useState<'low' | 'medium' | 'high'>('medium')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RouterResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { status: execStatus, error: execError, result: execResult, execute, reset: resetExec } = useIntentExecute()
  const { status: xlExecStatus, error: xlExecError, result: xlExecResult, execute: xlExecute, reset: xlResetExec } = useXLayerExecute()
  const [execRouteId, setExecRouteId] = useState<string | null>(null)
  const [execChain, setExecChain] = useState<'solana' | 'xlayer'>('solana')
  const [faucetStatus, setFaucetStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [faucetTx, setFaucetTx] = useState<string | null>(null)

  async function claimTestTokens() {
    if (!publicKey) { connectPhantom(); return }
    setFaucetStatus('loading')
    try {
      const resp = await fetch(`${API_BASE}/devnet/faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error)
      const firstTx = json.data.tokens?.find((t: any) => t.txHash)?.txHash ?? null
      setFaucetTx(firstTx)
      setFaucetStatus('done')
    } catch (e: any) {
      setFaucetStatus('error')
    }
  }

  async function handleRoute() {
    setLoading(true)
    setError(null)
    setResult(null)
    resetExec()
    try {
      const resp = await fetch(`${API_BASE}/intent/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, amountUsd: parseFloat(amountUsd), riskTolerance: risk }),
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error)
      setResult(json.data)
    } catch (e: any) {
      setError(e?.message ?? 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px 48px' }}>
      {/* Input Card */}
      <div style={{
        background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16,
        padding: '20px 20px 16px', marginBottom: 20,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', marginBottom: 14, letterSpacing: '0.05em' }}>
          DEFINE YOUR INTENT
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          {/* Asset */}
          <div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Asset</div>
            <select
              value={asset}
              onChange={e => setAsset(e.target.value)}
              style={{
                width: '100%', padding: '9px 10px', borderRadius: 8,
                border: '1px solid #E2E8F0', fontSize: 13, fontWeight: 700,
                background: '#F8FAFC', outline: 'none',
              }}
            >
              <optgroup label="Tokenized Stocks &amp; ETFs">
                {XSTOCK_ASSETS.map(a => (
                  <option key={a.ticker} value={a.ticker}>
                    {a.ticker} — {a.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Pre-IPO Tokens (PreStocks)">
                {PRE_IPO_ASSETS.map(a => (
                  <option key={a.ticker} value={a.ticker}>
                    {a.ticker} — {a.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Amount */}
          <div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Amount (USD)</div>
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                fontSize: 13, color: '#94A3B8', fontWeight: 700,
              }}>$</span>
              <input
                type="number"
                value={amountUsd}
                onChange={e => setAmountUsd(e.target.value)}
                min="10"
                step="100"
                style={{
                  width: '100%', padding: '9px 10px 9px 22px', borderRadius: 8,
                  border: '1px solid #E2E8F0', fontSize: 13, fontWeight: 700,
                  background: '#F8FAFC', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Risk */}
          <div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Risk Tolerance</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['low', 'medium', 'high'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setRisk(r)}
                  style={{
                    flex: 1, padding: '9px 4px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                    border: '1px solid',
                    borderColor: risk === r
                      ? (r === 'low' ? '#16A34A' : r === 'medium' ? '#D97706' : '#DC2626')
                      : '#E2E8F0',
                    background: risk === r
                      ? (r === 'low' ? '#F0FDF4' : r === 'medium' ? '#FFFBEB' : '#FEF2F2')
                      : '#F8FAFC',
                    color: risk === r
                      ? (r === 'low' ? '#16A34A' : r === 'medium' ? '#D97706' : '#DC2626')
                      : '#94A3B8',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {r === 'low' ? 'Low' : r === 'medium' ? 'Med' : 'High'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={handleRoute}
          disabled={loading || !amountUsd || parseFloat(amountUsd) <= 0}
          style={{
            width: '100%', padding: '13px', borderRadius: 10, fontSize: 15, fontWeight: 800,
            background: loading ? '#E2E8F0' : 'linear-gradient(135deg, #2563EB 0%, #0EA5E9 100%)',
            color: loading ? '#94A3B8' : '#fff', border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            letterSpacing: '0.02em',
          }}
        >
          {loading ? 'Analyzing signals...' : 'Generate Optimal Route →'}
        </button>

        {error && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#DC2626', textAlign: 'center' }}>{error}</div>
        )}

        {/* Devnet faucet */}
        <div style={{
          marginTop: 12, padding: '10px 14px', borderRadius: 8,
          background: '#FFFBEB', border: '1px solid #FDE68A',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div style={{ fontSize: 11, color: '#92400E' }}>
            <span style={{ fontWeight: 700 }}>Devnet Test Mode</span>
            {' '}— test tokens required to execute
          </div>
          {faucetStatus === 'done' ? (
            <div style={{ fontSize: 11, color: '#16A34A', fontWeight: 700, flexShrink: 0 }}>
              ✓ Test tokens claimed (TSLAx/NVDAx/SPYx/AAPLx/METAx)
              {faucetTx && (
                <a href={`https://solscan.io/tx/${faucetTx}?cluster=devnet`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ marginLeft: 6, color: '#2563EB' }}>tx →</a>
              )}
            </div>
          ) : (
            <button
              onClick={claimTestTokens}
              disabled={faucetStatus === 'loading'}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                background: faucetStatus === 'loading' ? '#E2E8F0' : '#F59E0B',
                color: faucetStatus === 'loading' ? '#94A3B8' : '#fff',
                border: 'none', cursor: faucetStatus === 'loading' ? 'not-allowed' : 'pointer',
                flexShrink: 0,
              }}
            >
              {faucetStatus === 'loading' ? 'Sending...' : 'Claim All Test Tokens'}
            </button>
          )}
        </div>
      </div>

      {result && (
        <>
          {/* Market Signal Bar */}
          <div style={{
            background: '#0F172A', borderRadius: 14, padding: '14px 20px',
            marginBottom: 16, color: '#fff',
          }}>
            <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 8 }}>
              Live Market Signals · {new Date(result.generatedAt).toLocaleTimeString()}
            </div>
            <div style={{ fontSize: 13, color: '#E2E8F0', marginBottom: 12, lineHeight: 1.5 }}>
              {result.marketSummary}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <SignalBadge
                value={result.premiumPct}
                suffix="%"
                label="On-chain Premium"
                goodWhen="negative"
              />
              <SignalBadge
                value={result.momentum24h}
                suffix="%"
                label="24h Momentum"
                goodWhen="positive"
              />
              <div style={{ textAlign: 'center', background: '#1E293B', borderRadius: 10, padding: '10px 16px', minWidth: 100 }}>
                <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 2 }}>Solana APY</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#14F195', fontFamily: 'monospace' }}>
                  {Math.max(result.bestVaultApy, result.bestKaminoApy).toFixed(2)}%
                </div>
              </div>
              {(result.xlayerVaultApy ?? 0) > 0 && (
                <div style={{ textAlign: 'center', background: '#1E293B', borderRadius: 10, padding: '10px 16px', minWidth: 100 }}>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 2 }}>X Layer APY</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#8B5CF6', fontFamily: 'monospace' }}>
                    {result.xlayerVaultApy!.toFixed(2)}%
                  </div>
                </div>
              )}
              {result.oraclePrice && (
                <div style={{ textAlign: 'center', background: '#1E293B', borderRadius: 10, padding: '10px 16px', minWidth: 100 }}>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 2 }}>Stock Price</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>
                    ${result.oraclePrice.toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Cross-chain comparison banner — shown when X Layer has a route */}
          {(result.xlayerVaultApy ?? 0) > 0 && (
            <div style={{
              background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
              borderRadius: 12, padding: '14px 18px', marginBottom: 14,
              color: '#fff',
            }}>
              <div style={{ fontSize: 11, color: '#A5B4FC', fontWeight: 700, marginBottom: 8, letterSpacing: '0.05em' }}>
                ⬡ CROSS-CHAIN YIELD COMPARISON
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ background: '#ffffff18', borderRadius: 8, padding: '8px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#A5B4FC', marginBottom: 2 }}>◎ Solana Best</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#14F195', fontFamily: 'monospace' }}>
                    {Math.max(result.bestVaultApy, result.bestKaminoApy).toFixed(2)}%
                  </div>
                  <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 1 }}>
                    {result.bestVaultApy >= result.bestKaminoApy ? 'OnStock Vault' : 'Kamino'}
                  </div>
                </div>
                <div style={{ fontSize: 20, color: '#6366F1', fontWeight: 800 }}>vs</div>
                <div style={{ background: '#ffffff18', borderRadius: 8, padding: '8px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#A5B4FC', marginBottom: 2 }}>⬡ X Layer Best</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#8B5CF6', fontFamily: 'monospace' }}>
                    {result.xlayerVaultApy!.toFixed(2)}%
                  </div>
                  <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 1 }}>OnStock Vault · ERC4626</div>
                </div>
                <div style={{ flex: 1, minWidth: 160, fontSize: 12, color: '#C7D2FE', lineHeight: 1.5 }}>
                  {result.xlayerVaultApy! > Math.max(result.bestVaultApy, result.bestKaminoApy)
                    ? `X Layer offers higher yield (+${(result.xlayerVaultApy! - Math.max(result.bestVaultApy, result.bestKaminoApy)).toFixed(2)}%) → router recommends cross-chain execution`
                    : `Solana offers comparable yield → both routes available below`
                  }
                </div>
              </div>
            </div>
          )}

          {/* Route Cards */}
          <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B', marginBottom: 10 }}>
            {result.routes.length} routes · Solana{(result.xlayerVaultApy ?? 0) > 0 ? ' + X Layer' : ''} · dynamically generated
          </div>
          {result.routes.map((route, i) => {
            const isTop = i === 0 && !route.disabled
            const isPreIpo = result.bestVaultApy === 0 && result.bestKaminoApy === 0
            const isXLayer = route.tagLabel === 'X Layer Vault'
            const canExecute = !route.disabled && route.steps.some(s => s.action === 'vault_deposit' || s.action === 'buy_spot')
            const isActiveExec = execRouteId === route.id

            const activeStatus = isActiveExec
              ? (execChain === 'xlayer' ? xlExecStatus : execStatus)
              : undefined
            const activeError = isActiveExec
              ? (execChain === 'xlayer' ? xlExecError : execError)
              : undefined
            const activeResult = isActiveExec
              ? (execChain === 'xlayer' && xlExecResult
                ? { swapTxHash: xlExecResult.mintTxHash ?? '', depositTxHash: xlExecResult.depositTxHash, xstockOut: xlExecResult.xstockOut, xstockSymbol: xlExecResult.xstockSymbol, mode: 'xlayer-testnet' }
                : execResult)
              : undefined

            return (
              <RouteCard
                key={`${route.id}-${i}`}
                route={route}
                isTop={isTop}
                isPreIpo={isPreIpo}
                isXLayer={isXLayer}
                evmConnected={evmConnected}
                onConnectEvm={isXLayer ? () => {
                  // Prefer OKX Wallet (window.okxwallet) → MetaMask → any injected
                  // Never use Phantom EVM (it hijacks window.ethereum on Solana pages)
                  if (typeof window !== 'undefined' && (window as any).okxwallet) {
                    const okx = connectors.find(c => c.id === 'okxwallet' || c.name?.toLowerCase().includes('okx'))
                    if (okx) { connectEvm({ connector: okx }); return }
                  }
                  const injected = connectors.find(c => c.id === 'injected' || c.id === 'metaMask')
                  if (injected) { connectEvm({ connector: injected }); return }
                  if (connectors[0]) connectEvm({ connector: connectors[0] })
                } : undefined}
                onExecute={canExecute
                  ? () => {
                      if (isXLayer) {
                        if (!evmConnected) return  // button is hidden when not connected — handled by onConnectEvm
                        setExecRouteId(route.id)
                        setExecChain('xlayer')
                        xlResetExec()
                        xlExecute(asset, parseFloat(amountUsd))
                      } else {
                        if (!connected) { connectPhantom(); return }
                        setExecRouteId(route.id)
                        setExecChain('solana')
                        resetExec()
                        execute(asset, parseFloat(amountUsd))
                      }
                    }
                  : undefined}
                execStatus={activeStatus}
                execError={activeError}
                execResult={activeResult}
              />
            )
          })}
        </>
      )}
    </div>
  )
}
