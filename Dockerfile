# 构建阶段：需要完整工具链（pnpm、TypeScript、Vite），体积不计入最终镜像。
FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @model-ext-mcp/server deploy --prod --legacy /output/server
# 依赖自带的 source map 约 4 MB，运行时用不到，只会在镜像里占地方。
RUN find /output/server -name '*.map' -delete

# 运行阶段只需要 node 可执行文件本身。官方 node 镜像里 npm、corepack、yarn 和头文件
# 占了上百 MB，直接拿它做基础镜像等于把整个工具链塞进生产镜像。
FROM node:24-alpine AS node-binary

# 最小运行时用 alpine：基础镜像约 13 MB，node 二进制单独拷进来。
FROM alpine:3.22

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIST_DIR=/app/web

# libstdc++ 是 node 二进制的动态依赖；ca-certificates 供 HTTPS 的 Ollama 端点使用。
# /data 在这里就建好并交给 node，Docker 首次创建卷时会连同属主一起复制过去。
RUN apk add --no-cache libstdc++ ca-certificates \
 && addgroup -g 1000 node \
 && adduser -u 1000 -G node -D -s /sbin/nologin node \
 && install -d -o node -g node /data

COPY --from=node-binary /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
# 用 --chown 一次写对属主。先 COPY 再 chown -R 会让已复制的内容整份复制成新的一层，
# 白白翻倍（原来这里就多出了 24 MB）。
COPY --from=build --chown=node:node /output/server /app/server
COPY --from=build --chown=node:node /workspace/apps/web/dist /app/web

USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "/app/server/dist/index.js"]
