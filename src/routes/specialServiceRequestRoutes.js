import { createSpecialServiceRequest, listSpecialServiceRequests, getSpecialServiceRequest, updateSpecialServiceRequest, respondToSpecialServiceRequest, payForSpecialService } from '../controllers/specialServiceRequestController.js';
import { verifyJWT } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';

const idParamSchema = { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } } };

const createSchema = {
  body: {
    type: 'object',
    required: ['artisanId', 'description'],
    properties: {
      artisanId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
      description: { type: 'string' },
      title: { type: 'string' },
      location: { type: 'string' },
      date: { type: 'string', format: 'date-time' },
      time: { type: 'string' },
      urgency: { type: 'string', enum: ['Normal', 'High', 'Low'] },
      budget: { type: ['number', 'string'] },
      categoryId: { type: 'string' },
      categoryName: { type: 'string' }
    }
  }
};

const listSchema = {
  querystring: {
    type: 'object',
    properties: {
      artisanId: { type: 'string' },
      clientId: { type: 'string' },
      status: { type: 'string' },
      page: { type: 'integer' },
      limit: { type: 'integer' }
    }
  }
};

const updateSchema = {
  body: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pending','responded','accepted','in_progress','completed','cancelled','rejected','declined'] },
      note: {
        anyOf: [
          { type: 'string' },
          { type: 'object',
            properties: {
              quote: { type: ['number','string'] },
              min: { type: ['number','string'] },
              max: { type: ['number','string'] },
              minQuote: { type: ['number','string'] },
              maxQuote: { type: ['number','string'] },
              message: { type: 'string' }
            },
            additionalProperties: true
          }
        ]
      },
      selectedPrice: { type: ['number','string'] },
      title: { type: 'string' },
      description: { type: 'string' },
      location: { type: 'string' },
      date: { type: 'string', format: 'date-time' },
      time: { type: 'string' },
      urgency: { type: 'string', enum: ['Normal','High','Low'] },
      budget: { type: ['number','string'] },
      attachments: { type: 'array', items: { type: 'object' } }
    }
  }
};

const responseBodySchema = {
  body: {
    type: 'object',
    properties: {
      note: updateSchema.body.properties.note,
      urgency: { type: 'string', enum: ['Normal','High','Low'] }
    }
  }
};

export default async function specialServiceRequestRoutes(fastify, opts) {
  // Create: supports JSON or multipart/form-data (attachments)
  // For multipart/form-data requests we must NOT attach a body JSON schema —
  // Fastify will validate before the multipart parser runs and return "body must be object".
  fastify.post('/', { preHandler: [verifyJWT, requireRole(['client','customer']), (request, reply) => import('../middlewares/cloudinaryStream.js').then(m => m.default(request, reply))] }, createSpecialServiceRequest);

  // List: allow filtering by artisanId/clientId/status
  fastify.get('/', { preHandler: verifyJWT, schema: listSchema }, listSpecialServiceRequests);

  // Get single
  fastify.get('/:id', { preHandler: verifyJWT, schema: idParamSchema }, getSpecialServiceRequest);

  // Support client/artisan clients that request the response resource via GET /:id/response
  fastify.get('/:id/response', { preHandler: verifyJWT, schema: idParamSchema }, getSpecialServiceRequest);

  // Update (respond / accept / generic updates)
  fastify.put('/:id', { preHandler: verifyJWT, schema: { ...idParamSchema, ...updateSchema } }, updateSpecialServiceRequest);

  // Artisan-specific response route: keeps client code that calls `/response` working
  fastify.put('/:id/response', { preHandler: [verifyJWT, requireRole(['artisan'])], schema: { ...idParamSchema, ...responseBodySchema } }, updateSpecialServiceRequest);

  // POST response: create or update artisan response (idempotent)
  fastify.post('/:id/response', { preHandler: [verifyJWT, requireRole(['artisan'])], schema: { ...idParamSchema, ...responseBodySchema } }, (request, reply) => import('../controllers/specialServiceRequestController.js').then(m => m.respondToSpecialServiceRequest(request, reply)));

  // Initialize payment for a special service booking (if booking created but payment not initialized)
  fastify.post('/:id/pay', { preHandler: verifyJWT, schema: { ...idParamSchema, body: { type: 'object', properties: { email: { type: 'string', format: 'email' } } } } }, (request, reply) => import('../controllers/specialServiceRequestController.js').then(m => m.payForSpecialService(request, reply)));
}
