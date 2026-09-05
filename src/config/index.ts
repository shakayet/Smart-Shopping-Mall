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
const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const firebaseServiceAccountSchema = z.object({
  type: z.literal('service_account'),
  project_id: z.string().min(1),
  private_key: z.string().includes('-----BEGIN PRIVATE KEY-----'),
  client_email: z.string().email(),
});

const decodeFirebaseServiceAccount = (encodedValue?: string) => {
  if (!encodedValue) return null;

  try {
    const decodedValue = Buffer.from(encodedValue.trim(), 'base64').toString('utf8');
    const parsedValue: unknown = JSON.parse(decodedValue);
    const serviceAccount = firebaseServiceAccountSchema.parse(parsedValue);

    return {
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
    };
  } catch {
    throw new Error(
      'Invalid environment configuration: FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 must contain a Base64-encoded Firebase service-account JSON file',
    );
  }
};

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
    TEST_FIXED_OTP_EMAIL: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().email().optional(),
    ),
    TEST_FIXED_OTP_CODE: z.preprocess(
      emptyStringToUndefined,
      z.string().regex(/^\d{5}$/).optional(),
    ),
    FIREBASE_SERVICE_ACCOUNT_KEY_BASE64: z.string().min(1).optional(),
    FIREBASE_WEB_PUSH_CREDENTIALS: z.string().min(20).max(4096).optional(),
    OPENAI_API_KEY: z.string().min(1),
    PLATFORM_FEE_PERCENTAGE: z.coerce.number().min(0).max(100).default(12),
    SELLER_STRIKE_SUSPENSION_THRESHOLD: z.coerce
      .number()
      .int()
      .min(2)
      .default(3),
    MISSED_COLLECTION_CANCELLATION_THRESHOLD: z.coerce
      .number()
      .int()
      .min(2)
      .default(3),
    BUYER_REJECTION_RESTRICTION_THRESHOLD: z.coerce
      .number()
      .int()
      .min(2)
      .default(3),
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
    const fixedOtpValues = [env.TEST_FIXED_OTP_EMAIL, env.TEST_FIXED_OTP_CODE];
    if (fixedOtpValues.some(Boolean) && !fixedOtpValues.every(Boolean)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TEST_FIXED_OTP_EMAIL and TEST_FIXED_OTP_CODE must be provided together',
        path: ['TEST_FIXED_OTP_EMAIL'],
      });
    }
    if (env.NODE_ENV === 'production' && fixedOtpValues.some(Boolean)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Fixed test OTP credentials cannot be enabled in production',
        path: ['TEST_FIXED_OTP_EMAIL'],
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
const firebaseServiceAccount = decodeFirebaseServiceAccount(
  env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64,
);

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
    serviceAccount: firebaseServiceAccount,
    webPushCredentials: env.FIREBASE_WEB_PUSH_CREDENTIALS ?? '',
    enabled: Boolean(firebaseServiceAccount),
  },
  fixedTestOtp: {
    enabled: Boolean(
      env.NODE_ENV !== 'production' &&
        env.TEST_FIXED_OTP_EMAIL &&
        env.TEST_FIXED_OTP_CODE,
    ),
    email: env.TEST_FIXED_OTP_EMAIL?.toLowerCase() ?? '',
    code: env.TEST_FIXED_OTP_CODE ? Number(env.TEST_FIXED_OTP_CODE) : 0,
  },
  openai: { apiKey: env.OPENAI_API_KEY },
  platform: { feePercentage: env.PLATFORM_FEE_PERCENTAGE },
  penaltyPolicy: {
    sellerStrikeSuspensionThreshold:
      env.SELLER_STRIKE_SUSPENSION_THRESHOLD,
    missedCollectionCancellationThreshold:
      env.MISSED_COLLECTION_CANCELLATION_THRESHOLD,
    buyerRejectionRestrictionThreshold:
      env.BUYER_REJECTION_RESTRICTION_THRESHOLD,
  },
  uploads: { maxBytes: env.MAX_UPLOAD_BYTES },
} as const;
