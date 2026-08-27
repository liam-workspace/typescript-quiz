# ---- BASE ----
# Pinned to the major version this repository's suite has actually run
# against (v24.15.0 locally). node:26-alpine exists too, but shipping on a
# major nothing here has ever executed against is a risk taken for nothing.
FROM node:24-alpine AS base
RUN npm install -g pnpm@11.1.1
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json .npmrc ./
COPY packages/common/package.json ./packages/common/
COPY packages/db/package.json ./packages/db/
COPY packages/server/package.json ./packages/server/
COPY packages/app/package.json ./packages/app/

# ---- BUILDER (full deps, compiles dist/) ----
FROM base AS builder

# @liam-workspace/* resolves from GitHub Packages (see .npmrc). The token is
# passed as a BuildKit secret mount, never an ARG/ENV — an ARG value is
# recoverable from the image history even after the layer that used it.
RUN --mount=type=secret,id=node_auth_token,required=true \
    --mount=type=cache,id=pnpm,target=/pnpm/store \
    NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token)" \
    pnpm install --frozen-lockfile

COPY packages/common ./packages/common
COPY packages/db ./packages/db
COPY packages/server ./packages/server
COPY packages/app ./packages/app

# common -> db -> server -> app, each via its own build script (`tsc -p
# tsconfig.build.json` for the three backend packages, that plus `vite build`
# for @pp/app). Named explicitly rather than delegating to the root `pnpm
# build` script or a `--filter` pattern: a pattern that matches nothing exits
# 0 and prints "No projects matched the filters", so the image would report a
# successful build of something it never built. Naming every package this
# image ships makes an accidental omission loud instead of silent.
RUN pnpm --filter @pp/common build \
    && pnpm --filter @pp/db build \
    && pnpm --filter @pp/server build \
    && pnpm --filter @pp/app build

# ---- PROD-DEPS (production-only node_modules, no dev tooling) ----
# A fresh --prod install rather than `pnpm prune --prod` on the builder's
# node_modules: prune resolves against the root package.json's own
# dependency graph and stripped every workspace-package symlink (rxjs,
# @nestjs/*, reflect-metadata, @liam-workspace/*) out of
# packages/server/node_modules, not just the root's devDependencies.
FROM base AS prod-deps

RUN --mount=type=secret,id=node_auth_token,required=true \
    --mount=type=cache,id=pnpm,target=/pnpm/store \
    NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token)" \
    pnpm install --frozen-lockfile --prod

# ---- RUNNER ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/common/package.json ./packages/common/
COPY --from=prod-deps /app/packages/db/package.json ./packages/db/
COPY --from=prod-deps /app/packages/server/package.json ./packages/server/
COPY --from=prod-deps /app/packages/common/node_modules ./packages/common/node_modules
COPY --from=prod-deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=prod-deps /app/packages/server/node_modules ./packages/server/node_modules

COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/migrations ./packages/db/migrations
COPY --from=builder /app/packages/server/dist ./packages/server/dist

# The built SPA is static output only -- no node_modules, no package.json,
# just the files express.static serves (see main.ts). SPA_ROOT tells the
# server where to find them; main.ts no-ops the static/fallback wiring when
# it's unset or the directory doesn't exist, so this is also what makes the
# SPA optional outside this image (e.g. `pnpm --filter @pp/server start`).
COPY --from=builder /app/packages/app/dist /app/public
ENV SPA_ROOT=/app/public

# /media is a named volume at runtime. Docker seeds an empty named volume from
# the image's directory, ownership included, so creating it as `node` here is
# what makes it writable after the drop below -- otherwise the volume arrives
# owned by root and every upload fails.
RUN mkdir -p /media && chown -R node:node /media /app

# Drop root. The `node` images ship an unprivileged `node` user (uid 1000);
# nothing in this runtime needs more than that -- it binds 3000, reads its own
# dist/ and writes /media. A container that never needed root should not spend
# its life as root.
USER node

EXPOSE 3000

# GET /health is deliberately outside the /api prefix (main.ts excludes it
# from setGlobalPrefix), so this is not /api/health.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/main.js"]
