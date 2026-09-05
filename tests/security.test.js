const assert = require('node:assert/strict');
const test = require('node:test');
const { jwtHelper } = require('../dist/helpers/jwtHelper');
const generateOTP = require('../dist/util/generateOTP').default;
const cryptoToken = require('../dist/util/cryptoToken').default;
const { toMinorUnits } = require('../dist/util/money');
const {
  AuthValidation,
} = require('../dist/app/modules/auth/auth.validation');
const { emailTemplate } = require('../dist/shared/emailTemplate');

test('JWT helper signs and verifies the intended claims', () => {
  const secret = 'test-secret-that-is-longer-than-32-characters';
  const token = jwtHelper.createToken(
    { id: 'user-1', role: 'USER' },
    secret,
    '5m',
  );
  const payload = jwtHelper.verifyToken(token, secret);
  assert.equal(payload.id, 'user-1');
  assert.equal(payload.role, 'USER');
});

test('email OTP is always a five-digit integer', () => {
  for (let index = 0; index < 100; index += 1) {
    const otp = generateOTP();
    assert.equal(Number.isInteger(otp), true);
    assert.equal(otp >= 10000 && otp <= 99999, true);
  }
});

test('email OTP validation accepts exactly five digits', () => {
  for (const oneTimeCode of [12345, '12345']) {
    const result = AuthValidation.createVerifyLoginOtpZodSchema.safeParse({
      body: { email: 'user@example.com', oneTimeCode },
    });
    assert.equal(result.success, true);
  }

  for (const oneTimeCode of [1234, 123456, '1234', '123456', '12a45']) {
    const result = AuthValidation.createVerifyLoginOtpZodSchema.safeParse({
      body: { email: 'user@example.com', oneTimeCode },
    });
    assert.equal(result.success, false, String(oneTimeCode));
  }

  assert.equal(
    AuthValidation.createVerifyEmailZodSchema.safeParse({
      body: { email: 'user@example.com', oneTimeCode: 12345 },
    }).success,
    true,
  );
  assert.equal(
    AuthValidation.createVerifyEmailZodSchema.safeParse({
      body: { email: 'user@example.com', oneTimeCode: 123456 },
    }).success,
    false,
  );
});

test('OTP email subjects are unique without exposing the code', () => {
  const values = {
    name: 'Test User',
    email: 'user@example.com',
    otp: 12345,
  };
  const first = emailTemplate.loginOtp(values);
  const second = emailTemplate.loginOtp(values);

  assert.notEqual(first.subject, second.subject);
  assert.match(first.subject, /sign-in code · [0-9A-F]{8}$/);
  assert.equal(first.subject.includes(String(values.otp)), false);
  assert.match(first.text, /sign-in code is 12345/);
  assert.match(first.text, /expires in 5 minutes/);
});

test('security tokens have sufficient entropy and are unique', () => {
  const tokens = new Set(Array.from({ length: 100 }, () => cryptoToken()));
  assert.equal(tokens.size, 100);
  for (const token of tokens) assert.equal(token.length >= 32, true);
});

test('Stripe amounts are converted to integer minor units', () => {
  assert.equal(toMinorUnits(10.99), 1099);
  assert.equal(toMinorUnits(0.1 + 0.2), 30);
});
