# Use official Bun image for Node.js + Bun support
FROM oven/bun:1.1

WORKDIR /app

# Copy package files and install dependencies
COPY package.json bun.lockb ./
RUN bun install

# Copy source code
COPY . .

# Expose no ports (bots connect out)
CMD ["bun", "run", "index.ts"]