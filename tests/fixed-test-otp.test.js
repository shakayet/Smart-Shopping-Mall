const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  getFixedTestOtp,
  isFixedTestOtpEmail,
  isValidFixedTestOtp,
} = require('../dist/helpers/fixedTestOtp.js');

const fixedEmail = 'mdbayazid131.dev@gmail.com';

test('fixed OTP applies only to the configured development email', () => {
  assert.equal(isFixedTestOtpEmail(fixedEmail), true);
  assert.equal(isFixedTestOtpEmail(`  ${fixedEmail.toUpperCase()}  `), true);
  assert.equal(getFixedTestOtp(fixedEmail), 123456);
  assert.equal(isValidFixedTestOtp(fixedEmail, 123456), true);
  assert.equal(isValidFixedTestOtp(fixedEmail, '123456'), true);

  assert.equal(isFixedTestOtpEmail('another-user@example.com'), false);
  assert.equal(getFixedTestOtp('another-user@example.com'), null);
  assert.equal(isValidFixedTestOtp('another-user@example.com', 123456), false);
  assert.equal(isValidFixedTestOtp(fixedEmail, 654321), false);
});

test('production configuration rejects the fixed OTP exception', () => {
  const result = spawnSync(
    process.execPath,
    ['-e', "require('./dist/config')"],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        TEST_FIXED_OTP_EMAIL: fixedEmail,
        TEST_FIXED_OTP_CODE: '123456',
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /Fixed test OTP credentials cannot be enabled in production/,
  );
});
