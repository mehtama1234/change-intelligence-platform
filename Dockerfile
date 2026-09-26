FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8780
ENV RUNTIME_DATA_DIR=/app/runtime
ENV BACKUP_DIR=/app/backups

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

RUN mkdir -p /app/runtime /app/backups
EXPOSE 8780
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8780/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.mjs"]
