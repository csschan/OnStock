'use client'

import { ConnectButton as RainbowConnectButton } from '@rainbow-me/rainbowkit'

export default function ConnectButton() {
  return (
    <RainbowConnectButton
      label="Connect Wallet"
      accountStatus="address"
      chainStatus="icon"
      showBalance={false}
    />
  )
}
