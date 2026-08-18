import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * Single client per process. Cached on globalThis so `tsx watch` hot reloads
 * don't leak a new connection pool on every file save.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
