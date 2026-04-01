FROM node:22-alpine AS builder

WORKDIR /app

# Copy shared types
COPY packages/shared ./packages/shared

# Copy portal source
COPY portal/package*.json ./portal/
WORKDIR /app/portal
RUN npm ci

COPY portal/tsconfig.json portal/vite.config.ts portal/index.html ./
COPY portal/src ./src
RUN npm run build

# Serve with nginx
FROM nginx:alpine

COPY --from=builder /app/portal/dist /usr/share/nginx/html
COPY portal/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
