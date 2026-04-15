import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';

export default fp(async function jwtPlugin(fastify, opts) {
  const secret = process.env.JWT_SECRET || 'changeme';
  await fastify.register(fastifyJwt, { secret });

  // convenience decorator for routes
  fastify.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ message: 'Unauthorized' });
    }
  });
});
