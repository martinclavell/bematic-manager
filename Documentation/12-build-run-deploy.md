# 12 — Build, Run & Deploy

[← Back to Index](./README.md)

---

## Prerequisites

- Node.js >= 20
- npm (for workspace support)

---

## Install Dependencies

```bash
npm install
```

---

## Build (all packages in order)

```bash
npm run build
```

Or individually:
```bash
npm run build:common
npm run build:db
npm run build:bots
npm run build:cloud
npm run build:agent
```

---

## Development

```bash
# Cloud service with hot reload
npm run dev:cloud

# Agent with hot reload
npm run dev:agent
```

---

## Database

```bash
# Generate Drizzle migrations
npm run db:generate

# Apply migrations
npm run db:migrate
```

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

Tests are located in `packages/*/src/**/*.test.ts` and use Vitest.

---

## Type Checking

```bash
npm run typecheck
```

---

## Deploy Cloud to Railway

1. Push to repository
2. Railway uses `railway.toml` → builds `packages/cloud/Dockerfile`
3. Health check at `/health`
4. SQLite database stored at `/app/data/bematic.db`

---

## Run Agent Locally

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your values

# Option 1: Direct run
cd packages/agent
npm run start

# Option 2: Auto-restart wrapper
cd packages/agent
bash start-agent.sh
```
