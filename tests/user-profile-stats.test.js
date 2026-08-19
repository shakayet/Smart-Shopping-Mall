const assert = require('node:assert/strict');
const test = require('node:test');
const {
  UserValidation,
} = require('../dist/app/modules/user/user.validation');

test('public profile statistics accept a valid target user ID', () => {
  const result = UserValidation.profileStatsParamsZodSchema.safeParse({
    params: { userId: '507f1f77bcf86cd799439011' },
  });

  assert.equal(result.success, true);
});

test('public profile statistics reject malformed target user IDs', () => {
  const malformed = UserValidation.profileStatsParamsZodSchema.safeParse({
    params: { userId: '../another-user' },
  });
  const tooShort = UserValidation.profileStatsParamsZodSchema.safeParse({
    params: { userId: '507f1f77bcf86cd7994390' },
  });

  assert.equal(malformed.success, false);
  assert.equal(tooShort.success, false);
});
