import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

// Import models (adjust if you have different filenames)
import User from '../src/models/User.js';
import Admin from '../src/models/Admin.js';
import Artisan from '../src/models/Artisan.js';
import Booking from '../src/models/Booking.js';
import Chat from '../src/models/Chat.js';
import Customer from '../src/models/Customer.js';
import Kyc from '../src/models/Kyc.js';
import Review from '../src/models/Review.js';
import Transaction from '../src/models/Transaction.js';
import Wallet from '../src/models/Wallet.js';

const MODELS = [
  User,
  Admin,
  Artisan,
  Booking,
  Chat,
  Customer,
  Kyc,
  Review,
  Transaction,
  Wallet,
];

async function ensureModel(Model, { syncIndexes = false } = {}) {
  const name = Model.modelName;
  try {
    console.log(`Ensuring collection for ${name} -> ${Model.collection.name}`);
    // createCollection is safe if collection exists
    await Model.createCollection();
    // init builds indexes defined on the schema (doesn't drop others)
    await Model.init();
    if (syncIndexes) {
      console.log(`Syncing indexes for ${name} (this may drop DB indexes not in schema)`);
      await Model.syncIndexes();
    }
    return { name, ok: true };
  } catch (err) {
    return { name, ok: false, error: err?.message || String(err) };
  }
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI not set in .env — please set it and try again.');
    process.exit(1);
  }

  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(uri);
    console.log('Connected');
  } catch (err) {
    console.error('Failed connecting to MongoDB:', err?.message || err);
    process.exit(2);
  }

  const results = await Promise.allSettled(MODELS.map((m) => ensureModel(m, { syncIndexes: false })));

  results.forEach((r, idx) => {
    const model = MODELS[idx].modelName;
    if (r.status === 'fulfilled') {
      const res = r.value;
      if (res.ok) console.log(`OK: ${model}`);
      else console.warn(`WARN: ${model} -> ${res.error}`);
    } else {
      console.error(`ERR: ${model} -> ${r.reason}`);
    }
  });

  await mongoose.disconnect();
  console.log('Disconnected, done.');
}

main().catch((err) => {
  console.error('Fatal error', err);
  process.exit(99);
});
