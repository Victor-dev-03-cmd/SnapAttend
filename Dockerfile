FROM oven/bun:1
WORKDIR /app
COPY package.json tsconfig.json ./
RUN bun install --production
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data /app/data/uploads && chown -R bun:bun /app/data
USER bun
ENV APP_ENV=production PORT=3000 DATA_DIR=/app/data NOTIFIER_MODE=mock
EXPOSE 3000
VOLUME /app/data
CMD ["bun","src/index.ts"]