FROM golang:1.27-bookworm AS agent-build
WORKDIR /src
COPY agent/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /bin/lightprobe-agent-linux-amd64 . \
 && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o /bin/lightprobe-agent-linux-arm64 .

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends rclone ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/app/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts
COPY server/ ./server/
COPY web/ ./web/
COPY tools/ ./tools/
COPY agent/install.sh agent/bootstrap.sh agent/entry.sh ./agent/
COPY --from=agent-build /bin/lightprobe-agent-linux-* ./bin/
RUN cd /app/bin && sha256sum lightprobe-agent-linux-* > SHA256SUMS
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/main.mjs"]
