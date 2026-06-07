import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Jimp } from 'jimp';
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
  folder: string = 'products'
): Promise<string> => {
  let fileBuffer: Buffer | fs.ReadStream = fs.createReadStream(file.path);
  let fileName = `${Date.now()}-${file.originalname}`;
  let contentType = file.mimetype;

  // Image Processing if required
  if (file.mimetype.startsWith('image/')) {
    const image = await Jimp.read(file.path);
    // Example processing: resize to a max width of 1024px while maintaining aspect ratio
    if (image.width > 1024) {
      image.resize({ w: 1024 });
    }
    // Convert back to buffer
    const processedBuffer = await image.getBuffer(file.mimetype as any);
    fileBuffer = processedBuffer;
  }

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: config.aws.bucketName as string,
      Key: `${folder}/${fileName}`,
      Body: fileBuffer,
      ContentType: contentType,
    },
  });

  await upload.done();

  // Return CloudFront URL if available, otherwise S3 URL
  if (config.aws.cloudfrontDomain) {
    return `${config.aws.cloudfrontDomain}/${folder}/${fileName}`;
  }
  
  return `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com/${folder}/${fileName}`;
};
