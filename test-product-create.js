
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const axios = require('axios');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const BASE_URL = 'http://10.10.26.189:5000/api/v1';

// Test user data
const testUser = {
  name: 'Test User',
  email: `test${Date.now()}@example.com`,
  password: 'Test@123456',
  contact: '+1234567890',
  location: 'Test City'
};

async function testCreateProduct() {
  let dbConnection;
  try {
    console.log('=== Step 1: Creating test user ===');
    const createUserRes = await axios.post(`${BASE_URL}/user`, testUser);
    console.log('Create user response:', createUserRes.data);

    if (!createUserRes.data.success) {
      console.error('Failed to create user');
      return;
    }

    // Connect to DB to verify user
    console.log('\n=== Step 1.5: Verifying test user ===');
    dbConnection = await mongoose.connect(process.env.DATABASE_URL);
    
    // Define User model
    const User = mongoose.model('User', new mongoose.Schema({
      email: String,
      verified: Boolean
    }));
    
    await User.updateOne(
      { email: testUser.email },
      { $set: { verified: true } }
    );
    
    console.log('✅ User verified successfully');
    await dbConnection.disconnect();

    console.log('\n=== Step 2: Logging in ===');
    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      email: testUser.email,
      password: testUser.password
    });
    console.log('Login response:', loginRes.data);

    if (!loginRes.data.success) {
      console.error('Failed to login');
      return;
    }

    const accessToken = loginRes.data.data.accessToken;
    console.log('\nGot access token:', accessToken.substring(0, 30) + '...');

    console.log('\n=== Step 3: Creating product with form data (JSON in data field) ===');
    
    // First test: send JSON in data field
    const formData1 = new FormData();
    formData1.append('data', JSON.stringify({
      name: 'Test Product from JSON',
      brand: 'Test Brand JSON',
      description: 'This is a test product description from JSON',
      price: 149.99,
      condition: 'Used'
    }));
    formData1.append('image', fs.createReadStream(path.join(__dirname, 'test-product-image.png')), {
      filename: 'test-product-image.png',
      contentType: 'image/png'
    });
    formData1.append('doc', fs.createReadStream(path.join(__dirname, 'test-proof-of-purchase.pdf')), {
      filename: 'test-proof-of-purchase.pdf',
      contentType: 'application/pdf'
    });

    const createProductRes1 = await axios.post(`${BASE_URL}/products`, formData1, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...formData1.getHeaders()
      }
    });
    console.log('Test 1 (JSON in data field) response:', createProductRes1.data);

    if (createProductRes1.data.success) {
      console.log('\n✅ Test 1 passed: Product created successfully!');
      console.log('Product data:', createProductRes1.data.data);
    } else {
      console.error('\n❌ Test 1 failed');
    }

    console.log('\n=== Step 4: Creating product with form data (individual fields) ===');
    
    // Second test: send individual fields
    const formData2 = new FormData();
    formData2.append('name', 'Test Product');
    formData2.append('brand', 'Test Brand');
    formData2.append('description', 'This is a test product description');
    formData2.append('price', '99.99');
    formData2.append('condition', 'New');
    formData2.append('image', fs.createReadStream(path.join(__dirname, 'test-product-image.png')), {
      filename: 'test-product-image.png',
      contentType: 'image/png'
    });
    formData2.append('doc', fs.createReadStream(path.join(__dirname, 'test-proof-of-purchase.pdf')), {
      filename: 'test-proof-of-purchase.pdf',
      contentType: 'application/pdf'
    });

    const createProductRes2 = await axios.post(`${BASE_URL}/products`, formData2, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...formData2.getHeaders()
      }
    });
    console.log('Test 2 (individual fields) response:', createProductRes2.data);

    if (createProductRes2.data.success) {
      console.log('\n✅ Test 2 passed: Product created successfully!');
      console.log('Product data:', createProductRes2.data.data);
    } else {
      console.error('\n❌ Test 2 failed');
    }

  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
  } finally {
    if (dbConnection) {
      await dbConnection.disconnect();
    }
  }
}

testCreateProduct();
