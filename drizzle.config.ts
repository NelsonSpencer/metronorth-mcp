import type { Config } from 'drizzle-kit';

export default {
  schema: './src/infrastructure/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH || './db/metronorth.db',
  },
} satisfies Config;
