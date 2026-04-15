import connectDB from '../config/db.js';
import mongoose from 'mongoose';
import User from '../models/User.js';
import DeviceToken from '../models/DeviceToken.js';
import RegistrationOtp from '../models/RegistrationOtp.js';

export async function deleteOldGuests({ olderThanHours = 24, batchSize = 500, dryRun = false, log = console.log } = {}) {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI must be set in env');
  }

  // ensure DB connected
  if (mongoose.connection.readyState === 0) {
    await connectDB();
  }

  const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000);
  log(`guestCleaner: cutoff=${cutoff.toISOString()} (olderThanHours=${olderThanHours})`);

  const query = { role: 'guest', createdAt: { $lt: cutoff } };

  // count first
  const total = await User.countDocuments(query);
  if (total === 0) {
    log('guestCleaner: no guest accounts to remove');
    return { removed: 0 };
  }

  let removed = 0;
  // process in batches to avoid locking large deletes
  while (true) {
    const guests = await User.find(query).limit(batchSize).lean();
    if (!guests || guests.length === 0) break;

    const ids = guests.map(g => g._id);
    const emails = guests.map(g => g.email).filter(Boolean);

    log(`guestCleaner: found ${guests.length} guests to remove (sample id=${ids[0]})`);
    if (dryRun) {
      removed += guests.length;
      log('guestCleaner: dryRun enabled; skipping deletion');
      // continue to count all batches
      continue;
    }

    try {
      // remove device tokens that reference these users
      await DeviceToken.deleteMany({ userId: { $in: ids } });
      // remove any registration OTPs for their emails
      if (emails.length) await RegistrationOtp.deleteMany({ email: { $in: emails } });
      // finally remove the users
      const r = await User.deleteMany({ _id: { $in: ids } });
      removed += (r?.deletedCount || guests.length);
      log(`guestCleaner: deleted ${r?.deletedCount || guests.length} users`);
    } catch (e) {
      log('guestCleaner: error deleting batch', e?.message || e);
      // break on error to avoid loops
      break;
    }

    // if fewer than batchSize returned, we're done
    if (guests.length < batchSize) break;
  }

  log(`guestCleaner: finished; removed=${removed}`);
  return { removed };
}

export default deleteOldGuests;
