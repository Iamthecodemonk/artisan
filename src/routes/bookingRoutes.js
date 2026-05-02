import {
  createBooking,
  getBooking,
  listBookings,
  cancelBooking,
  artisanCancelBooking,
  getRefundStatus,
} from '../controllers/bookingController.js';
import { postRequirement, createQuote, listQuotes, listQuotesDetailed, acceptQuote, payWithQuote } from '../controllers/quoteController.js';
import { requireRole } from '../middlewares/roles.js';
import { verifyJWT } from '../middlewares/auth.js';
import { requireActiveArtisan } from '../middlewares/requireActiveArtisan.js';

export default async function bookingRoutes(fastify, opts) {
  const idParams = { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } } };

  const listQuery = {
    querystring: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        status: { type: 'string' },
      },
    },
  };

  const createSchema = {
    body: {
      type: 'object',
      required: ['artisanId', 'schedule'],
      properties: {
        artisanId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
        schedule: { type: 'string' },
        price: { type: 'number' },
        notes: { type: 'string' },
        services: {
          type: 'array',
          items: {
            type: 'object',
            required: ['subCategoryId'],
            properties: {
              subCategoryId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
              quantity: { type: 'integer', minimum: 1 }
            }
          }
        },
        categoryId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
        subCategoryId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
        artisanServiceId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
        paymentMode: { type: 'string', enum: ['upfront', 'afterCompletion'] }
      },
    },
  };
  
  const hireSchema = {
    body: {
      type: 'object',
      required: ['artisanId', 'schedule', 'email'],
      properties: {
        artisanId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
        schedule: { type: 'string' },
        price: { type: 'number' },
        notes: { type: 'string' },
        services: {
          type: 'array',
          items: {
            type: 'object',
            required: ['subCategoryId'],
            properties: {
              subCategoryId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
              quantity: { type: 'integer', minimum: 1 }
            }
          }
        },
        email: { type: 'string', format: 'email' },
        customerCoords: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } } },
        categoryId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
        subCategoryId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
        artisanServiceId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
        paymentMode: { type: 'string', enum: ['upfront', 'afterCompletion'] }
      },
    },
  };

  fastify.get('/', { preHandler: verifyJWT, schema: listQuery }, listBookings);
  // Get bookings for a specific customer with artisan details
  fastify.get('/customer/:customerId', { preHandler: verifyJWT, schema: {
    params: { type: 'object', required: ['customerId'], properties: { customerId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } },
    querystring: listQuery.querystring
  } }, async (request, reply) => {
    const { getCustomerBookings } = await import('../controllers/bookingController.js');
    return getCustomerBookings(request, reply);
  });
  // Get bookings for a specific artisan with customer details
  fastify.get('/artisan/:artisanId', { preHandler: verifyJWT, schema: {
    params: { type: 'object', required: ['artisanId'], properties: { artisanId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } },
    querystring: listQuery.querystring
  } }, async (request, reply) => {
    const { getArtisanBookings } = await import('../controllers/bookingController.js');
    return getArtisanBookings(request, reply);
  });
  fastify.post('/', { preHandler: verifyJWT, schema: createSchema }, createBooking);
  fastify.get('/:id', { preHandler: verifyJWT, schema: idParams }, getBooking);
  fastify.delete('/:id', { preHandler: verifyJWT, schema: idParams }, cancelBooking);
  fastify.post('/:id/artisan-cancel', { preHandler: [verifyJWT, requireActiveArtisan()], schema: {
    params: idParams.params,
    body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } }
  } }, artisanCancelBooking);
  fastify.get('/:id/refund', { preHandler: verifyJWT, schema: idParams }, getRefundStatus);
    // Static endpoints that must be declared before parameterized routes
    fastify.post('/hire', { preHandler: verifyJWT, schema: hireSchema }, async (request, reply) => {
      const { hireAndInitialize } = await import('../controllers/bookingController.js');
      return hireAndInitialize(request, reply);
    });
  fastify.post('/:id/pay-after-completion', { preHandler: verifyJWT, schema: { params: idParams.params, body: { type: 'object', properties: { email: { type: 'string', format: 'email' }, customerCoords: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } } } } } } }, async (request, reply) => {
      const { initiateDeferredPayment } = await import('../controllers/bookingController.js');
      return initiateDeferredPayment(request, reply);
    });
  fastify.post('/:id/complete', { preHandler: verifyJWT, schema: idParams }, async (request, reply) => {
    const { completeBooking } = await import('../controllers/bookingController.js');
    return completeBooking(request, reply);
  });
  fastify.post('/:id/accept', { preHandler: [verifyJWT, requireActiveArtisan()], schema: idParams }, async (request, reply) => {
    const { acceptBooking } = await import('../controllers/bookingController.js');
    return acceptBooking(request, reply);
  });
  fastify.post('/:id/reject', { preHandler: [verifyJWT, requireActiveArtisan()], schema: {
    params: idParams.params,
    body: { type: 'object', properties: { reason: { type: 'string' } } }
  } }, async (request, reply) => {
    const { rejectBooking } = await import('../controllers/bookingController.js');
    return rejectBooking(request, reply);
  });
  
  // Requirements and Quotes
  const requirementSchema = idParams;
  const createQuoteSchema = {
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
              qty: { type: 'integer', minimum: 1 },
              note: { type: 'string' },
              cost: { type: 'number', minimum: 0 }
            },
            required: ['name', 'cost']
          }
        },
        serviceCharge: { type: 'number', minimum: 0 },
        notes: { type: 'string' }
      },
      required: ['items']
    }
  };

  const payWithQuoteSchema = {
    params: idParams.params,
    body: { type: 'object', properties: { email: { type: 'string', format: 'email' } } }
  };

  fastify.post('/:id/requirements', { preHandler: [verifyJWT, requireRole(['client','customer'])], schema: requirementSchema }, postRequirement);
  fastify.post('/:id/quotes', { preHandler: [verifyJWT, requireActiveArtisan()], schema: createQuoteSchema }, createQuote);
  fastify.get('/:id/quotes', { preHandler: verifyJWT, schema: idParams }, listQuotes);
  // detailed view with artisan user/profile and booking details
  fastify.get('/:id/quotes/details', { preHandler: verifyJWT, schema: idParams }, listQuotesDetailed);
  fastify.post('/:id/quotes/:quoteId/accept', { preHandler: verifyJWT }, acceptQuote);
  fastify.post('/:id/pay-with-quote', { preHandler: verifyJWT, schema: payWithQuoteSchema }, payWithQuote);
  // webhook / admin endpoint to mark transaction as received and held in escrow
  fastify.post('/:id/confirm-payment', { preHandler: verifyJWT, schema: idParams }, async (request, reply) => {
    const { confirmPayment } = await import('../controllers/bookingController.js');
    return confirmPayment(request, reply);
  });
}
