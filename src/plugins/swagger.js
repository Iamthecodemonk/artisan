// Minimal swagger/docs placeholder. If you install @fastify/swagger, replace this.
export default async function swaggerPlugin(fastify, opts) {
  fastify.get('/documentation', async (request, reply) => {
    return {
      info: {
        title: 'Artisan API',
        version: '0.0.1',
      },
      routes: fastify.printRoutes ? fastify.printRoutes() : 'routes info not available',
    };
  });
}
