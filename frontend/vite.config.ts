import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build output goes to ../public so the Bun server can serve it as static files.
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: '../public',
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        // In dev, proxy API calls to the Bun server so cookies/JWT work same-origin.
        proxy: {
            '/api': 'http://localhost:3000',
        },
    },
});
