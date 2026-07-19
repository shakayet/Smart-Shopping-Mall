/* eslint-disable no-undef */
/* eslint-disable no-console */
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'fs';
import config from '../config';

const s3Client = new S3Client({
  region: config.aws.region as string,
  credentials: {
    accessKeyId: config.aws.accessKeyId as string,
    secretAccessKey: config.aws.secretAccessKey as string,
  },
});

// Helper function to extract S3 key from URL
const extractS3KeyFromUrl = (url: string): string => {
  // Check if it's a CloudFront URL
  if (
    config.aws.cloudfrontDomain &&
    url.startsWith(config.aws.cloudfrontDomain)
  ) {
    return url.replace(config.aws.cloudfrontDomain + '/', '');
  }
  // Check if it's an S3 URL
  const s3UrlPattern = new RegExp(
    `^https?://${config.aws.bucketName}\\.s3[-.]${config.aws.region}\\.amazonaws\\.com/`,
  );
  if (s3UrlPattern.test(url)) {
    return url.replace(s3UrlPattern, '');
  }
  // If we can't parse it, just return the URL as is (though this shouldn't happen)
  return url;
};

export const uploadToS3 = async (
  file: Express.Multer.File,
  folder: string = 'products',
): Promise<string> => {
  const fileStream = fs.createReadStream(file.path);
  const fileName = `${folder}/${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;

  const uploadParams = {
    Bucket: config.aws.bucketName as string,
    Key: fileName,
    Body: fileStream,
    ContentType: file.mimetype,
  };

  const command = new PutObjectCommand(uploadParams);
  await s3Client.send(command);

  // Return CloudFront URL if available, else S3 URL
  if (config.aws.cloudfrontDomain) {
    return `${config.aws.cloudfrontDomain}/${fileName}`;
  }
  return `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com/${fileName}`;
};

export const deleteFromS3 = async (url: string): Promise<void> => {
  const key = extractS3KeyFromUrl(url);

  const deleteParams = {
    Bucket: config.aws.bucketName as string,
    Key: key,
  };

  const command = new DeleteObjectCommand(deleteParams);
  await s3Client.send(command);
};
