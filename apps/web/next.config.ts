import type { NextConfig } from 'next';

const api = process.env['GROUNDS_API_BASE_URL'] ?? 'http://127.0.0.1:3000';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/v1/:path*', destination: `${api}/v1/:path*` },
      { source: '/health/:path*', destination: `${api}/health/:path*` },
    ];
  },
};

export default nextConfig;
