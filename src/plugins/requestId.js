export default async function requestIdPlugin(fastify, opts) {
  // Lightweight request id plugin: uses incoming x-request-id if present,
  // otherwise generates a short unique id and adds it to request and response headers.
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      const incoming = request.headers['x-request-id'] || request.headers['x_correlation_id'] || request.headers['x_correlationid'];
      const id = incoming || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      // Attach to request and response
      request.id = id;
      reply.header('X-Request-Id', id);
    } catch (err) {
      // If anything goes wrong, still continue without blocking the request
      // but ensure request.id exists
      request.id = request.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    }
  });
}
