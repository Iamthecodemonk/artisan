import { listTransactions, getTransaction, getTransactionSummary } from '../controllers/transactionController.js';
import { verifyJWT } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';

export default async function transactionRoutes(fastify, opts) {
  const idParams = {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
    },
    required: ['id'],
  };

  const listQuery = {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1 },
      status: { type: 'string' },
      bookingId: { type: 'string' },
      startDate: { type: 'string' },
      endDate: { type: 'string' }
    },
  };

  // List transactions (role-aware: admin sees all, artisan sees earnings, user sees payments)
  fastify.get('/', { preHandler: verifyJWT, schema: { querystring: listQuery } }, listTransactions);
  
  // Admin summary of transaction amounts by status
  fastify.get('/admin/summary', { preHandler: [verifyJWT, requireRole('admin')] }, getTransactionSummary);
  
  // Get single transaction (role-aware access control)
  fastify.get('/:id', { preHandler: verifyJWT, schema: { params: idParams } }, getTransaction);
}
