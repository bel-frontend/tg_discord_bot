import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = dirname(fileURLToPath(import.meta.url));
const apiProxyTarget =
    process.env.API_PROXY_TARGET ||
    process.env.BACKEND_URL ||
    'http://localhost:3001';
const isDev = process.env.NODE_ENV === 'development';

/** @type {import('next').NextConfig} */
const nextConfig = {
    ...(isDev ? {} : { output: 'export' }),
    outputFileTracingRoot: frontendDir,
    images: {
        unoptimized: true,
    },
};

if (isDev) {
    nextConfig.rewrites = async () => {
        const rewrites = [
            {
                source: '/edit/:path*',
                destination: '/',
            },
            {
                source: '/invite/:path*',
                destination: '/',
            },
            {
                source: '/verify-email/:path*',
                destination: '/',
            },
        ];

        if (process.env.API_PROXY_TARGET || process.env.BACKEND_URL) {
            rewrites.push({
                source: '/api/:path*',
                destination: `${apiProxyTarget}/api/:path*`,
            });
        }

        return rewrites;
    };
}

export default nextConfig;
