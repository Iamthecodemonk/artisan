export function requireRole(role) {
  return async function (request, reply) {
    try {
      const user = request.user;
      if (!user) return reply.code(401).send({ success: false, message: 'Authentication required' });
      if (!user.role) return reply.code(403).send({ success: false, message: 'Role not assigned' });
      if (Array.isArray(role)) {
        if (!role.includes(user.role)) return reply.code(403).send({ success: false, message: 'Forbidden' });
      } else {
        if (user.role !== role) return reply.code(403).send({ success: false, message: 'Forbidden' });
      }
      return;
    } catch (err) {
      request.log?.error?.(err);
      return reply.code(500).send({ success: false, message: 'Role check failed' });
    }
  };
}
