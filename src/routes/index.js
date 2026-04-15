import usersRoutes from './users.js';

export default async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    return { ok: true, message: 'Artisan API (Fastify)' };
  });

  // register resource-specific routes
  fastify.register(usersRoutes, { prefix: '/users' });
}
