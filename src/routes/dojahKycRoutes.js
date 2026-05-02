import { verifyNinSelfie } from '../controllers/dojahKycController.js';
import { verifyJWT } from '../middlewares/auth.js';

export default async function dojahKycRoutes(fastify, opts) {
  // Accepts JSON base64 selfieImage or multipart with a selfie/selfieImage file field.
  fastify.post('/nin-selfie', { preHandler: verifyJWT, bodyLimit: 15 * 1024 * 1024 }, verifyNinSelfie);
}
