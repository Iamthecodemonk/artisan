// scripts/checkUser.js
// Usage: node scripts/checkUser.js user@example.com
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Admin from '../src/models/Admin.js';

const argvEmail = process.argv[2];
if (!argvEmail) {
  console.error('Usage: node scripts/checkUser.js <email>');
  process.exit(1);
}

const MONGO = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/artisan';

async function run() {
  try {
    await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to', MONGO);

    const email = argvEmail;
    const user = await User.findOne({ email }).lean();
    const admin = await Admin.findOne({ email }).lean();

    console.log('Query for email:', email);
    if (user) console.log('Found User:', { id: user._id, email: user.email, phone: user.phone, role: user.role });
    else console.log('No User found');

    if (admin) console.log('Found Admin:', { id: admin._id, email: admin.email });
    else console.log('No Admin found');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(2);
  }
}

run();
