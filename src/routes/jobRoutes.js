import {
  createJob,
  listJobs,
  getJob,
  updateJob,
  applyJob,
  listApplications,
  acceptApplication,
  deleteJob,
  updateApplication,
  withdrawApplication,
  uploadJobAttachment,
  deleteJobAttachment,
} from '../controllers/jobController.js';
import { createJobQuote, listJobQuotes } from '../controllers/quoteController.js';
import { verifyJWT } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';

export default async function jobRoutes(fastify, opts) {
  const idParams = { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } } };

  const createSchema = {
    body: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        categoryId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
        description: { type: 'string' },
        trade: { type: 'array', items: { type: 'string' } },
        location: { type: 'string' },
        coordinates: { type: 'array', items: { type: 'number' } },
        budget: { type: 'number' },
        schedule: { type: 'string' },
        experienceLevel: { type: 'string', enum: ['entry','mid','senior'] },
      },
    },
  };

  const updateSchema = {
    params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } },
    body: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        categoryId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
        description: { type: 'string' },
        trade: { type: 'array', items: { type: 'string' } },
        location: { type: 'string' },
        coordinates: { type: ['array', 'object'] },
        budget: { type: 'number' },
        schedule: { type: 'string' },
        experienceLevel: { type: 'string', enum: ['entry','mid','senior'] },
      },
      additionalProperties: false,
    },
  };

  const applySchema = {
    body: {
      type: 'object',
      properties: {
        coverNote: { type: 'string' },
        proposedPrice: { type: 'number' },
      },
    },
  };

  const createJobQuoteSchema = {
    params: idParams.params,
    body: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              cost: { type: 'number' },
              qty: { type: 'integer', minimum: 1 },
            },
            additionalProperties: false,
          },
        },
        serviceCharge: { type: 'number' },
        notes: { type: 'string' },
      },
      additionalProperties: false,
    },
  };

  fastify.post('/', { preHandler: [verifyJWT, requireRole(['client','customer'])], schema: createSchema }, createJob);
  // Authenticated user's jobs (any status)
  fastify.get('/mine', { preHandler: [verifyJWT] }, async (request, reply) => {
    // mark query param so controller will filter by clientId
    request.query = { ...(request.query || {}), mine: 'true' };
    return listJobs(request, reply);
  });
  fastify.get('/',{ preHandler: [verifyJWT] }, listJobs);
  fastify.get('/:id', { schema: idParams }, getJob);
  fastify.post('/:id/apply', { preHandler: [verifyJWT, requireRole('artisan')] }, applyJob);
  fastify.put('/:id', { preHandler: [verifyJWT, requireRole(['client','customer'])], schema: updateSchema }, updateJob);
  // partial update (PATCH) -- owner only, same controller handles allowed fields
  fastify.patch('/:id', { preHandler: [verifyJWT, requireRole(['client','customer'])], schema: updateSchema }, updateJob);
  fastify.get('/:id/applications', { preHandler: [verifyJWT, requireRole(['client','customer'])] }, listApplications);
  fastify.post('/:id/applications/:appId/accept', { preHandler: [verifyJWT, requireRole(['client','customer'])] }, acceptApplication);
  fastify.delete('/:id', { preHandler: [verifyJWT, requireRole(['client','customer'])] }, deleteJob);
  fastify.patch('/:id/applications/:appId', { preHandler: [verifyJWT, requireRole('artisan')] }, updateApplication);
  fastify.post('/:id/applications/:appId/withdraw', { preHandler: [verifyJWT, requireRole('artisan')] }, withdrawApplication);
  fastify.post('/:id/attachments', { preHandler: [verifyJWT, requireRole(['client','customer']), (request, reply) => import('../middlewares/cloudinaryStream.js').then(m => m.default(request, reply))] }, uploadJobAttachment);
  fastify.delete('/:id/attachments', { preHandler: verifyJWT }, deleteJobAttachment);
  // Job-level quotes
  fastify.post('/:id/quotes', { preHandler: [verifyJWT, requireRole('artisan')], schema: createJobQuoteSchema }, createJobQuote);
  fastify.get('/:id/quotes', { preHandler: [verifyJWT] }, listJobQuotes);
  fastify.post('/:id/quotes/:quoteId/accept', { preHandler: [verifyJWT, requireRole(['client','customer'])] }, async (request, reply) => {
    const { acceptJobQuote } = await import('../controllers/quoteController.js');
    return acceptJobQuote(request, reply);
  });
}
