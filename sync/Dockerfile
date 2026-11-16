FROM node:22-alpine
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .
EXPOSE 1234
# node is PID 1 so SIGTERM reaches Hocuspocus, which flushes open documents before exiting.
CMD ["node", "--import", "tsx", "src/server.ts"]
