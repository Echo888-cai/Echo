FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/data-plane/package.json packages/data-plane/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/finance-native/package.json packages/finance-native/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY apps/worker apps/worker
COPY packages packages

USER node
CMD ["npm", "run", "start", "--workspace", "@echo/worker"]
