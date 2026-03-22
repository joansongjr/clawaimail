FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p data

EXPOSE 3000 2525

CMD ["node", "src/start.js"]
