#!/usr/bin/env node
// Migration: convert ArtisanService.artisanId (Artisan._id) -> User._id
// Usage: node migrate-artisanservice-to-userid.js --dry-run

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO = process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/artisan';

import ArtisanService from '../src/models/ArtisanService.js';
import Artisan from '../src/models/Artisan.js';

async function main() {
  await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to', MONGO);

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const cursor = ArtisanService.find().cursor();
  let updated = 0, skipped = 0, total = 0;
  for await (const doc of cursor) {
    total++;
    const current = String(doc.artisanId);
    // If artisanId already appears to be a user id (we'll test by finding an Artisan with this _id)
    const artisanDoc = await Artisan.findById(current).lean();
    if (!artisanDoc) {
      // Maybe it's already a User._id; nothing to do
      skipped++;
      continue;
    }
    const userId = String(artisanDoc.userId);
    if (!userId) {
      console.warn('No userId for artisan', artisanDoc._id);
      skipped++;
      continue;
    }
    if (userId === current) { skipped++; continue; }
    console.log(`${dryRun ? '[DRY] ' : ''}Update ArtisanService ${doc._id}: ${current} -> ${userId}`);
    if (!dryRun) {
      await ArtisanService.updateOne({ _id: doc._id }, { $set: { artisanId: userId } });
    }
    updated++;
  }

  console.log('Done. total=%d updated=%d skipped=%d', total, updated, skipped);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
