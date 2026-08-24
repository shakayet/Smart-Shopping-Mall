import http from 'http';
import dns from 'node:dns';
import mongoose from 'mongoose';
import { Server as SocketServer } from 'socket.io';
import config from './config';
import { seedSuperAdmin } from './DB/seedAdmin';
import { socketHelper } from './helpers/socketHelper';
import { OrderService } from './app/modules/order/order.service';
import { errorLogger, logger } from './shared/logger';

let httpServer: http.Server | undefined;
let socketServer: SocketServer | undefined;
let shuttingDown = false;
let reservationTimer: ReturnType<typeof setInterval> | undefined;

const isBrokenPipeError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EPIPE';

// Logging destinations can disappear when a terminal, deployment log collector,
// or task runner disconnects. A broken log pipe must not take the API offline.
process.stdout.on('error', error => {
  if (!isBrokenPipeError(error)) throw error;
});
process.stderr.on('error', error => {
  if (!isBrokenPipeError(error)) throw error;
});

const shutdown = async (signal: string, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received; shutting down`);

  const forceExit = setTimeout(() => {
    errorLogger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  socketServer?.close();
  if (reservationTimer) clearInterval(reservationTimer);
  if (httpServer) {
    await new Promise<void>(resolve => httpServer?.close(() => resolve()));
  }
  await mongoose.disconnect();
  clearTimeout(forceExit);
  process.exit(exitCode);
};

const main = async () => {
  if (config.dns_servers?.length) {
    dns.setServers(config.dns_servers);
  }

  await mongoose.connect(config.database_url, {
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info('Database connected successfully');

  await seedSuperAdmin();

  // app.ts creates the Mongo-backed session store as a module side effect.
  // Load it only after DNS is configured and the primary connection is ready.
  const { default: app } = await import('./app');

  httpServer = app.listen(config.port, config.ip_address, () => {
    logger.info(`Application listening on port ${config.port}`);
  });

  socketServer = new SocketServer(httpServer, {
    pingTimeout: 60_000,
    cors: {
      origin: [...config.cors_origin],
      credentials: true,
    },
  });
  socketHelper.socket(socketServer);
  reservationTimer = setInterval(() => {
    void OrderService.expirePendingOrders().catch(error => {
      errorLogger.error('Failed to expire pending orders', error);
    });
  }, 60_000);
  reservationTimer.unref();
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', error => {
  if (isBrokenPipeError(error)) return;
  errorLogger.error('Uncaught exception', error);
  void shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', error => {
  errorLogger.error('Unhandled rejection', error);
  void shutdown('unhandledRejection', 1);
});

void main().catch(error => {
  errorLogger.error('Application startup failed', error);
  void shutdown('startup failure', 1).catch(shutdownError => {
    errorLogger.error('Failed to shut down after startup failure', shutdownError);
    process.exit(1);
  });
});
