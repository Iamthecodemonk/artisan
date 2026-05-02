import User from '../models/User.js';
import Artisan from '../models/Artisan.js';
import Kyc from '../models/Kyc.js';

export function requireActiveArtisan() {
  return async function (request, reply) {
    try {
      const tokenUser = request.user;
      const userId = tokenUser?.id || tokenUser?._id;
      if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });

      const [user, artisan, latestKyc] = await Promise.all([
        User.findById(userId).select('role kycVerified isVerified kycLevel banned').lean(),
        Artisan.findOne({ userId }).select('verified').lean(),
        Kyc.findOne({ userId }).sort({ createdAt: -1 }).select('status provider verificationType failureReason').lean(),
      ]);

      if (!user) return reply.code(401).send({ success: false, message: 'User not found' });
      if (user.banned) return reply.code(403).send({ success: false, message: 'Account is banned' });
      if (user.role !== 'artisan') return reply.code(403).send({ success: false, message: 'Not an artisan' });

      const isApproved = !!(user.kycVerified || user.isVerified || artisan?.verified || latestKyc?.status === 'approved');
      if (!isApproved) {
        const kycStatus = latestKyc?.status || 'not_submitted';
        const message = kycStatus === 'pending_review'
          ? 'ID verification requires manual review'
          : kycStatus === 'pending'
            ? 'ID verification is still in progress'
            : kycStatus === 'rejected'
              ? 'ID verification was rejected'
              : 'ID verification is required';

        return reply.code(403).send({
          success: false,
          message,
          code: 'ARTISAN_VERIFICATION_REQUIRED',
          data: {
            kycStatus,
            provider: latestKyc?.provider || null,
            verificationType: latestKyc?.verificationType || null,
            failureReason: latestKyc?.failureReason || null,
          },
        });
      }

      return;
    } catch (err) {
      request.log?.error?.(err);
      return reply.code(500).send({ success: false, message: 'Artisan check failed' });
    }
  };
}
