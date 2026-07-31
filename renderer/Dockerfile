# node:22 ships npm; no corepack/pnpm needed. Keeps the renderer fully
# self-contained (the rest of the repo uses pnpm, but this is a standalone
# service and is intentionally not part of the pnpm workspace).
FROM node:22

WORKDIR /app

# Runtime libraries required by Puppeteer's bundled Chromium on Debian bookworm.
# See https://pptr.dev/troubleshooting#running-on-alpine-and-linux.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcairo2 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libexpat1 \
        libgbm1 \
        libglib2.0-0 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxi6 \
        libxkbcommon0 \
        libxrandr2 \
        libxrender1 \
        libxshmfence1 \
        libxss1 \
        libxtst6 \
        xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first for layer caching. `npm ci` requires a committed
# package-lock.json and reproduces it exactly. The puppeteer postinstall
# downloads the bundled Chromium into the image.
COPY package.json package-lock.json ./
RUN npm ci

# Build TypeScript to dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies (typescript, @types/*) for a leaner runtime image.
RUN npm prune --omit=dev

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/health').then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})"

CMD ["node", "dist/server.js"]
