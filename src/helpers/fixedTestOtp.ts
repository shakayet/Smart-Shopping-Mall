import config from '../config';

const normalizeEmail = (email: string) => email.toLowerCase().trim();

export const isFixedTestOtpEmail = (email: string): boolean =>
  config.fixedTestOtp.enabled &&
  normalizeEmail(email) === config.fixedTestOtp.email;

export const getFixedTestOtp = (email: string): number | null =>
  isFixedTestOtpEmail(email) ? config.fixedTestOtp.code : null;

export const isValidFixedTestOtp = (
  email: string,
  oneTimeCode: number | string,
): boolean =>
  isFixedTestOtpEmail(email) &&
  String(oneTimeCode) === String(config.fixedTestOtp.code);
