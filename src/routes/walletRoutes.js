import { getWallet, creditWallet, debitWallet, setPayoutDetails, getPayoutDetails } from '../controllers/walletController.js';
import { verifyJWT } from '../middlewares/auth.js';

export default async function walletRoutes(fastify, opts) {
  const amountSchema = {
    body: {
      type: 'object',
      required: ['amount'],
      properties: { amount: { type: 'number', minimum: 0.01 }, currency: { type: 'string' } },
    },
  };

  fastify.get('/', { preHandler: verifyJWT }, getWallet);
  fastify.post('/credit', { preHandler: verifyJWT, schema: amountSchema }, creditWallet);
  fastify.post('/debit', { preHandler: verifyJWT, schema: amountSchema }, debitWallet);
    fastify.post('/payout-details', { preHandler: verifyJWT }, setPayoutDetails);
    fastify.get('/payout-details', { preHandler: verifyJWT }, getPayoutDetails);
}
