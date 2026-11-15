FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 1234
# node is PID 1 so SIGTERM reaches Hocuspocus, which flushes open documents before exiting.
CMD ["node", "--import", "tsx", "src/server.ts"]
