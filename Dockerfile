# JustRigIt MCP server (remote/HTTP mode) — put behind your HTTPS reverse proxy.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV JUSTRIGIT_EXPORT_DIR=/app/exports
EXPOSE 8787
# Set JUSTRIGIT_PUBLIC_URL=https://rig.your-domain.com so download links point at your domain.
CMD ["node", "src/node/mcp-server.mjs", "--http", "8787"]
