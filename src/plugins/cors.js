import fastifyCors from '@fastify/cors';

export default async function corsPlugin(fastify, opts) {
  await fastify.register(fastifyCors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    ...opts
  });
}
