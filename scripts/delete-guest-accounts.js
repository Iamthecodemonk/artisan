#!/usr/bin/env node

/**
 * scripts/delete-guest-accounts.js
 *
 * Usage: set MONGO_URI in env (or .env) then run:
 *   node scripts/delete-guest-accounts.js
 *
 * Options (env vars):
 *   HOURS=24         number of hours after which guest accounts are removed
 *   BATCH=500        number of accounts to delete per batch
 *   DRY_RUN=true     don't actually delete (counts only)
 */

import 'dotenv/config';
import { deleteOldGuests } from '../src/utils/guestCleaner.js';

const hours = parseInt(process.env.HOURS || '24', 10) || 24;
const batch = parseInt(process.env.BATCH || '500', 10) || 500;
const dryRun = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

(async () => {
  try {
    console.log(`delete-guest-accounts: starting (hours=${hours}, batch=${batch}, dryRun=${dryRun})`);
    const res = await deleteOldGuests({ olderThanHours: hours, batchSize: batch, dryRun, log: console.log });
    console.log('delete-guest-accounts: result', res);
    process.exit(0);
  } catch (err) {
    console.error('delete-guest-accounts: failed', err?.message || err);
    process.exit(2);
  }
})();
