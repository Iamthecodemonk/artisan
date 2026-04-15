export function requireActiveArtisan() {
  return async function (request, reply) {
    try {
      const user = request.user;
      if (!user) return reply.code(401).send({ success: false, message: 'Authentication required' });
      if (user.role !== 'artisan') return reply.code(403).send({ success: false, message: 'Not an artisan' });
      if (!user.kycVerified) return reply.code(403).send({ success: false, message: 'KYC not completed' });
      if (!user.artisanApproved) return reply.code(403).send({ success: false, message: 'Artisan account not approved by admin' });
      return;
    } catch (err) {
      request.log?.error?.(err);
      return reply.code(500).send({ success: false, message: 'Artisan check failed' });
    }
  };
}
