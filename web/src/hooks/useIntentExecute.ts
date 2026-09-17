'use client'

import { useState, useCallback } from 'react'
import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js'
import { usePhantom } from '@/components/PhantomProvider'
import { useSolanaNetwork } from '@/components/SolanaWalletProvider'

export type ExecStatus =
  | 'idle'
  | 'building'
  | 'requesting_usdc'
  | 'signing_swap'
  | 'confirming_swap'
  | 'signing_deposit'
  | 'confirming_deposit'
  | 'success'
  | 'error'

export interface ExecResult {
  swapTxHash: string
  depositTxHash: string | null  // null for pre-IPO on mainnet (swap-only, no vault)
  xstockOut: number
  xstockSymbol: string
  usdcIn: number
  priceImpactPct: number
  vaultPda: string | null
  receiptMint: string | null
  mode: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

async function pollConfirm(connection: Connection, sig: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1500))
    const status = await connection.getSignatureStatus(sig)
    const conf = status?.value?.confirmationStatus
    if (conf === 'confirmed' || conf === 'finalized') return
    if (status?.value?.err) throw new Error(`Tx failed: ${JSON.stringify(status.value.err)}`)
  }
  throw new Error('Confirmation timeout after 60s')
}

// Devnet RPCs for aggressive retry submission
async function sendAndConfirmDevnet(txBytes: Uint8Array): Promise<string> {
  const resp = await fetch(`${API_BASE}/tx/send-confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: Buffer.from(txBytes).toString('base64') }),
  })
  const json = await resp.json()
  if (!json.ok) throw new Error(json.error ?? 'send-confirm failed')
  return json.signature as string
}

export function useIntentExecute() {
  const { publicKey, signTransaction } = usePhantom()
  const { rpc } = useSolanaNetwork()

  const [status, setStatus] = useState<ExecStatus>('idle')
  const [error, setError]   = useState<string | null>(null)
  const [result, setResult] = useState<ExecResult | null>(null)

  const reset = useCallback(() => {
    setStatus('idle'); setError(null); setResult(null)
  }, [])

  const execute = useCallback(async (asset: string, amountUsd: number) => {
    if (!publicKey) { setError('Connect Phantom wallet first'); return }

    setStatus('building')
    setError(null)
    setResult(null)

    const connection = new Connection(rpc, 'confirmed')

    try {
      // Build transactions from server
      // (devnet: server mints xStock directly — no USDC needed, no faucet needed)
      setStatus('building')
      const resp = await fetch(`${API_BASE}/intent/execute-entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, amountUsd, walletAddress: publicKey.toBase58() }),
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error ?? 'Server error')

      const {
        mode, swapTransaction, swapLastValidBlockHeight = 0,
        depositTransaction, xstockSymbol, xstockOut,
        usdcIn, priceImpactPct, vaultPda, receiptMint,
        serverMintSig,
      } = json.data

      let swapSig = serverMintSig ?? ''

      // ── Tx 1: Swap ───────────────────────────────────────────────────────
      if (swapTransaction) {
        setStatus('signing_swap')

        if (mode === 'devnet-swap') {
          // devnet xStock: server already minted — swapTransaction should be null normally
          setStatus('confirming_swap')
          swapSig = swapTransaction
        } else if (mode === 'devnet-preipo') {
          // devnet pre-IPO: server minted token, user signs a small SOL confirmation tx
          // blockhash is already embedded by server — no extra RPC call needed
          const confirmTx = Transaction.from(Buffer.from(swapTransaction, 'base64'))
          confirmTx.feePayer = publicKey
          const signedConfirm = await signTransaction(confirmTx)
          setStatus('confirming_swap')
          swapSig = await sendAndConfirmDevnet(signedConfirm.serialize())
        } else {
          // Mainnet: Jupiter VersionedTransaction
          const swapTx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'))
          const signedSwap = await signTransaction(swapTx as any)
          const { blockhash } = await connection.getLatestBlockhash('confirmed')
          ;(signedSwap as any).message.recentBlockhash = blockhash

          setStatus('confirming_swap')
          swapSig = await connection.sendRawTransaction((signedSwap as any).serialize(), {
            skipPreflight: true, maxRetries: 5,
          })
          await pollConfirm(connection, swapSig)
        }
      }

      // ── Tx 2: Vault deposit (skipped for pre-IPO on mainnet) ────────────
      let depositSig: string | null = null

      if (depositTransaction) {
        setStatus('signing_deposit')
        const depositTx = Transaction.from(Buffer.from(depositTransaction, 'base64'))

        // Refresh blockhash before signing to avoid expiry
        const bhResp = await fetch(`${API_BASE}/tx/blockhash`)
        const bhJson = await bhResp.json()
        if (!bhJson.ok) throw new Error('Failed to get blockhash')
        depositTx.recentBlockhash = bhJson.blockhash
        depositTx.feePayer = publicKey

        const signedDeposit = await signTransaction(depositTx)

        setStatus('confirming_deposit')
        depositSig = await sendAndConfirmDevnet(signedDeposit.serialize())
      }

      setStatus('success')
      setResult({
        swapTxHash: swapSig,
        depositTxHash: depositSig,
        xstockOut, xstockSymbol, usdcIn, priceImpactPct, vaultPda, receiptMint,
        mode,
      })
    } catch (err: any) {
      console.error('[IntentExecute]', err)
      if (err?.message?.includes('User rejected') || err?.message?.includes('rejected')) {
        setStatus('idle')
      } else {
        setError(err?.message ?? 'Execution failed')
        setStatus('error')
      }
    }
  }, [publicKey, signTransaction, rpc])

  return { status, error, result, execute, reset }
}
