import { verifyJWT } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';
import { createSupportThread, postSupportMessage, listSupportThreadsForUser, listAllSupportThreads, getSupportThread } from '../controllers/supportController.js';

export default async function supportRoutes(fastify, opts) {
  // Create a support thread (user)
  fastify.post('/', { preHandler: verifyJWT }, createSupportThread);

  // Post a message to support thread (user or admin)
  fastify.post('/:threadId/messages', { preHandler: verifyJWT }, postSupportMessage);

  // Get single support thread by id (user or admin)
  
    fastify.get('/:threadId', {
      preHandler: [verifyJWT],
      schema: {
        params: {
          type: 'object',
          properties: {
            threadId: { type: 'string' }
          },
          required: ['threadId']
        }
      }
    }, getSupportThread);

  // List user's support threads
  fastify.get('/mine', { preHandler: verifyJWT }, listSupportThreadsForUser);

  // Admin: list all support threads
  fastify.get('/', { preHandler: [verifyJWT, requireRole('admin')] }, listAllSupportThreads);
}
