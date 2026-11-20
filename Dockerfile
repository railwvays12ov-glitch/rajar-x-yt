# syntax=docker/dockerfile:1.7
# ─── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
# The runtime stage installs FFmpeg + yt-dlp itself, so skip the npm download helper here.
ENV SKIP_MEDIA_TOOLS=1
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build && npm prune --omit=dev

# ─── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
# Leave empty for the latest release, or pin e.g. --build-arg YTDLP_VERSION=<release tag>.
ARG YTDLP_VERSION=
ENV NODE_ENV=production \
    PORT=8080 \
    YTDLP_BIN=/opt/yt-dlp/bin/yt-dlp \
    FFMPEG_BIN=/usr/bin/ffmpeg \
    MEDIA_TEMP_DIR=/tmp/rajar-x-media \
    DATA_DIR=/data/rajar-x-yt \
    PYTHONDONTWRITEBYTECODE=1

# FFmpeg from Debian; yt-dlp in an isolated virtualenv. Rebuild regularly — platforms change often.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates tini \
 && python3 -m venv /opt/yt-dlp \
 && /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp${YTDLP_VERSION:+==${YTDLP_VERSION}}" \
 && apt-get purge -y python3-venv && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Non-root runtime user.
RUN groupadd --system --gid 10001 rajarx && useradd --system --uid 10001 --gid rajarx --home /app --shell /usr/sbin/nologin rajarx \
 && mkdir -p /tmp/rajar-x-media /data/rajar-x-yt && chown rajarx:rajarx /tmp/rajar-x-media /data /data/rajar-x-yt && chmod 700 /tmp/rajar-x-media

COPY --from=build --chown=rajarx:rajarx /app/package.json ./
COPY --from=build --chown=rajarx:rajarx /app/node_modules ./node_modules
COPY --from=build --chown=rajarx:rajarx /app/dist ./dist
COPY --from=build --chown=rajarx:rajarx /app/migrations ./migrations
# Railway does not allow Dockerfile VOLUME instructions. /data is created above
# and remains writable for the running container; use a Railway Volume if persistence is needed.

USER rajarx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini forwards SIGTERM so the app can shut down gracefully and reap yt-dlp/FFmpeg children.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server/server/index.js"]
