export { assertBrowserSessionCryptoConfigured } from './crypto';
export {
    acquireAutomationContext,
    attachLiveView,
    closeSession,
    detachLiveView,
    disconnectPlatform,
    getSession,
    handleClientFrame,
    registerBrowserPlatform,
    startBrowserSessionSweep,
    startConnectSession,
    stopBrowserSessionSweep,
    type LiveViewSink,
} from './manager';
export {
    getBrowserSessionStatus,
    markPublished,
    markReconnectRequired,
} from './store';
export type {
    BrowserSessionHandle,
    BrowserSessionPhase,
    LoginDetector,
} from './types';
export { ReconnectRequiredError } from './types';
export type { ClientFrame, ServerFrame } from './protocol';
