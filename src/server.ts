import http from 'http';
import mongoose from 'mongoose';
import { Server as SocketServer } from 'socket.io';
import app from './app';
import config from './config';
import { seedSuperAdmin } from './DB/seedAdmin';
import { socketHelper } from './helpers/socketHelper';
import { OrderService } from './app/modules/order/order.service';
import { errorLogger, logger } from './shared/logger';

let httpServer: http.Server | undefined;
let socketServer: SocketServer | undefined;
let shuttingDown = false;
let reservationTimer: ReturnType<typeof setInterval> | undefined;

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
  await mongoose.connect(config.database_url, {
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info('Database connected successfully');

  await seedSuperAdmin();

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
  errorLogger.error('Uncaught exception', error);
  void shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', error => {
  errorLogger.error('Unhandled rejection', error);
  void shutdown('unhandledRejection', 1);
});

void main().catch(error => {
  errorLogger.error('Application startup failed', error);
  void shutdown('startup failure', 1);
});
