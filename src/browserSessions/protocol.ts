// Wire protocol for the live-view WebSocket (src/server.ts's `/api/browser-sessions/:sessionId/live`).
// The frontend never touches the target site's DOM/origin — it only paints these frames onto a
// <canvas> and forwards input back, which is the mechanism that avoids needing an <iframe>.

export type ServerFrame =
    | { type: 'frame'; data: string; ts: number } // data: base64 JPEG
    | { type: 'connected' }
    | { type: 'error'; message: string }
    | { type: 'timeout' };

export type ClientFrame =
    | {
          type: 'mouseMove' | 'mouseDown' | 'mouseUp';
          x: number;
          y: number;
          button?: 'left' | 'right';
      }
    | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
    | { type: 'keyDown' | 'keyUp'; key: string; code: string; text?: string }
    | { type: 'resize'; width: number; height: number };
