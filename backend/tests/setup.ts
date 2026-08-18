// Minimal env so config/env.ts validates without a real .env present.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'fatal';
