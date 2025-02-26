import winston, { Logger } from 'winston';

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  defaultMeta: { label: 'root' },
  transports: [
  ]
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.splat(),
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

export type LogFactory = (name: string) => Logger;

export default function getLogger(name: string) {
  return logger.child({ label: name });
}