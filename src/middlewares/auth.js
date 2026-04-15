import jwt from 'jsonwebtoken';

export async function verifyJWT(request, reply) {
  try {
    // helpful debug: log the incoming authorization header when present
    request.log?.debug?.({ authHeader: request.headers?.authorization }, 'verifyJWT - incoming header');

    const auth = request.headers?.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ message: 'Unauthorized', error: 'Missing Bearer token' });
    }

    const token = auth.slice(7).trim();
    const secret = process.env.JWT_SECRET || 'changeme';

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (err) {
      request.log?.warn?.({ err: err?.message }, 'JWT verify failed');
      return reply.code(401).send({ message: 'Unauthorized', error: err?.message });
    }

    // attach decoded token to request for downstream handlers and role checks
    request.user = decoded;
    return;
  } catch (err) {
    request.log?.error?.(err, 'verifyJWT unexpected error');
    return reply.code(500).send({ message: 'Token verification failed' });
  }
}

export async function optionalJWT(request, reply) {
  try {
    const auth = request.headers?.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      // No token provided - allow request to continue without authentication
      request.user = null;
      return;
    }

    const token = auth.slice(7).trim();
    const secret = process.env.JWT_SECRET || 'changeme';

    try {
      const decoded = jwt.verify(token, secret);
      request.user = decoded;
    } catch (err) {
      // Invalid token - log warning but allow request to continue as unauthenticated
      request.log?.warn?.({ err: err?.message }, 'Optional JWT verify failed - continuing as guest');
      request.user = null;
    }
    
    return;
  } catch (err) {
    request.log?.error?.(err, 'optionalJWT unexpected error');
    request.user = null;
    return;
  }
}
