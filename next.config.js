/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/dishes',
        destination: '/food',
        permanent: true,
      },
      {
        source: '/dishes/:path*',
        destination: '/food/:path*',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
