import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@repo/database', '@repo/permissions'],
}

export default nextConfig
