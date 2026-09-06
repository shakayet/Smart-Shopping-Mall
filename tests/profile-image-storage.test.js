const assert = require('node:assert/strict');
const test = require('node:test');

const config = require('../dist/config').default;
const {
  getS3KeyFromUrl,
  isManagedS3Url,
} = require('../dist/helpers/s3Helper.js');
const {
  isOwnedProfileImage,
} = require('../dist/helpers/profileImageStorage.js');
const {
  UserValidation,
} = require('../dist/app/modules/user/user.validation.js');

test('profile cleanup accepts only owned profile-image storage locations', () => {
  const cloudfront = config.aws.cloudfrontDomain.replace(/\/$/, '');
  const profileUrl = `${cloudfront}/profile-images/optimized/profile.jpg`;

  assert.equal(isManagedS3Url(profileUrl), true);
  assert.equal(
    getS3KeyFromUrl(profileUrl),
    'profile-images/optimized/profile.jpg',
  );
  assert.equal(isOwnedProfileImage(profileUrl), true);
  assert.equal(
    isOwnedProfileImage(`${cloudfront}/product-images/optimized/product.jpg`),
    false,
  );
  assert.equal(
    isOwnedProfileImage('/image/8af2732f-a342-46df-9344-6d0605fd3572.jpg'),
    true,
  );
  assert.equal(isOwnedProfileImage('/image/../../secret.jpg'), false);
  assert.equal(isOwnedProfileImage('https://example.com/avatar.jpg'), false);
});

test('profile JSON cannot assign an arbitrary image URL', () => {
  const parsed = UserValidation.updateUserZodSchema.parse({
    name: 'Updated name',
    image: 'https://example.com/not-owned.jpg',
    avatar: 'https://example.com/not-owned-avatar.jpg',
  });

  assert.deepEqual(parsed, { name: 'Updated name' });
});
