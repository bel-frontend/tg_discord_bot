import { useEffect, useRef, useState } from 'react';
import { browserSessionLiveViewUrl, startBrowserSession } from '../api';

// Fixed to match the viewport size the backend launches Chromium with (src/browserSessions/manager.ts).
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

type ServerFrame =
    | { type: 'frame'; data: string; ts: number }
    | { type: 'connected' }
    | { type: 'error'; message: string }
    | { type: 'timeout' };

interface BrowserSessionModalProps {
    platform: string;
    platformName: string;
    onConnected: () => void;
    onClose: () => void;
}

function base64ToBlob(base64: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
}

/**
 * Renders a live, remotely-controllable browser session onto a <canvas> — deliberately not
 * an <iframe> of the target site. Frames arrive as CDP screencast JPEGs over a WebSocket;
 * mouse/keyboard events on the canvas are forwarded back over the same socket and replayed
 * into the real page via CDP input dispatch on the server. See src/browserSessions/ for the
 * server side of this protocol.
 */
export function BrowserSessionModal({
    platform,
    platformName,
    onConnected,
    onClose,
}: BrowserSessionModalProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [status, setStatus] = useState<'connecting' | 'live' | 'error'>(
        'connecting',
    );
    const [errorMessage, setErrorMessage] = useState('');
    const [attempt, setAttempt] = useState(0);

    function send(frame: unknown) {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(frame));
        }
    }

    function toRealCoords(event: { clientX: number; clientY: number }) {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / rect.width) * VIEWPORT_WIDTH,
            y: ((event.clientY - rect.top) / rect.height) * VIEWPORT_HEIGHT,
        };
    }

    useEffect(() => {
        let cancelled = false;
        let ws: WebSocket | null = null;
        setStatus('connecting');
        setErrorMessage('');

        (async () => {
            try {
                const { wsUrl } = await startBrowserSession(platform);
                if (cancelled) return;
                ws = new WebSocket(browserSessionLiveViewUrl(wsUrl));
                wsRef.current = ws;

                ws.onmessage = async (event) => {
                    const frame = JSON.parse(event.data) as ServerFrame;
                    if (frame.type === 'frame') {
                        setStatus('live');
                        const canvas = canvasRef.current;
                        const ctx = canvas?.getContext('2d');
                        if (!canvas || !ctx) return;
                        const bitmap = await createImageBitmap(
                            base64ToBlob(frame.data),
                        );
                        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                        bitmap.close();
                    } else if (frame.type === 'connected') {
                        onConnected();
                    } else if (frame.type === 'error') {
                        setStatus('error');
                        setErrorMessage(frame.message);
                    } else if (frame.type === 'timeout') {
                        setStatus('error');
                        setErrorMessage('Login timed out — try again.');
                    }
                };
                ws.onerror = () => {
                    if (!cancelled) {
                        setStatus('error');
                        setErrorMessage('Live view connection failed');
                    }
                };
            } catch (err: any) {
                if (!cancelled) {
                    setStatus('error');
                    setErrorMessage(err.message || 'Failed to start browser session');
                }
            }
        })();

        return () => {
            cancelled = true;
            ws?.close();
            wsRef.current = null;
        };
    }, [platform, attempt, onConnected]);

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div
                className="browser-session-modal"
                onClick={(event) => event.stopPropagation()}
            >
                <h3>Connect {platformName}</h3>
                <p className="muted">
                    Log in below as you normally would, including any 2FA. This
                    is a real, private browser session — once your feed loads,
                    it closes automatically.
                </p>
                <div className="browser-session-viewport">
                    <canvas
                        ref={canvasRef}
                        width={VIEWPORT_WIDTH}
                        height={VIEWPORT_HEIGHT}
                        tabIndex={0}
                        className="browser-session-canvas"
                        onContextMenu={(event) => event.preventDefault()}
                        onMouseMove={(event) =>
                            send({ type: 'mouseMove', ...toRealCoords(event) })
                        }
                        onMouseDown={(event) =>
                            send({
                                type: 'mouseDown',
                                ...toRealCoords(event),
                                button: event.button === 2 ? 'right' : 'left',
                            })
                        }
                        onMouseUp={(event) =>
                            send({
                                type: 'mouseUp',
                                ...toRealCoords(event),
                                button: event.button === 2 ? 'right' : 'left',
                            })
                        }
                        onWheel={(event) =>
                            send({
                                type: 'wheel',
                                ...toRealCoords(event),
                                deltaX: event.deltaX,
                                deltaY: event.deltaY,
                            })
                        }
                        onKeyDown={(event) => {
                            event.preventDefault();
                            send({
                                type: 'keyDown',
                                key: event.key,
                                code: event.code,
                                text: event.key.length === 1 ? event.key : undefined,
                            });
                        }}
                        onKeyUp={(event) => {
                            event.preventDefault();
                            send({ type: 'keyUp', key: event.key, code: event.code });
                        }}
                    />
                    {status !== 'live' && (
                        <div className="browser-session-overlay">
                            {status === 'connecting' && <p>Opening browser…</p>}
                            {status === 'error' && (
                                <>
                                    <p>{errorMessage}</p>
                                    <button
                                        type="button"
                                        className="btn primary"
                                        onClick={() => setAttempt((n) => n + 1)}
                                    >
                                        Retry
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>
                <div className="modal-actions">
                    <button type="button" className="btn ghost" onClick={onClose}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
