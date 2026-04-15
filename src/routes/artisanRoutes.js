import {
  createArtisan,
  getArtisan,
  listArtisans,
  updateArtisan,
  verifyArtisan,
  unverifyArtisan,
} from '../controllers/artisanController.js';
import { verifyJWT, optionalJWT } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';
const { getArtisanByUser } = await import('../controllers/artisanController.js');

export default async function artisanRoutes(fastify, opts) {
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
      trade: { type: 'string' },
      sortBy: { type: 'string' },
      // search params
      lat: { type: 'number' },
      lon: { type: 'number' },
      radiusKm: { type: 'number' },
      location: { type: 'string' },
      q: { type: 'string' },
    },
  };

  const pricingSchema = {
    type: 'object',
    properties: {
      perHour: { type: 'number' },
      perJob: { type: 'number' },
    },
    additionalProperties: false,
  };

  const portfolioItem = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      images: { type: 'array', items: { type: 'string', format: 'uri' } },
      beforeAfter: { type: 'boolean' },
    },
  };

  const createBody = {
    type: 'object',
    properties: {
      userId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
      trade: { type: 'array', items: { type: 'string' }, minItems: 1 },
      experience: { type: 'number' },
      certifications: { type: 'array', items: { type: 'string' } },
      bio: { type: 'string' },
      portfolio: { type: 'array', items: portfolioItem },
      serviceArea: {
        type: 'object',
        properties: {
          address: { type: 'string' },
          coordinates: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          radius: { type: 'number' },
        },
      },
      pricing: pricingSchema,
      availability: { type: 'array', items: { type: 'string' } },
    },
    required: ['trade', 'experience'],
    additionalProperties: false,
  };

  const updateBody = {
    type: 'object',
    properties: {
      trade: { type: 'array', items: { type: 'string' }, minItems: 1 },
      experience: { type: 'number' },
      certifications: { type: 'array', items: { type: 'string' } },
      bio: { type: 'string' },
      portfolio: { type: 'array', items: portfolioItem },
      serviceArea: {
        type: 'object',
        properties: {
          address: { type: 'string' },
          coordinates: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          radius: { type: 'number' },
        },
      },
      pricing: pricingSchema,
      availability: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  };

  fastify.get('/', { preHandler: optionalJWT, schema: { querystring: listQuery } }, listArtisans);
  fastify.get('/search', { preHandler: optionalJWT, schema: { querystring: listQuery } }, async (request, reply) => {
    const { searchArtisans } = await import('../controllers/artisanController.js');
    return searchArtisans(request, reply);
  });
  // Get artisan by linked User._id
  fastify.get('/user/:id', { schema: { params: idParams } }, async (request, reply) => {
    return getArtisanByUser(request, reply);
  });
  fastify.put('/me', { preHandler: verifyJWT }, async (request, reply) => {
    const { updateMyArtisanProfile } = await import('../controllers/artisanController.js');
    return updateMyArtisanProfile(request, reply);
  });
  // Accepts both JSON (with pre-uploaded image URLs) and multipart/form-data (uploads to Cloudinary)
  fastify.post('/', { preHandler: verifyJWT }, createArtisan);
  fastify.get('/:id', { schema: { params: idParams } }, getArtisan);
  fastify.put('/:id', { preHandler: verifyJWT, schema: { params: idParams, body: updateBody } }, updateArtisan);
  // Admin-only: verify an artisan (updates both Artisan.verified and User.isVerified/kycVerified)
  fastify.patch('/:id/verify', { preHandler: [verifyJWT, requireRole('admin')], schema: { params: idParams } }, verifyArtisan);
  // Admin-only: unverify an artisan (revokes verification on both Artisan and User)
  fastify.patch('/:id/unverify', { preHandler: [verifyJWT, requireRole('admin')], schema: { params: idParams } }, unverifyArtisan);
}
