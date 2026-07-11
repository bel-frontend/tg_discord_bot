// Shared test double for the whole `../browserSessions` / `./browserSessions` barrel.
//
// Bun's `mock.module` binds to a resolved file path once and, in practice, the first
// registration for a given path "wins" for every later real import of it — so two test
// files independently mocking `./browserSessions` with two different local factories don't
// each get their own view. Every test file that needs to fake this subsystem (xPlatform.test.ts,
// threadsPlatform.test.ts) mocks it with *this* shared module instead, and controls behavior by
// importing and mutating `browserSessionsTestState` directly rather than re-registering the mock.
import { mock } from 'bun:test';

export class TestReconnectRequiredError extends Error {}

export const browserSessionsTestState: {
    nextAcquire: () => Promise<{ page: any; release: () => Promise<void> }>;
    sessionStatus: { status: string } | null;
} = {
    nextAcquire: async () => {
        throw new TestReconnectRequiredError('no test session configured');
    },
    sessionStatus: null,
};

export const registerBrowserPlatform = mock(() => {});
export const acquireAutomationContext = mock(async () =>
    browserSessionsTestState.nextAcquire(),
);
export const markPublished = mock(async () => {});
export const markReconnectRequired = mock(async () => {});
export const getBrowserSessionStatus = mock(
    async () => browserSessionsTestState.sessionStatus,
);
export const ReconnectRequiredError = TestReconnectRequiredError;

export const attachLiveView = mock(async () => {});
export const closeSession = mock(async () => {});
export const detachLiveView = mock(() => {});
export const disconnectPlatform = mock(async () => {});
export const getSession = mock(() => undefined);
export const handleClientFrame = mock(() => {});
export const startConnectSession = mock(async () => {
    throw new Error('startConnectSession is not exercised by this test double');
});

export class TestInvalidSessionStateError extends Error {}
export const InvalidSessionStateError = TestInvalidSessionStateError;
export const importBrowserSessionState = mock(async () => {});
