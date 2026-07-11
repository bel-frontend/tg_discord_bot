#!/bin/sh
# Container entrypoint: bring up the Xvfb virtual display that the browser-session
# platforms (src/browserSessions/) render into, verify it actually accepts
# connections, then hand the process over to the app. A missing display has to be
# loud here — otherwise the only symptom is a cryptic Playwright error deep inside
# the Connect flow in the UI.

XVFB_LOG=/tmp/xvfb.log
DISPLAY="${DISPLAY:-:99}"
export DISPLAY
X_SOCKET="/tmp/.X11-unix/X${DISPLAY#:}"

Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp >"$XVFB_LOG" 2>&1 &
XVFB_PID=$!

# Xvfb creates its socket within milliseconds; give it up to 5s before declaring
# it dead so a slow cold start doesn't produce a false warning.
i=0
while [ "$i" -lt 50 ]; do
    [ -e "$X_SOCKET" ] && break
    kill -0 "$XVFB_PID" 2>/dev/null || break
    i=$((i + 1))
    sleep 0.1
done

if [ -e "$X_SOCKET" ]; then
    echo "Xvfb ready on DISPLAY=$DISPLAY"
else
    echo "WARNING: Xvfb did not start — hosted browser connect/publish will fail." >&2
    echo "WARNING: set BROWSER_HEADLESS=true to at least keep publishing working." >&2
    [ -f "$XVFB_LOG" ] && sed 's/^/xvfb: /' "$XVFB_LOG" >&2
fi

exec bun run index.ts
