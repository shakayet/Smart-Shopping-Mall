const dns = require('node:dns');
const path = require('node:path');
const mongoose = require('mongoose');
const config = require('../dist/config').default;
const { Product } = require('../dist/app/modules/product/product.model');
const {
  optimizeImageBuffer,
} = require('../dist/helpers/imageOptimizer');
const {
  deleteFromS3,
  uploadToS3,
} = require('../dist/helpers/s3Helper');

const OPTIMIZED_PREFIX = '/product-images/optimized/';
const applyChanges = process.argv.includes('--apply');

const optimizeRemoteImage = async imageUrl => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Unable to download ${imageUrl}: HTTP ${response.status}`);
  }

  const source = Buffer.from(await response.arrayBuffer());
  const sourceMime = response.headers.get('content-type')?.split(';')[0]
    || 'image/jpeg';
  const optimized = await optimizeImageBuffer(source, sourceMime, 1_600, 82);
  const sourceName = path.parse(
    path.posix.basename(new URL(imageUrl).pathname),
  ).name;

  return {
    sourceBytes: source.length,
    optimized,
    uploadFile: {
      fieldname: 'image',
      originalname: `${sourceName}${optimized.extension}`,
      encoding: '7bit',
      mimetype: optimized.mimetype,
      size: optimized.buffer.length,
      destination: '',
      filename: '',
      path: '',
      buffer: optimized.buffer,
    },
  };
};

const migrateProduct = async product => {
  const originalImages = product.images?.length
    ? product.images
    : product.image
      ? [product.image]
      : [];
  if (
    originalImages.length === 0
    || originalImages.every(url => url.includes(OPTIMIZED_PREFIX))
  ) {
    return { skipped: true, sourceBytes: 0, optimizedBytes: 0 };
  }

  const replacementImages = [];
  const uploadedUrls = [];
  let sourceBytes = 0;
  let optimizedBytes = 0;

  try {
    for (const imageUrl of originalImages) {
      if (imageUrl.includes(OPTIMIZED_PREFIX)) {
        replacementImages.push(imageUrl);
        continue;
      }

      const processed = await optimizeRemoteImage(imageUrl);
      sourceBytes += processed.sourceBytes;
      optimizedBytes += processed.optimized.buffer.length;
      if (applyChanges) {
        const uploadedUrl = await uploadToS3(
          processed.uploadFile,
          'product-images/optimized',
        );
        uploadedUrls.push(uploadedUrl);
        replacementImages.push(uploadedUrl);
      }
    }

    if (applyChanges) {
      const update = await Product.updateOne(
        { _id: product._id, images: product.images },
        { $set: { images: replacementImages }, $unset: { image: 1 } },
      );
      if (update.matchedCount !== 1) {
        throw new Error(
          `Product ${product._id} changed while its images were processing`,
        );
      }
    }
  } catch (error) {
    await Promise.all(
      uploadedUrls.map(url => deleteFromS3(url).catch(() => undefined)),
    );
    throw error;
  }

  return { skipped: false, sourceBytes, optimizedBytes };
};

const main = async () => {
  if (config.dns_servers?.length) {
    dns.setServers(config.dns_servers);
  }
  await mongoose.connect(config.database_url, { serverSelectionTimeoutMS: 10_000 });
  const products = await Product.find()
    .select('_id images image')
    .lean();

  let migrated = 0;
  let skipped = 0;
  let sourceBytes = 0;
  let optimizedBytes = 0;
  for (const product of products) {
    const result = await migrateProduct(product);
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    migrated += 1;
    sourceBytes += result.sourceBytes;
    optimizedBytes += result.optimizedBytes;
    process.stdout.write(
      `${applyChanges ? 'migrated' : 'checked'} product ${product._id}\n`,
    );
  }

  const savedPercentage = sourceBytes > 0
    ? Math.round((1 - optimizedBytes / sourceBytes) * 100)
    : 0;
  process.stdout.write(
    `${applyChanges ? 'Migration' : 'Dry run'} complete: ${migrated} processed, ${skipped} skipped, ${savedPercentage}% fewer image bytes\n`,
  );
};

main()
  .then(() => mongoose.disconnect())
  .catch(async error => {
    process.stderr.write(`${error.message}\n`);
    await mongoose.disconnect().catch(() => undefined);
    process.exitCode = 1;
  });
