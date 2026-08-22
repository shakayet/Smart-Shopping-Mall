import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

const environmentPath = path.join(process.cwd(), '.env');
const environmentResult = dotenv.config({
  path: environmentPath,
  // Local development must use the selected workspace .env file even when
  // the parent terminal has stale variables. Production keeps injected secrets.
  override: process.env.NODE_ENV !== 'production',
});

if (environmentResult.error && process.env.NODE_ENV !== 'production') {
  throw new Error(`Unable to load environment file: ${environmentPath}`);
}

const optionalUrl = z.string().url().optional();
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    DNS_SERVERS: z.string().optional(),
    IP_ADDRESS: z.string().min(1),
    PORT: z.coerce.number().int().positive().max(65535).default(5000),
    CORS_ORIGIN: z.string().min(1),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRE_IN: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_REFRESH_EXPIRE_IN: z.string().default('30d'),
    EMAIL_FROM: z.string().min(1),
    EMAIL_USER: z.string().min(1),
    EMAIL_PORT: z.coerce.number().int().positive(),
    EMAIL_HOST: z.string().min(1),
    EMAIL_PASS: z.string().min(1),
    PROJECT_NAME: z.string().default('Smart Shopping Mall'),
    BRAND_LOGO: optionalUrl,
    SUPER_ADMIN_EMAIL: z.string().email(),
    SUPER_ADMIN_PASSWORD: z.string().min(12),
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    GOOGLE_OAUTH_CALLBACK_URL: optionalUrl,
    FRONTEND_OAUTH_CALLBACK_URL: optionalUrl,
    SESSION_SECRET: z.string().min(32),
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
    AWS_REGION: z.string().min(1),
    AWS_BUCKET_NAME: z.string().min(1),
    AWS_CLOUDFRONT_DOMAIN: z.string().min(1),
    STRIPE_SECRET_KEY: z.string().min(1),
    WEBHOOK_SECRET: z.string().min(1),
    STRIPE_CURRENCY: z.string().length(3).default('aed'),
    API_PUBLIC_URL: z.string().url(),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().min(1),
    PLATFORM_FEE_PERCENTAGE: z.coerce.number().min(0).max(100).default(12),
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 * 1024),
  })
  .superRefine((env, ctx) => {
    const oauthValues = [
      env.GOOGLE_OAUTH_CLIENT_ID,
      env.GOOGLE_OAUTH_CLIENT_SECRET,
      env.GOOGLE_OAUTH_CALLBACK_URL,
      env.FRONTEND_OAUTH_CALLBACK_URL,
    ];
    if (oauthValues.some(Boolean) && !oauthValues.every(Boolean)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'All Google OAuth settings must be provided together',
        path: ['GOOGLE_OAUTH_CLIENT_ID'],
      });
    }
    if (env.NODE_ENV === 'production' && env.CORS_ORIGIN.includes('*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CORS_ORIGIN cannot contain * in production',
        path: ['CORS_ORIGIN'],
      });
    }
    const firebaseValues = [
      env.FIREBASE_PROJECT_ID,
      env.FIREBASE_CLIENT_EMAIL,
      env.FIREBASE_PRIVATE_KEY,
    ];
    if (firebaseValues.some(Boolean) && !firebaseValues.every(Boolean)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'All Firebase service-account settings must be provided together',
        path: ['FIREBASE_PROJECT_ID'],
      });
    }
    if (
      env.FIREBASE_CLIENT_EMAIL &&
      !z.string().email().safeParse(env.FIREBASE_CLIENT_EMAIL).success
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FIREBASE_CLIENT_EMAIL must be a valid email address',
        path: ['FIREBASE_CLIENT_EMAIL'],
      });
    }
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map(issue => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

const env = parsed.data;
const corsOrigins = env.CORS_ORIGIN.split(',').map(origin => origin.trim());

export default {
  ip_address: env.IP_ADDRESS,
  database_url: env.DATABASE_URL,
  dns_servers: env.DNS_SERVERS
    ?.split(',')
    .map(server => server.trim())
    .filter(Boolean),
  node_env: env.NODE_ENV,
  port: env.PORT,
  bcrypt_salt_rounds: env.BCRYPT_SALT_ROUNDS,
  cors_origin: corsOrigins,
  branding: { projectName: env.PROJECT_NAME, logoUrl: env.BRAND_LOGO },
  jwt: {
    jwt_secret: env.JWT_SECRET,
    jwt_expire_in: env.JWT_EXPIRE_IN,
    jwt_refresh_secret: env.JWT_REFRESH_SECRET,
    jwt_refresh_expire_in: env.JWT_REFRESH_EXPIRE_IN,
  },
  email: {
    from: env.EMAIL_FROM,
    user: env.EMAIL_USER,
    port: env.EMAIL_PORT,
    host: env.EMAIL_HOST,
    pass: env.EMAIL_PASS,
  },
  super_admin: { email: env.SUPER_ADMIN_EMAIL, password: env.SUPER_ADMIN_PASSWORD },
  oauth: {
    google: {
      clientID: env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      callbackURL: env.GOOGLE_OAUTH_CALLBACK_URL ?? '',
    },
    frontendCallbackURL: env.FRONTEND_OAUTH_CALLBACK_URL ?? '',
    sessionSecret: env.SESSION_SECRET,
    enabled: Boolean(env.GOOGLE_OAUTH_CLIENT_ID),
  },
  aws: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_REGION,
    bucketName: env.AWS_BUCKET_NAME,
    cloudfrontDomain: env.AWS_CLOUDFRONT_DOMAIN,
  },
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.WEBHOOK_SECRET,
    currency: env.STRIPE_CURRENCY.toLowerCase(),
    publicUrl: env.API_PUBLIC_URL.replace(/\/$/, ''),
    connectCountry: 'AE',
  },
  firebase: {
    projectId: env.FIREBASE_PROJECT_ID ?? '',
    clientEmail: env.FIREBASE_CLIENT_EMAIL ?? '',
    privateKey: (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    enabled: Boolean(
      env.FIREBASE_PROJECT_ID &&
        env.FIREBASE_CLIENT_EMAIL &&
        env.FIREBASE_PRIVATE_KEY,
    ),
  },
  openai: { apiKey: env.OPENAI_API_KEY },
  platform: { feePercentage: env.PLATFORM_FEE_PERCENTAGE },
  uploads: { maxBytes: env.MAX_UPLOAD_BYTES },
} as const;
