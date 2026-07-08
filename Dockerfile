# syntax=docker/dockerfile:1.7

# Use the official Bun image
FROM oven/bun:1

WORKDIR /app
ENV BUN_INSTALL_CACHE_DIR=/bun-cache

# Install server dependencies
COPY package.json bun.lockb ./
RUN --mount=type=cache,target=/bun-cache bun install --frozen-lockfile

# Chromium + Xvfb for the browser-session platforms (src/browserSessions/): a real,
# headful-in-a-virtual-display browser drives the user's own login for platforms with
# no usable official publish API (X, Reddit, ...). --with-deps installs the apt packages
# Chromium needs (fonts, libnss3, etc); xvfb is the virtual display it renders into;
# xauth is required by xvfb-run itself (it fails at startup without it).
RUN apt-get update && apt-get install -y --no-install-recommends xvfb xauth \
    && rm -rf /var/lib/apt/lists/*
# The browser download (~180MB) is the slow part. A --mount=type=cache dir is *not*
# persisted into the built image, so install into it first (fast on repeat builds even
# if this layer gets invalidated for an unrelated reason), then copy the result into a
# normal path that does get committed to the image layer.
ENV PLAYWRIGHT_BROWSERS_PATH=/playwright-browsers
ENV DISPLAY=:99
RUN --mount=type=cache,target=/playwright-cache,sharing=locked \
    PLAYWRIGHT_BROWSERS_PATH=/playwright-cache bunx playwright install --with-deps chromium \
    && mkdir -p /playwright-browsers \
    && cp -r /playwright-cache/. /playwright-browsers/

# Install frontend dependencies (cached separately from source)
COPY frontend/package.json frontend/bun.lock ./frontend/
RUN --mount=type=cache,target=/bun-cache cd frontend && bun install --frozen-lockfile

# Copy the rest of the source and build the frontend into ./public
COPY . .
RUN cd frontend && bun run build

# The server serves the built frontend and the API on $PORT (default 3000).
# Xvfb runs in the background only to provide a display for browser-session
# platforms; the HTTP server itself stays the main container process.
CMD ["sh", "-c", "Xvfb :99 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 & exec bun run index.ts"]
