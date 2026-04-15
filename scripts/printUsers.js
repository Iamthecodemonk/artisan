#!/usr/bin/env node
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

dotenv.config();

(async () => {
  try {
    if (!process.env.MONGO_URI) {
      console.error('MONGO_URI not set in .env or environment');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to Mongo (host):', mongoose.connection.host);
    console.log('Database name:', mongoose.connection.name);

    const users = await User.find().limit(50).lean();
    console.log(`Found ${users.length} users:`);
    console.log(JSON.stringify(users, null, 2));

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error connecting or querying users:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
