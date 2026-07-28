import crypto from 'crypto';

const generateOTP = (): number => {
  const min = 100000;
  const max = 999999;
  const range = max - min;
  if (range > 0xffffffff) {
    const buf = crypto.randomBytes(6);
    const value =
      (buf.readUIntBE(0, 2) * 0x100000000 + buf.readUIntBE(2, 4)) >>> 0;
    return Math.floor((value / 0x100000000) * (range + 1)) + min;
  }
  const modulus = range + 1;
  const limit = Math.floor(0x100000000 / modulus) * modulus;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const buf = crypto.randomBytes(4);
    const value = buf.readUInt32BE(0) >>> 0;
    if (value < limit) return (value % modulus) + min;
  }
};

export default generateOTP;
