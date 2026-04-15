import DeviceToken from '../models/DeviceToken.js';
import DeviceTokenAudit from '../models/DeviceTokenAudit.js';

// Simple in-memory rate limiter per user for device registration.
// Format: { [userId]: { windowStart: timestampSeconds, count: number } }
const _rateMap = new Map();
const RATE_LIMIT_COUNT = parseInt(process.env.DEVICE_REG_LIMIT_COUNT || '10', 10);
const RATE_LIMIT_WINDOW = parseInt(process.env.DEVICE_REG_WINDOW_SECONDS || '60', 10);

export async function registerDeviceToken(request, reply) {
  try {
    const userId = request.user?.id;
    const { token, platform } = request.body || {};
    if (!userId || !token) return reply.code(400).send({ success: false, message: 'userId and token required' });

    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
      return reply.code(400).send({ success: false, message: 'Invalid token' });
    }

    // Rate limit registrations per user
    try {
      const uid = String(userId);
      const now = Math.floor(Date.now() / 1000);
      const state = _rateMap.get(uid) || { windowStart: now, count: 0 };
      if (now - state.windowStart >= RATE_LIMIT_WINDOW) {
        state.windowStart = now;
        state.count = 0;
      }
      state.count = (state.count || 0) + 1;
      _rateMap.set(uid, state);
      if (state.count > RATE_LIMIT_COUNT) {
        return reply.code(429).send({ success: false, message: 'Too many device registration requests, try later' });
      }
    } catch (e) {
      request.log?.warn?.('device token rate limiter error', e?.message || e);
    }

    // If token exists and belongs to another user, reassign and log the event
    try {
      const existing = await DeviceToken.findOne({ token });
      if (existing && existing.userId && String(existing.userId) !== String(userId)) {
        request.log?.info?.({ token, oldUser: existing.userId, newUser: userId }, 'reassigning device token to new user');
        try {
          await DeviceTokenAudit.create({ token, oldUserId: existing.userId, newUserId: userId, reason: 'reassign' });
        } catch (auditErr) {
          request.log?.warn?.('failed to write device token audit', auditErr?.message || auditErr);
        }
      }
    } catch (e) {
      request.log?.warn?.('device token lookup failed', e?.message || e);
    }

    await DeviceToken.updateOne({ token }, { $set: { userId, platform, updatedAt: new Date() } }, { upsert: true });
    return reply.send({ success: true });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to register device token' });
  }
}

export async function unregisterDeviceToken(request, reply) {
  try {
    const { token } = request.body || {};
    const userId = request.user?.id;
    if (!token) return reply.code(400).send({ success: false, message: 'token required' });

    // Only allow the owner to unregister their token
    const existing = await DeviceToken.findOne({ token });
    if (!existing) return reply.send({ success: true });
    if (!userId || (existing.userId && String(existing.userId) !== String(userId))) {
      return reply.code(403).send({ success: false, message: 'Not authorized to remove this token' });
    }
    await DeviceToken.deleteOne({ token });
    return reply.send({ success: true });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to unregister device token' });
  }
}

export async function listDeviceTokens(request, reply) {
  try {
    const userId = request.user?.id;
    if (!userId) return reply.code(400).send({ success: false, message: 'userId required' });

    const tokens = await DeviceToken.find({ userId }).select('token platform createdAt updatedAt -_id').lean();
    return reply.send({ success: true, tokens });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list device tokens' });
  }
}

export default { registerDeviceToken, unregisterDeviceToken, listDeviceTokens };
