FROM node:22-alpine AS builder

WORKDIR /app

# Copy shared types
COPY packages/shared ./packages/shared

# Copy relay source
COPY relay/package*.json ./relay/
WORKDIR /app/relay
RUN npm ci

COPY relay/tsconfig.json ./
COPY relay/src ./src
RUN npx tsc

# Production stage
FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/packages/shared ./packages/shared
COPY relay/package*.json ./relay/
WORKDIR /app/relay
RUN npm ci --omit=dev

COPY --from=builder /app/relay/dist ./dist

EXPOSE 3001

CMD ["node", "dist/index.js"]
