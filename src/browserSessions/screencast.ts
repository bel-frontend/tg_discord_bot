import type { CDPSession } from 'playwright-core';
import type { ServerFrame } from './protocol';

export interface ScreencastHandle {
    stop(): Promise<void>;
}

interface ScreencastFrameEvent {
    data: string;
    sessionId: number;
}

/** Streams the live page as JPEG frames over CDP — no VNC/Xvfb-facing display server needed. */
export async function startScreencast(
    cdp: CDPSession,
    onFrame: (frame: ServerFrame) => void,
): Promise<ScreencastHandle> {
    const handleFrame = (event: ScreencastFrameEvent) => {
        onFrame({ type: 'frame', data: event.data, ts: Date.now() });
        // Chromium stops sending frames until each one is acked.
        cdp
            .send('Page.screencastFrameAck', { sessionId: event.sessionId })
            .catch(() => {});
    };

    cdp.on('Page.screencastFrame', handleFrame as any);
    await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 1,
    } as any);

    return {
        async stop() {
            cdp.off('Page.screencastFrame', handleFrame as any);
            try {
                await cdp.send('Page.stopScreencast');
            } catch {
                // session may already be detached/closed
            }
        },
    };
}
