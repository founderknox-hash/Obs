FROM node:22-bookworm AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.3.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Build the official Luau 0.741 AST frontend against this image's libc.
ENV LUAU_SOURCE_DIR=/app/tools/luau-source
RUN bash tools/luau-ast/build.sh
RUN test -x tools/luau-ast/bin/luau-ast

RUN pnpm run typecheck
RUN pnpm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.3.4 --activate

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/app ./app
COPY --from=build /app/components ./components
COPY --from=build /app/lib ./lib
COPY --from=build /app/tools/luau-ast ./tools/luau-ast

# The official Luau source is not needed at runtime; only the compiled bridge is.
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/tsconfig.json ./tsconfig.json

EXPOSE 10000

CMD ["sh", "-c", "pnpm start -p ${PORT:-10000}"]
