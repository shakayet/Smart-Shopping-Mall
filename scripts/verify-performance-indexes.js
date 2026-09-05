const mongoose = require('mongoose');
const dns = require('node:dns');
const config = require('../dist/config').default;
const { Product } = require('../dist/app/modules/product/product.model');
const { Order } = require('../dist/app/modules/order/order.model');
const { Wishlist } = require('../dist/app/modules/wishlist/wishlist.model');

const expectedIndexes = {
  products: [
    JSON.stringify({ status: 1, createdAt: -1 }),
    JSON.stringify({ seller: 1, createdAt: -1 }),
  ],
  orders: [
    JSON.stringify({ buyer: 1, createdAt: -1 }),
    JSON.stringify({ seller: 1, createdAt: -1 }),
    JSON.stringify({ status: 1, createdAt: -1 }),
  ],
  wishlists: [JSON.stringify({ user: 1, createdAt: -1 })],
};

const verifyIndexes = async () => {
  if (config.dns_servers?.length) {
    dns.setServers(config.dns_servers);
  }
  await mongoose.connect(config.database_url, { serverSelectionTimeoutMS: 10_000 });
  const models = {
    products: Product,
    orders: Order,
    wishlists: Wishlist,
  };

  for (const [collectionName, model] of Object.entries(models)) {
    const actual = (await model.collection.indexes()).map(index =>
      JSON.stringify(index.key),
    );
    const missing = expectedIndexes[collectionName].filter(
      expected => !actual.includes(expected),
    );
    if (missing.length > 0) {
      throw new Error(
        `${collectionName} is missing indexes: ${missing.join(', ')}`,
      );
    }
    process.stdout.write(`${collectionName}: performance indexes ready\n`);
  }
};

verifyIndexes()
  .then(() => mongoose.disconnect())
  .catch(async error => {
    process.stderr.write(`${error.message}\n`);
    await mongoose.disconnect().catch(() => undefined);
    process.exitCode = 1;
  });
