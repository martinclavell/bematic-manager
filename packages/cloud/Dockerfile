FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json* ./
COPY tsconfig.json tsconfig.base.json ./

# Copy all packages
COPY packages/common/ packages/common/
COPY packages/db/ packages/db/
COPY packages/bots/ packages/bots/
COPY packages/cloud/ packages/cloud/

# Install dependencies
RUN npm install --workspace=packages/cloud --include-workspace-root

# Build all packages in order
RUN npm run build -w packages/common && \
    npm run build -w packages/db && \
    npm run build -w packages/bots && \
    npm run build -w packages/cloud

# Production image
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/common/package.json packages/common/
COPY packages/db/package.json packages/db/
COPY packages/bots/package.json packages/bots/
COPY packages/cloud/package.json packages/cloud/

RUN npm install --workspace=packages/cloud --include-workspace-root --omit=dev

# Copy built artifacts
COPY --from=builder /app/packages/common/dist packages/common/dist
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/packages/bots/dist packages/bots/dist
COPY --from=builder /app/packages/cloud/dist packages/cloud/dist

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DATABASE_URL=/app/data/bematic.db

EXPOSE 3000

CMD ["node", "packages/cloud/dist/index.js"]
