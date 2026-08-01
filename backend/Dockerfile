FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Free tiers (Render/Railway/Fly) all respect $PORT.
CMD ["node", "src/server.js"]
