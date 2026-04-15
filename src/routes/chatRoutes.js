import { sendMessage, fetchThread, fetchThreadByBooking } from '../controllers/chatController.js';
import { verifyJWT } from '../middlewares/auth.js';

export default async function chatRoutes(fastify, opts) {
  const threadParams = { params: { type: 'object', required: ['threadId'], properties: { threadId: { type: 'string' } } } };
  const bookingParams = { params: { type: 'object', required: ['bookingId'], properties: { bookingId: { type: 'string' } } } };

  const messageSchema = {
    body: {
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string', minLength: 1 } },
    },
  };

  // fetch chat by bookingId (protected)
  fastify.get('/booking/:bookingId', { preHandler: verifyJWT, schema: bookingParams }, fetchThreadByBooking);

  // fetch by threadId and send message by threadId
  fastify.get('/:threadId', { preHandler: verifyJWT, schema: threadParams }, fetchThread);
  fastify.post('/:threadId', { preHandler: verifyJWT, schema: messageSchema }, sendMessage);
}
