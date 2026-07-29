const assert = require('node:assert/strict');
const test = require('node:test');
const { jwtHelper } = require('../dist/helpers/jwtHelper');
const generateOTP = require('../dist/util/generateOTP').default;
const cryptoToken = require('../dist/util/cryptoToken').default;

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

test('login OTP is always a six-digit integer', () => {
  for (let index = 0; index < 100; index += 1) {
    const otp = generateOTP();
    assert.equal(Number.isInteger(otp), true);
    assert.equal(otp >= 100000 && otp <= 999999, true);
  }
});

test('security tokens have sufficient entropy and are unique', () => {
  const tokens = new Set(Array.from({ length: 100 }, () => cryptoToken()));
  assert.equal(tokens.size, 100);
  for (const token of tokens) assert.equal(token.length >= 32, true);
});
