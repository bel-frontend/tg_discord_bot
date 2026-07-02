import { createServer } from 'node:net';

function getFreePort(start: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', (error: any) => {
            if (error?.code === 'EADDRINUSE') {
                resolve(getFreePort(start + 1));
                return;
            }
            reject(error);
        });
        server.once('listening', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : start;
            server.close(() => resolve(port));
        });
        // No explicit host: bind all interfaces, same as Bun.serve()'s default.
        // Checking only '127.0.0.1' let an IPv6-wildcard listener on the same
        // port slip through as a false "free" positive.
        server.listen(start);
    });
}

function spawn(
    label: string,
    cmd: string[],
    options: { cwd?: string; env?: Record<string, string>; onLine?: (line: string) => void } = {},
) {
    const child = Bun.spawn(cmd, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdout: 'pipe',
        stderr: 'pipe',
    });

    const pipe = async (stream: ReadableStream<Uint8Array>, isError = false) => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            if (options.onLine) text.split('\n').filter(Boolean).forEach(options.onLine);
            const out = text
                .split('\n')
                .filter(Boolean)
                .map((line) => `[${label}] ${line}`)
                .join('\n');
            if (out) (isError ? console.error : console.log)(out);
        }
    };

    pipe(child.stdout);
    pipe(child.stderr, true);
    return child;
}

const requestedPort = await getFreePort(Number(process.env.PORT) || 3001);

console.log(`Dev backend:  requesting http://localhost:${requestedPort}`);
console.log('Dev frontend: Vite will print its URL below');

// The backend does its own fallback port scan if the requested port turns out
// to be taken by the time it binds (see src/server.ts startServer). Rather
// than trust our own pre-check, wait for the backend to report the port it
// actually bound to, so the frontend proxy always targets the real one.
const actualPort = Promise.withResolvers<number>();

const backend = spawn('api', ['bun', '--watch', 'index.ts'], {
    env: { PORT: String(requestedPort) },
    onLine: (line) => {
        const match = line.match(/HTTP server listening on http:\/\/localhost:(\d+)/);
        if (match) actualPort.resolve(Number(match[1]));
    },
});

const backendPort = await actualPort.promise;
const backendUrl = `http://localhost:${backendPort}`;
console.log(`Dev backend:  ${backendUrl}`);

const frontend = spawn(
    'web',
    [
        'bun',
        'run',
        'dev',
        '--',
        '--host',
        '127.0.0.1',
        '--configLoader',
        'runner',
    ],
    {
        cwd: 'frontend',
        env: { API_PROXY_TARGET: backendUrl },
    },
);

function shutdown() {
    backend.kill();
    frontend.kill();
}

process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
});
process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
});

await Promise.race([backend.exited, frontend.exited]);
shutdown();
