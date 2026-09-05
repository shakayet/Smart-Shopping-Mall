const assert = require('node:assert/strict');
const test = require('node:test');
const { Jimp, JimpMime } = require('jimp');

const {
  optimizeImageBuffer,
} = require('../dist/helpers/imageOptimizer.js');

test('large listing images are resized and JPEG-compressed for delivery', async () => {
  const source = new Jimp({ width: 1_200, height: 600, color: 0x336699ff });
  const sourceBuffer = await source.getBuffer(JimpMime.png);

  const optimized = await optimizeImageBuffer(
    sourceBuffer,
    JimpMime.png,
    400,
    80,
  );
  const decoded = await Jimp.read(optimized.buffer);

  assert.equal(optimized.mimetype, JimpMime.jpeg);
  assert.equal(decoded.bitmap.width, 400);
  assert.equal(decoded.bitmap.height, 200);
  assert.ok(optimized.buffer.length < sourceBuffer.length);
});
