# Builds the app into a small container for a host such as Google Cloud Run.
# Not yet built or run anywhere: this laptop has no Docker. First real test is the first deploy.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=1
# Pages are prerendered at build time without a database. These placeholders
# only satisfy start-up checks; the real values are set on the host.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
ENV BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime
ENV BETTER_AUTH_URL=http://localhost:8080
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=8080
# Run as the unprivileged user that ships with the image.
USER node
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
EXPOSE 8080
CMD ["node", "server.js"]
