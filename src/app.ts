import cors from 'cors';
import express, { Request, Response } from 'express';
import helmet from 'helmet';
import { StatusCodes } from 'http-status-codes';
import session from 'express-session';
import passport from 'passport';
import MongoStore from 'connect-mongo';
import path from 'path';
import mongoose from 'mongoose';
import { initializePassport } from './config/passport';
import config from './config';
import globalErrorHandler from './app/middlewares/globalErrorHandler';
import { apiLimiter } from './app/middlewares/rateLimiter';
import router from './routes';
import { Morgan } from './shared/morgen';
import { PaymentController } from './app/modules/payment/payment.controller';
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
//morgan
app.use(Morgan.successHandler);
app.use(Morgan.errorHandler);

//security headers
app.use(helmet());

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || config.cors_origin.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin is not allowed by CORS'));
    },
  }),
);

//Stripe webhook needs the raw request body, must be registered before express.json()
app.post(
  '/api/v1/payment/webhook',
  express.raw({ type: 'application/json' }),
  PaymentController.stripeWebhook,
);

//body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//rate limiting for all API routes
app.use('/api', apiLimiter);

//session configuration for OAuth
app.use(
  session({
    secret: config.oauth.sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: 'ssm.sid',
    store: MongoStore.create({
      mongoUrl: config.database_url,
      ttl: 24 * 60 * 60,
      touchAfter: 60 * 60,
    }),
    cookie: {
      secure: config.node_env === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  }),
);

//initialize Passport.js
initializePassport();
app.use(passport.initialize());
app.use(passport.session());

// Only profile images are public. Proofs and temporary AI inputs are never served.
app.use(
  '/image',
  express.static(path.join(process.cwd(), 'uploads', 'image'), {
    dotfiles: 'deny',
    fallthrough: false,
    index: false,
    maxAge: config.node_env === 'production' ? '1d' : 0,
  }),
);

//router
app.use('/api/v1', router);

//live response
app.get('/', (req: Request, res: Response) => {
  const date = new Date(Date.now());
  res.send(
    `<h1 style="text-align:center; color:#173616; font-family:Verdana;">Beep-beep! The server is alive and kicking.</h1>
    <p style="text-align:center; color:#173616; font-family:Verdana;">${date}</p>
    `,
  );
});

app.get('/health/live', (_req: Request, res: Response) => {
  res.status(StatusCodes.OK).json({ status: 'ok' });
});

app.get('/health/ready', (_req: Request, res: Response) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? StatusCodes.OK : StatusCodes.SERVICE_UNAVAILABLE).json({
    status: ready ? 'ready' : 'not_ready',
  });
});

//global error handle
app.use(globalErrorHandler);

//handle not found route;
app.use((req, res) => {
  res.status(StatusCodes.NOT_FOUND).json({
    success: false,
    message: 'Not found',
    errorMessages: [
      {
        path: req.originalUrl,
        message: "API DOESN'T EXIST",
      },
    ],
  });
});

export default app;
