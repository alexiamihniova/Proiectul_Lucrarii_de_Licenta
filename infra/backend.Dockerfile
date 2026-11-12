# Development image for the backend API and the worker (same image, different command).
# Build context: repository root.
FROM node:24-alpine
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend ./
EXPOSE 3001
# Overridden per service in docker-compose.yml.
CMD ["npm", "run", "dev"]
