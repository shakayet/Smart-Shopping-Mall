import path from 'path';
import DailyRotateFile from 'winston-daily-rotate-file';
import { createLogger, format, transports } from 'winston';
const { combine, timestamp, label, printf } = format;

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

const logger = createLogger({
  level: 'info',
  format: combine(label({ label: 'SERVER-NAME' }), timestamp(), myFormat),
  transports: [
    new transports.Console(),
    new DailyRotateFile({
      filename: path.join(
        process.cwd(),
        'winston',
        'success',
        '%DATE%-success.log'
      ),
      datePattern: 'DD-MM-YYYY-HH',
      maxSize: '20m',
      maxFiles: '1d',
    }),
  ],
});

const errorLogger = createLogger({
  level: 'error',
  format: combine(label({ label: 'SERVER-NAME' }), timestamp(), myFormat),
  transports: [
    new transports.Console(),
    new DailyRotateFile({
      filename: path.join(
        process.cwd(),
        'winston',
        'error',
        '%DATE%-error.log'
      ),
      datePattern: 'DD-MM-YYYY-HH',
      maxSize: '20m',
      maxFiles: '1d',
    }),
  ],
});

export { errorLogger, logger };
