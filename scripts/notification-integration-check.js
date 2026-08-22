const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dns = require('node:dns');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: '.env', override: true });

if (process.env.DNS_SERVERS) {
  dns.setServers(
    process.env.DNS_SERVERS.split(',')
      .map(value => value.trim())
      .filter(Boolean),
  );
}

const apiOrigin = `http://${process.env.IP_ADDRESS}:${process.env.PORT}`;
const runId = crypto.randomUUID();
const buyerId = new mongoose.Types.ObjectId();
const sellerId = new mongoose.Types.ObjectId();
const productId = new mongoose.Types.ObjectId();
const registrationToken = `integration-token-${runId}`;
let socket;
let database;

const api = async (method, path, accessToken, body) => {
  const response = await fetch(`${apiOrigin}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}`);
  }
  return payload;
};

const connectSocket = accessToken => {
  let eventResolver;
  const notificationEvent = new Promise(resolve => {
    eventResolver = resolve;
  });
  const connected = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Socket authentication timed out')),
      10_000,
    );
    socket = new WebSocket(
      `${apiOrigin.replace('http', 'ws')}/socket.io/?EIO=4&transport=websocket`,
    );
    socket.addEventListener('message', message => {
      const packet = String(message.data);
      if (packet.startsWith('0')) {
        socket.send(`40${JSON.stringify({ token: accessToken })}`);
      } else if (packet === '2') {
        socket.send('3');
      } else if (packet.startsWith('40')) {
        clearTimeout(timeout);
        resolve();
      } else if (packet.startsWith('42')) {
        const [event, payload] = JSON.parse(packet.slice(2));
        if (event === 'notification:new') eventResolver(payload);
      }
    });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Socket connection failed'));
    });
  });
  return { connected, notificationEvent };
};

const cleanup = async () => {
  if (socket) socket.close();
  if (!database) return;
  await Promise.all([
    database.collection('notifications').deleteMany({ recipient: buyerId }),
    database.collection('deviceregistrations').deleteMany({
      registrationToken,
    }),
    database.collection('wishlists').deleteMany({
      user: buyerId,
      product: productId,
    }),
    database.collection('products').deleteOne({ _id: productId }),
    database.collection('users').deleteMany({
      _id: { $in: [buyerId, sellerId] },
    }),
  ]);
};

const main = async () => {
  await mongoose.connect(process.env.DATABASE_URL);
  database = mongoose.connection.db;
  assert.ok(database, 'MongoDB connection is unavailable');
  const now = new Date();
  await database.collection('users').insertMany([
    {
      _id: buyerId,
      name: 'Notification Integration Buyer',
      role: 'USER',
      email: `notification-buyer-${runId}@example.com`,
      provider: 'local',
      status: 'active',
      verified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: sellerId,
      name: 'Notification Integration Seller',
      role: 'USER',
      email: `notification-seller-${runId}@example.com`,
      provider: 'local',
      status: 'active',
      verified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await database.collection('products').insertOne({
    _id: productId,
    name: 'Notification Integration Product',
    images: ['https://example.com/integration-product.jpg'],
    brand: 'Integration',
    description: 'Temporary notification integration test product',
    price: 1,
    condition: 'new',
    originalPackagingAvailable: true,
    proofOfPurchase: null,
    status: 'available',
    seller: sellerId,
    orderId: Date.now(),
    createdAt: now,
    updatedAt: now,
  });

  const accessToken = jwt.sign(
    { id: buyerId.toString(), role: 'USER' },
    process.env.JWT_SECRET,
    { expiresIn: '5m' },
  );
  const socketTest = connectSocket(accessToken);
  await socketTest.connected;

  const registered = await api(
    'POST',
    '/api/v1/notifications/devices',
    accessToken,
    {
      registrationToken,
      platform: 'android',
      deviceId: `integration-device-${runId}`,
    },
  );
  assert.equal(registered.data.registered, true);

  await api(
    'POST',
    `/api/v1/wishlist/${productId.toString()}`,
    accessToken,
  );
  const realtimeNotification = await Promise.race([
    socketTest.notificationEvent,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Real-time notification timed out')),
        10_000,
      ),
    ),
  ]);
  assert.equal(realtimeNotification.type, 'wishlist_item_saved');
  assert.equal(realtimeNotification.data.productId, productId.toString());
  assert.equal('recipient' in realtimeNotification, false);
  assert.equal('eventKey' in realtimeNotification, false);

  const list = await api(
    'GET',
    '/api/v1/notifications?page=1&limit=20',
    accessToken,
  );
  assert.equal(list.pagination.total, 1);
  assert.equal(list.data[0].id, realtimeNotification.id);

  const unreadBefore = await api(
    'GET',
    '/api/v1/notifications/unread-count',
    accessToken,
  );
  assert.equal(unreadBefore.data.unreadCount, 1);

  const markedRead = await api(
    'PATCH',
    `/api/v1/notifications/${realtimeNotification.id}/read`,
    accessToken,
  );
  assert.equal(markedRead.data.isRead, true);

  const unreadAfter = await api(
    'GET',
    '/api/v1/notifications/unread-count',
    accessToken,
  );
  assert.equal(unreadAfter.data.unreadCount, 0);

  await api(
    'DELETE',
    `/api/v1/notifications/${realtimeNotification.id}`,
    accessToken,
  );
  const emptyList = await api(
    'GET',
    '/api/v1/notifications?page=1&limit=20',
    accessToken,
  );
  assert.equal(emptyList.pagination.total, 0);

  await api(
    'DELETE',
    '/api/v1/notifications/devices',
    accessToken,
    { registrationToken },
  );

  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'authenticated socket connection',
        'device registration',
        'business-event notification creation',
        'real-time private delivery',
        'notification listing and pagination',
        'unread count',
        'mark as read',
        'delete notification',
        'device unregistration',
        'response redaction',
      ],
    }),
  );
};

main()
  .then(cleanup)
  .then(() => mongoose.disconnect())
  .catch(async error => {
    console.error(error.message);
    await cleanup().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
