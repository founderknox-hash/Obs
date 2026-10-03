/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['luau-web'],
  outputFileTracingIncludes: { '/api/obfuscate': ['./node_modules/luau-web/**/*', './tools/luau-ast/bin/luau-ast'] },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }]
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
