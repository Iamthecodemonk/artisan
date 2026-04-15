import DeviceTokenAudit from '../models/DeviceTokenAudit.js';
import DeviceToken from '../models/DeviceToken.js';

const SWEEP_INTERVAL_MS = parseInt(process.env.DEVICE_SWEEP_INTERVAL_MS || String(1000 * 60 * 5), 10); // default 5 minutes
const REASSIGN_THRESHOLD = parseInt(process.env.DEVICE_REASSIGN_THRESHOLD || '3', 10);
const REASSIGN_WINDOW_SECONDS = parseInt(process.env.DEVICE_REASSIGN_WINDOW_SECONDS || String(60 * 60 * 24), 10); // 24 hours
const AUTO_REMOVE_SUSPICIOUS = (process.env.DEVICE_AUTO_REMOVE_SUSPICIOUS || 'false') === 'true';

let _timer = null;

async function sweep(server) {
  try {
    const since = new Date(Date.now() - REASSIGN_WINDOW_SECONDS * 1000);
    // aggregate audits per token
    const results = await DeviceTokenAudit.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$token', count: { $sum: 1 }, last: { $max: '$createdAt' } } },
      { $match: { count: { $gte: REASSIGN_THRESHOLD } } }
    ]).exec();

    for (const r of results) {
      server.log?.warn?.({ token: r._id, reassignCount: r.count, last: r.last }, 'suspicious device token reassignment detected');
      if (AUTO_REMOVE_SUSPICIOUS) {
        try {
          await DeviceToken.deleteOne({ token: r._id });
          server.log?.info?.({ token: r._id }, 'removed suspicious device token');
        } catch (delErr) {
          server.log?.warn?.('failed to remove suspicious device token', delErr?.message || delErr);
        }
      }
    }
  } catch (err) {
    server.log?.error?.('device token sweeper error', err?.message || err);
  }
}

export function startDeviceTokenSweeper(server) {
  if (_timer) return;
  _timer = setInterval(() => sweep(server), SWEEP_INTERVAL_MS);
  // run immediately once
  sweep(server);
}

export function stopDeviceTokenSweeper() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}
