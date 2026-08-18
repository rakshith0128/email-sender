import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { errorHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { campaignsRouter } from './routes/campaigns.js';
import { emailsRouter } from './routes/emails.js';
import { sendersRouter } from './routes/senders.js';
import { statsRouter } from './routes/stats.js';
import { healthRouter } from './routes/health.js';
import { bootstrapReconciler } from './queue/reconciler.js';
import { closeQueue } from './queue/emailQueue.js';

const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  }),
);
// Large limit so a 10k-recipient campaign body fits in one request.
app.use(express.json({ limit: '10mb' }));

app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/senders', sendersRouter);
app.use('/api/stats', statsRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, authDisabled: env.AUTH_DISABLED },
    `API listening on http://localhost:${env.PORT}`,
  );
});

// The API also reconciles at boot, so starting the API alone is enough to
// recover a schedule after Redis was wiped.
bootstrapReconciler().catch((err) => logger.error({ err }, 'Startup reconciliation failed'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down API');
  server.close();
  try {
    await closeQueue();
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ err }, 'Error during API shutdown');
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
