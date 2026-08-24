const dns = require('node:dns');
const mongoose = require('mongoose');
const config = require('../dist/config').default;
const { Product } = require('../dist/app/modules/product/product.model');
const { Wishlist } = require('../dist/app/modules/wishlist/wishlist.model');

const main = async () => {
  if (config.dns_servers?.length) dns.setServers(config.dns_servers);
  await mongoose.connect(config.database_url, { serverSelectionTimeoutMS: 10_000 });

  const counts = await Wishlist.aggregate([
    { $group: { _id: '$product', wishlistCount: { $sum: 1 } } },
  ]);
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await Product.updateMany({}, { $set: { wishlistCount: 0 } }, { session });
      if (counts.length > 0) {
        await Product.bulkWrite(
          counts.map(({ _id, wishlistCount }) => ({
            updateOne: {
              filter: { _id },
              update: { $set: { wishlistCount } },
            },
          })),
          { session },
        );
      }
    });
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }

  console.log(
    JSON.stringify({
      passed: true,
      productsWithWishlistEntries: counts.length,
      totalWishlistEntries: counts.reduce(
        (total, entry) => total + entry.wishlistCount,
        0,
      ),
    }),
  );
};

main().catch(async error => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
