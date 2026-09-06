import unlinkFile from '../shared/unlinkFile';
import { deleteFromS3, getS3KeyFromUrl } from './s3Helper';

const LOCAL_PROFILE_IMAGE_PATTERN =
  /^\/image\/[a-zA-Z0-9-]+\.(?:jpe?g|png)$/;
const PROFILE_IMAGE_S3_PREFIX = 'profile-images/';

export const isOwnedProfileImage = (url: unknown): url is string => {
  if (typeof url !== 'string' || !url) return false;
  if (LOCAL_PROFILE_IMAGE_PATTERN.test(url)) return true;
  return getS3KeyFromUrl(url)?.startsWith(PROFILE_IMAGE_S3_PREFIX) ?? false;
};

export const removeStoredProfileImage = async (
  url: unknown,
): Promise<void> => {
  if (!isOwnedProfileImage(url)) return;
  if (url.startsWith('/image/')) {
    unlinkFile(url);
    return;
  }
  await deleteFromS3(url);
};
