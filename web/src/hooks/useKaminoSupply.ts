'use client'

import { useState, useCallback } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Transaction } from '@solana/web3.js'

export type TxStatus = 'idle' | 'building' | 'signing' | 'confirming' | 'success' | 'error'

export interface UseKaminoSupplyResult {
  status: TxStatus
  txHash: string | null
  error: string | null
  supply: (asset: string, amountUi: number) => Promise<void>
  reset: () => void
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

export function useKaminoSupply(): UseKaminoSupplyResult {
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()

  const [status, setStatus] = useState<TxStatus>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setStatus('idle'); setTxHash(null); setError(null)
  }, [])

  const supply = useCallback(async (asset: string, amountUi: number) => {
    if (!publicKey) { setError('Connect wallet first'); return }

    try {
      setStatus('building')
      setError(null)

      // Ask server to build the Kamino deposit transaction
      const resp = await fetch(`${API_BASE}/earn/kamino/build-supply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, amount: amountUi, walletAddress: publicKey.toBase58() }),
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error ?? 'Failed to build transaction')

      // Deserialize the transaction
      const { transaction: serialized, blockhash, lastValidBlockHeight } = json.data
      const txBytes = Buffer.from(serialized, 'base64')
      const tx = Transaction.from(txBytes)

      setStatus('signing')
      const sig = await sendTransaction(tx, connection, {
        skipPreflight: false,
        maxRetries: 3,
      })
      setTxHash(sig)

      setStatus('confirming')
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed'
      )

      setStatus('success')
    } catch (err: any) {
      console.error('[Kamino supply]', err)
      // User rejected = not an error to show prominently
      if (err?.message?.includes('User rejected')) {
        setStatus('idle')
      } else {
        setError(err?.message ?? 'Transaction failed')
        setStatus('error')
      }
    }
  }, [publicKey, connection, sendTransaction])

  return { status, txHash, error, supply, reset }
}
