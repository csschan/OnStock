import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    '@solana/wallet-adapter-react',
    '@solana/wallet-adapter-react-ui',
    '@solana/wallet-adapter-phantom',
    '@solana/wallet-adapter-base',
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'Cache-Control', value: 'no-store, must-revalidate' },
      ],
    },
  ],
};

export default nextConfig;
