import { createReview, listReviews, getReview } from '../controllers/reviewController.js';
import { verifyJWT } from '../middlewares/auth.js';

export default async function reviewRoutes(fastify, opts) {
  const idParams = { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } } };

  const listQuery = { querystring: { type: 'object', properties: { artisanId: { type: 'string' }, page: { type: 'integer' }, limit: { type: 'integer' } } } };

  const createReviewSchema = {
    body: {
      type: 'object',
      required: ['targetId', 'rating'],
      properties: { targetId: { type: 'string' }, rating: { type: 'number', minimum: 1, maximum: 5 }, comment: { type: 'string' } },
    },
  };

  fastify.get('/', { schema: listQuery }, listReviews);
  fastify.post('/', { preHandler: verifyJWT, schema: createReviewSchema }, createReview);
  fastify.get('/:id', { schema: idParams }, getReview);
}
