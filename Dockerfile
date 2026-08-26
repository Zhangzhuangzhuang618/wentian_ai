FROM node:24-alpine

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/infrastructure/package.json packages/infrastructure/package.json
COPY packages/adapters/consumer-doubao-web/package.json packages/adapters/consumer-doubao-web/package.json
COPY packages/adapters/consumer-qianwen-web/package.json packages/adapters/consumer-qianwen-web/package.json

RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY migrations ./migrations

EXPOSE 3000

CMD ["pnpm", "dev:api"]
