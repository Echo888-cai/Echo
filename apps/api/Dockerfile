FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

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
COPY apps/api apps/api
COPY apps/worker/src/workflows.ts apps/worker/src/workflows.ts
COPY packages packages

USER node
EXPOSE 4180
CMD ["npm", "run", "start", "--workspace", "@echo/api"]
