import type { CDPSession } from 'playwright-core';
import type { ClientFrame } from './protocol';

const MOUSE_EVENT_TYPE: Record<string, string> = {
    mouseMove: 'mouseMoved',
    mouseDown: 'mousePressed',
    mouseUp: 'mouseReleased',
};

/** Forwards a canvas mouse/keyboard event into the live page via CDP — no windowing system involved. */
export async function dispatchClientFrame(
    cdp: CDPSession,
    frame: ClientFrame,
): Promise<void> {
    switch (frame.type) {
        case 'mouseMove':
        case 'mouseDown':
        case 'mouseUp':
            await cdp.send('Input.dispatchMouseEvent', {
                type: MOUSE_EVENT_TYPE[frame.type],
                x: frame.x,
                y: frame.y,
                button: frame.button ?? 'left',
                clickCount: frame.type === 'mouseMove' ? 0 : 1,
            } as any);
            return;
        case 'wheel':
            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mouseWheel',
                x: frame.x,
                y: frame.y,
                deltaX: frame.deltaX,
                deltaY: frame.deltaY,
            } as any);
            return;
        case 'keyDown':
            await cdp.send('Input.dispatchKeyEvent', {
                type: 'keyDown',
                key: frame.key,
                code: frame.code,
                text: frame.text,
            } as any);
            return;
        case 'keyUp':
            await cdp.send('Input.dispatchKeyEvent', {
                type: 'keyUp',
                key: frame.key,
                code: frame.code,
            } as any);
            return;
        case 'resize':
            // Viewport resizing is handled by the caller (page.setViewportSize), not CDP input.
            return;
    }
}
