import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxyTarget =
    process.env.API_PROXY_TARGET ||
    process.env.BACKEND_URL ||
    'http://localhost:3001';

// Build output goes to ../public so the Bun server can serve it as static files.
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: '../public',
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        // Allow importing ../shared (repo root) from within frontend/.
        fs: { allow: ['..'] },
        // In dev, proxy API calls to the Bun server so JWT works same-origin.
        // scripts/dev.ts sets API_PROXY_TARGET to the actual backend port.
        proxy: {
            '/api': apiProxyTarget,
        },
    },
});
