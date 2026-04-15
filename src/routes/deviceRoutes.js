import { registerDeviceToken, unregisterDeviceToken, listDeviceTokens } from '../controllers/deviceTokenController.js';
import { verifyJWT } from '../middlewares/auth.js';

export default async function deviceRoutes(fastify, opts) {
  fastify.post('/register', { preHandler: verifyJWT }, registerDeviceToken);
  fastify.post('/unregister', { preHandler: verifyJWT }, unregisterDeviceToken);
  fastify.get('/my', { preHandler: verifyJWT }, listDeviceTokens);
}
