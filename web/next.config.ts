import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    '@solana/wallet-adapter-react',
    '@solana/wallet-adapter-react-ui',
    '@solana/wallet-adapter-phantom',
    '@solana/wallet-adapter-base',
  ],
};

export default nextConfig;
