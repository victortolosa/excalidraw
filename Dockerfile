FROM --platform=${BUILDPLATFORM} node:24@sha256:8530f76a96d88820d288761f022e318970dda93d01536919fbc16076b7983e63 AS build

WORKDIR /opt/node_app

COPY . .

# do not ignore optional dependencies:
# Error: Cannot find module @rollup/rollup-linux-x64-gnu
RUN --mount=type=cache,target=/root/.cache/yarn \
    npm_config_target_arch=${TARGETARCH} yarn --frozen-lockfile --network-timeout 600000

ARG NODE_ENV=production

RUN npm_config_target_arch=${TARGETARCH} yarn build:app:docker

# runtime: Node server (server/) serving the static build + the /api file API
# (fork change — upstream uses nginx here; see DASHBOARD_PLAN.md)
FROM node:24-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/src ./server/src
COPY --from=build /opt/node_app/excalidraw-app/build ./excalidraw-app/build

ENV NODE_ENV=production \
    PORT=80 \
    DATA_DIR=/data \
    STATIC_DIR=/app/excalidraw-app/build

EXPOSE 80
VOLUME /data

HEALTHCHECK CMD wget -q -O /dev/null http://localhost/api/health || exit 1

CMD ["node", "server/src/index.ts"]
