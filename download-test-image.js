
const https = require('https');
const fs = require('fs');
const path = require('path');

const imageUrl = 'https://picsum.photos/200/200';
const imagePath = path.join(__dirname, 'test-product-image.png');

console.log('Downloading test image...');
https.get(imageUrl, (res) => {
  const fileStream = fs.createWriteStream(imagePath);
  res.pipe(fileStream);
  fileStream.on('finish', () => {
    fileStream.close();
    console.log('Test image downloaded!');
    // Also create a simple test PDF
    fs.writeFileSync(
      path.join(__dirname, 'test-proof-of-purchase.pdf'),
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n115\n%%EOF'
    );
    console.log('Test files ready!');
  });
}).on('error', (err) => {
  console.error('Error downloading image:', err);
});
