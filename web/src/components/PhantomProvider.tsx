'use client'

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react'
import { PublicKey } from '@solana/web3.js'

interface PhantomCtx {
  publicKey: PublicKey | null
  connected: boolean
  connect: () => Promise<PublicKey | null>
  disconnect: () => void
  signTransaction: <T extends { serialize(): Uint8Array }>(tx: T) => Promise<T>
  signAllTransactions: <T extends { serialize(): Uint8Array }>(txs: T[]) => Promise<T[]>
  signAndSendTransaction: (tx: { serialize(): Uint8Array }) => Promise<string>
}

const PhantomContext = createContext<PhantomCtx>({
  publicKey: null,
  connected: false,
  connect: async () => null,
  disconnect: () => {},
  signTransaction: async (tx) => tx,
  signAllTransactions: async (txs) => txs,
  signAndSendTransaction: async () => '',
})

export function usePhantom() {
  return useContext(PhantomContext)
}

function getProvider(): any {
  if (typeof window === 'undefined') return null
  const w = window as any
  // Phantom registers under window.phantom.solana (new) or window.solana (legacy)
  return w.phantom?.solana ?? w.solana ?? null
}

export default function PhantomProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null)
  const [connected, setConnected] = useState(false)

  // Restore connection on mount
  useEffect(() => {
    const provider = getProvider()
    if (!provider) return
    if (provider.isConnected && provider.publicKey) {
      const pk = new PublicKey(provider.publicKey.toString())
      setPublicKey(pk)
      setConnected(true)
    }
    const onConnect = (pk: any) => {
      setPublicKey(new PublicKey(pk.toString()))
      setConnected(true)
    }
    const onDisconnect = () => {
      setPublicKey(null)
      setConnected(false)
    }
    provider.on?.('connect', onConnect)
    provider.on?.('disconnect', onDisconnect)
    return () => {
      provider.off?.('connect', onConnect)
      provider.off?.('disconnect', onDisconnect)
    }
  }, [])

  const connect = useCallback(async (): Promise<PublicKey | null> => {
    const provider = getProvider()
    if (!provider) {
      window.open('https://phantom.app/', '_blank')
      return null
    }
    // Retry once — Phantom service worker may need a moment to wake up
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await provider.connect()
        const pk = new PublicKey(resp.publicKey.toString())
        setPublicKey(pk)
        setConnected(true)
        return pk
      } catch (e: any) {
        const msg = String(e?.message ?? e)
        if (msg.includes('disconnected port') || msg.includes('service worker')) {
          // Phantom service worker waking up — wait and retry
          await new Promise(r => setTimeout(r, 800))
          continue
        }
        // User rejected or other error
        console.error('[Phantom connect]', e)
        return null
      }
    }
    return null
  }, [])

  const disconnect = useCallback(async () => {
    const provider = getProvider()
    await provider?.disconnect?.()
    setPublicKey(null)
    setConnected(false)
  }, [])

  const signTransaction = useCallback(async <T extends { serialize(): Uint8Array }>(tx: T): Promise<T> => {
    const provider = getProvider()
    if (!provider) throw new Error('Phantom not found')
    return await provider.signTransaction(tx)
  }, [])

  const signAllTransactions = useCallback(async <T extends { serialize(): Uint8Array }>(txs: T[]): Promise<T[]> => {
    const provider = getProvider()
    if (!provider) throw new Error('Phantom not found')
    return await provider.signAllTransactions(txs)
  }, [])

  const signAndSendTransaction = useCallback(async (tx: { serialize(): Uint8Array }): Promise<string> => {
    const provider = getProvider()
    if (!provider) throw new Error('Phantom not found')
    const result = await provider.signAndSendTransaction(tx)
    return result.signature as string
  }, [])

  return (
    <PhantomContext.Provider value={{ publicKey, connected, connect, disconnect, signTransaction, signAllTransactions, signAndSendTransaction }}>
      {children}
    </PhantomContext.Provider>
  )
}
