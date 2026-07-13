# syntax=docker/dockerfile:1.7

# Use the official Bun image
FROM oven/bun:1

WORKDIR /app
ENV BUN_INSTALL_CACHE_DIR=/bun-cache

# Install server dependencies
COPY package.json bun.lockb ./
RUN --mount=type=cache,target=/bun-cache bun install --frozen-lockfile

# Install frontend dependencies (cached separately from source)
COPY frontend/package.json frontend/bun.lock ./frontend/
RUN --mount=type=cache,target=/bun-cache cd frontend && bun install --frozen-lockfile

# Copy the rest of the source and build the frontend into ./public
COPY . .
RUN cd frontend && bun run build

# The server serves the built frontend and the API on $PORT (default 3000).
CMD ["bun", "run", "index.ts"]
