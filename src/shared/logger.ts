import path from 'path';
import DailyRotateFile from 'winston-daily-rotate-file';
import { createLogger, format, transports } from 'winston';
const { colorize, combine, timestamp, label, printf } = format;

const myFormat = printf(info => {
  const { level, message, label, timestamp } = info as unknown as {
    level: string;
    message: string;
    label: string;
    timestamp: string;
  };
  const date = new Date(timestamp);
  const hour = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();

  return `${date.toDateString()} ${hour}:${minutes}:${seconds} [${label}] ${level}: ${message}`;
});

const fileFormat = combine(label({ label: 'SERVER-NAME' }), timestamp(), myFormat);
const highlightStartup = format(info => {
  if (
    typeof info.message === 'string' &&
    info.message.startsWith('Application listening on port ')
  ) {
    // Use Winston's yellow "warn" palette for display without changing severity.
    (info as unknown as Record<symbol, string>)[Symbol.for('level')] = 'warn';
  }
  return info;
});
const consoleFormat = combine(
  highlightStartup(),
  colorize({ all: true }),
  label({ label: 'SERVER-NAME' }),
  timestamp(),
  myFormat,
);

const logger = createLogger({
  level: 'info',
  format: fileFormat,
  transports: [
    new transports.Console({ format: consoleFormat }),
    new DailyRotateFile({
      filename: path.join(
        process.cwd(),
        'winston',
        'success',
        '%DATE%-success.log',
      ),
      datePattern: 'DD-MM-YYYY-HH',
      maxSize: '20m',
      maxFiles: '1d',
    }),
  ],
});

const errorLogger = createLogger({
  level: 'error',
  format: fileFormat,
  transports: [
    new transports.Console({ format: consoleFormat }),
    new DailyRotateFile({
      filename: path.join(
        process.cwd(),
        'winston',
        'error',
        '%DATE%-error.log',
      ),
      datePattern: 'DD-MM-YYYY-HH',
      maxSize: '20m',
      maxFiles: '1d',
    }),
  ],
});

export { errorLogger, logger };
