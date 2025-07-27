FROM pgvector/pgvector:pg16

RUN apt-get update && apt-get install -y curl \
    && curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/local/bin/bun \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY bun.lock package.json ./
RUN bun install --omit dev --ignore-scripts drizzle-kit drizzle-orm postgres next-runtime-env zod @t3-oss/env-nextjs

COPY apps/sim/package.json ./apps/sim/package.json
COPY apps/sim/drizzle.config.ts ./apps/sim/drizzle.config.ts
COPY apps/sim/db ./apps/sim/db
COPY apps/sim/lib/env.ts ./apps/sim/lib/env.ts
COPY docker/db-entrypoint.sh /usr/local/bin/db-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/db-entrypoint.sh"]
