# PR Reviewer Web App (self-hosted). Build: docker build -t pr-reviewer-web .
# Base images pinned by digest (AD-21).
FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS build
WORKDIR /src
RUN npm install -g pnpm@12.21.0 --no-audit --no-fund --loglevel=error
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile && pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
ENV NODE_ENV=production PR_REVIEWER_DATA_DIR=/data PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /src /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/cli/bin/pr-reviewer.js", "web"]
