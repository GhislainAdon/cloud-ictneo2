# syntax=docker/dockerfile:1.7
#
# Single stateless image: Angular UI built to static assets, served by the
# Go binary which also exposes the JSON/SSE API.
#
#   docker build -t cloud-ictneo2:local .

# ---- Stage 1: build the Angular frontend --------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npx ng build --configuration production

# ---- Stage 2: build the Go backend --------------------------------------
FROM golang:1.24-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -o /out/launcher ./cmd/launcher

# ---- Stage 3: minimal runtime, non-root ---------------------------------
FROM alpine:3.20 AS runtime
RUN adduser -S -u 10001 launcher
WORKDIR /app
COPY --from=api /out/launcher /usr/local/bin/launcher
# Angular emits into dist/<project>/browser (project name = frontend)
COPY --from=web /web/dist/frontend/browser /app/static
USER launcher
EXPOSE 9876
ENTRYPOINT ["launcher", "--listen", "0.0.0.0:9876", "--static", "/app/static"]
