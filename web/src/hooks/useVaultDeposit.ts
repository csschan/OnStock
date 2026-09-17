'use client'

import { useState, useCallback } from 'react'
import { Transaction } from '@solana/web3.js'
import { usePhantom } from '@/components/PhantomProvider'

export type TxStatus = 'idle' | 'building' | 'signing' | 'confirming' | 'success' | 'error'

export interface VaultPosition {
  userShares: number
  depositedAmount: number
  currentValue: number
  nav: number
  pnl: number
}

export interface UseVaultDepositResult {
  status: TxStatus
  txHash: string | null
  error: string | null
  position: VaultPosition | null
  positionLoading: boolean
  deposit: (asset: string, amountUi: number) => Promise<void>
  withdraw: (asset: string, sharesUi: number) => Promise<void>
  reset: () => void
  refreshPosition: (asset: string) => Promise<void>
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

export function useVaultDeposit(): UseVaultDepositResult {
  const { publicKey, signTransaction } = usePhantom()

  const [status, setStatus]   = useState<TxStatus>('idle')
  const [txHash, setTxHash]   = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [position, setPosition] = useState<VaultPosition | null>(null)
  const [positionLoading, setPositionLoading] = useState(false)

  const reset = useCallback(() => {
    setStatus('idle'); setTxHash(null); setError(null)
  }, [])

  const refreshPosition = useCallback(async (asset: string) => {
    if (!publicKey) return
    setPositionLoading(true)
    try {
      const resp = await fetch(
        `${API_BASE}/earn/vault/position?asset=${asset}&wallet=${publicKey.toBase58()}`
      )
      const json = await resp.json()
      if (json.ok) setPosition(json.data)
    } catch { /* ignore */ } finally {
      setPositionLoading(false)
    }
  }, [publicKey])

  const sendTx = useCallback(async (
    endpoint: string,
    body: Record<string, unknown>
  ) => {
    if (!publicKey) { setError('Connect wallet first'); return }

    try {
      setStatus('building')
      setError(null)

      const resp = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, walletAddress: publicKey.toBase58() }),
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error ?? 'Failed to build transaction')

      const { transaction: serialized, blockhash, lastValidBlockHeight } = json.data
      const tx = Transaction.from(Buffer.from(serialized, 'base64'))
      tx.recentBlockhash = blockhash
      tx.feePayer = publicKey

      setStatus('signing')
      const signedTx = await signTransaction(tx)

      setStatus('confirming')
      const sendResp = await fetch(`${API_BASE}/tx/send-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: Buffer.from(signedTx.serialize()).toString('base64') }),
      })
      const sendJson = await sendResp.json()
      if (!sendJson.ok) throw new Error(sendJson.error ?? 'send-confirm failed')
      const sig: string = sendJson.signature
      setTxHash(sig)
      setStatus('success')

      // Refresh position after success
      if (body.asset) {
        setTimeout(() => refreshPosition(body.asset as string), 2000)
      }
    } catch (err: any) {
      console.error('[VaultDeposit]', err)
      if (err?.message?.includes('User rejected') || err?.message?.includes('rejected')) {
        setStatus('idle')
      } else {
        setError(err?.message ?? 'Transaction failed')
        setStatus('error')
      }
    }
  }, [publicKey, signTransaction, refreshPosition])

  const deposit = useCallback((asset: string, amountUi: number) =>
    sendTx('/earn/vault/build-deposit', { asset, amount: amountUi }),
  [sendTx])

  const withdraw = useCallback((asset: string, sharesUi: number) =>
    sendTx('/earn/vault/build-withdraw', { asset, shares: sharesUi }),
  [sendTx])

  return { status, txHash, error, position, positionLoading, deposit, withdraw, reset, refreshPosition }
}
