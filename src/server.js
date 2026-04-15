import Fastify from 'fastify';
import dotenv from 'dotenv';
import app from './app.js';
import requestIdPlugin from './plugins/requestId.js';
import { startDeviceTokenSweeper } from './utils/deviceTokenSweeper.js';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

const loggerOptions = {
  // logger:true,
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]'
  },
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss.l o',
          singleLine: false
        }
      }
};


const server = Fastify({ logger: loggerOptions, ajv: { customOptions: { allowUnionTypes: true } } });

// Register lightweight local request-id plugin so request.id exists in all logs
await server.register(requestIdPlugin);

// Register main app (plugins + routes)
await server.register(app);

const start = async () => {
  try {
    await server.listen({ port: process.env.PORT || 5000, host: '0.0.0.0' });
    server.log.info({ msg: 'Server running', port: process.env.PORT || 5000 });
    // start background sweeper for device token audits
    try {
      startDeviceTokenSweeper(server);
    } catch (e) {
      server.log?.warn?.('failed to start device token sweeper', e?.message || e);
    }
    // console.log(process.env.CLOUDINARY_API_KEY)
    // console.log(process.env);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
