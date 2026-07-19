/* eslint-disable no-undef */
/* eslint-disable no-console */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import config from '../config';

const s3Client = new S3Client({
  region: config.aws.region as string,
  credentials: {
    accessKeyId: config.aws.accessKeyId as string,
    secretAccessKey: config.aws.secretAccessKey as string,
  },
});

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
