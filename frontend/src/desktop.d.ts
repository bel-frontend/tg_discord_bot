export {};

declare global {
    interface Window {
        composerDesktop?: {
            agentStatus(): Promise<{ paired: boolean; agentId?: string }>;
            pairAgent(code: string): Promise<{
                paired: boolean;
                agentId?: string;
            }>;
            threadsStatus(): Promise<{ connected: boolean }>;
            connectThreads(): Promise<{ connected: boolean }>;
            disconnectThreads(): Promise<{ connected: boolean }>;
            xStatus(): Promise<{ connected: boolean }>;
            connectX(): Promise<{ connected: boolean }>;
            disconnectX(): Promise<{ connected: boolean }>;
        };
    }
}
