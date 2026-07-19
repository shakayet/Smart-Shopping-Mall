
const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

async function createTestImage() {
  // Create a 200x200 red image
  const image = await Jimp.create(200, 200, 0xFF0000FF);
  await image.writeAsync(path.join(__dirname, 'test-product-image.png'));

  // Create a simple test PDF (just a text file renamed for test)
  fs.writeFileSync(
    path.join(__dirname, 'test-proof-of-purchase.pdf'),
    '%PDF-1.4\n%...\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n115\n%%EOF'
  );
  console.log('Test files created!');
}

createTestImage();
