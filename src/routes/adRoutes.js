import {
  createAd,
  listAds,
  getAd,
  updateAd,
  deleteAd,
  getMarquee,
  upsertMarquee,
  listBanner,
  createBanner,
  listCarousel,
  createCarousel
} from '../controllers/adController.js';
import { verifyJWT } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';

export default async function adRoutes(fastify, opts) {
  // Specific endpoints first (avoid clashing with :id param)
  fastify.get('/marquee', getMarquee);
  fastify.post('/marquee', { preHandler: [verifyJWT, requireRole('admin')] }, upsertMarquee);

  fastify.get('/banner', listBanner);
  fastify.post('/banner', { preHandler: [verifyJWT, requireRole('admin')] }, createBanner);

  fastify.get('/carousel', listCarousel);
  fastify.post('/carousel', { preHandler: [verifyJWT, requireRole('admin')] }, createCarousel);

  // Generic ads
  fastify.get('/', listAds);
  fastify.post('/', { preHandler: [verifyJWT, requireRole('admin')] }, createAd);
  fastify.get('/:id', getAd);
  fastify.put('/:id', { preHandler: [verifyJWT, requireRole('admin')] }, updateAd);
  fastify.delete('/:id', { preHandler: [verifyJWT, requireRole('admin')] }, deleteAd);
}
