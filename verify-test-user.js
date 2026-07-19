
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

async function verifyTestUser() {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(process.env.DATABASE_URL);
    console.log('Connected to database');

    // Get the test user we just created
    const User = mongoose.model('User', new mongoose.Schema({
      email: String,
      verified: Boolean,
      authentication: Object
    }));

    const testUserEmail = `test${Date.now().toString().slice(0, -3)}@example.com`;
    // Wait, let's just find the most recently created user
    const user = await User.findOne().sort({ createdAt: -1 });
    
    if (!user) {
      console.log('No user found');
      return;
    }

    console.log('Found user:', user.email);
    console.log('Current verified status:', user.verified);

    // Update the user to be verified
    await User.updateOne(
      { _id: user._id },
      { $set: { verified: true } }
    );

    console.log('✅ User verified successfully!');
    
    // Also, let's get the OTP just in case
    if (user.authentication?.oneTimeCode) {
      console.log('OTP:', user.authentication.oneTimeCode);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
  }
}

verifyTestUser();
