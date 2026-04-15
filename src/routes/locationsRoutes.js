export default async function locationsRoutes(fastify, opts) {
  fastify.get('/nigeria/states', async (request, reply) => {
    const { default: locations } = await import('../data/nigeriaLocations.js');
    return reply.send({ success: true, data: locations.states });
  });

  fastify.get('/nigeria/lgas', async (request, reply) => {
    const { default: locations } = await import('../data/nigeriaLocations.js');
    const state = request.query.state;
    if (!state) return reply.code(400).send({ success: false, message: 'state query param required' });
    const lgas = locations.lgas[state] || [];
    return reply.send({ success: true, data: lgas });
  });
}
