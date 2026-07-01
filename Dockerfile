# Use the official Bun image
FROM oven/bun:1

WORKDIR /app

# Install server dependencies
COPY package.json bun.lockb ./
RUN bun install

# Install frontend dependencies (cached separately from source)
COPY frontend/package.json ./frontend/package.json
RUN cd frontend && bun install

# Copy the rest of the source and build the frontend into ./public
COPY . .
RUN cd frontend && bun run build

# The server serves the built frontend and the API on $PORT (default 3000)
CMD ["bun", "run", "index.ts"]
