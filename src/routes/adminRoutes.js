import {
  adminGetChat,
  adminDeleteKycFile,
  adminDeleteUserProfileImage,
  adminGetWallet,
  adminListBookings,
  adminListChats,
  adminListJobs,
  adminListQuotes,
  adminListSpecialRequests,
  adminListWallets,
  adminOverview,
  banUser,
  centralFeed,
  createAdmin,
  listAdmins,
  listArtisans,
  listUsers,
  unbanUser,
  updateUserRole,
  upsertArtisanProfile,
} from '../controllers/adminController.js';
import { listConfigs, getConfigByKey, upsertConfig } from '../controllers/configController.js';
import { listCompanyEarnings, summaryCompanyEarnings } from '../controllers/companyEarningController.js';
import { verifyJWT } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';

export default async function adminRoutes(fastify, opts) {
  // In a real app you'd check req.user.role === 'admin'
  const idParams = { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } } };

  const roleSchema = { body: { type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['user', 'artisan', 'admin'] } } } };
  const specialRequestListSchema = {
    querystring: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        status: { type: 'string' },
        clientId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
        artisanId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
        q: { type: 'string' },
        includeBooking: { type: 'string', enum: ['true', 'false'] },
      },
    },
  };
  const userIdParams = { params: { type: 'object', required: ['userId'], properties: { userId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } } };
  const kycDeleteSchema = {
    ...userIdParams,
    querystring: {
      type: 'object',
      required: ['field'],
      properties: {
        field: { type: 'string', enum: ['IdUploadFront', 'IdUploadBack', 'profileImage'] },
      },
    },
  };

  fastify.get('/overview', { preHandler: [verifyJWT, requireRole('admin')] }, adminOverview);
  // Central aggregated feed for dashboards (role-aware)
  fastify.get('/central', { preHandler: verifyJWT }, centralFeed);
  fastify.get('/users', { preHandler: verifyJWT }, listUsers);
  // Admin: list artisans with enriched profiles (admin only)
  fastify.get('/artisans', { preHandler: [verifyJWT, requireRole('admin')] }, listArtisans);
  // Admin: create or update artisan profile for a user
  fastify.put('/artisans/:userId', { preHandler: [verifyJWT, requireRole('admin'), (request, reply) => import('../middlewares/cloudinaryStream.js').then(m => m.default(request, reply))], schema: userIdParams }, async (request, reply) => {
    return upsertArtisanProfile(request, reply);
  });
  // Admin: delete a user's profile image
  fastify.delete('/artisans/:userId/profile-image', { preHandler: [verifyJWT, requireRole('admin')], schema: userIdParams }, adminDeleteUserProfileImage);

  // Admin: upsert KYC and get KYC
  fastify.put('/kyc/:userId', { preHandler: [verifyJWT, requireRole('admin'), (request, reply) => import('../middlewares/cloudinaryStream.js').then(m => m.default(request, reply))], schema: userIdParams }, async (request, reply) => {
    const { upsertKyc } = await import('../controllers/adminController.js');
    return upsertKyc(request, reply);
  });

  fastify.get('/kyc/:userId', { preHandler: [verifyJWT, requireRole('admin')], schema: userIdParams }, async (request, reply) => {
    const { getKycByUser } = await import('../controllers/adminController.js');
    return getKycByUser(request, reply);
  });
  // Admin: delete a specific KYC image field by user
  fastify.delete('/kyc/:userId/file', { preHandler: [verifyJWT, requireRole('admin')], schema: kycDeleteSchema }, adminDeleteKycFile);
  // Ban / unban users (admin only)
  fastify.put('/users/:id/ban', { preHandler: [verifyJWT, requireRole('admin')], schema: idParams }, banUser);
  fastify.put('/users/:id/unban', { preHandler: [verifyJWT, requireRole('admin')], schema: idParams }, unbanUser);
  // Admin: list all admins (admin only)
  fastify.get('/admins', { preHandler: [verifyJWT, requireRole('admin')] }, listAdmins);
  // Admin: list all jobs with filters and aggregation
  fastify.get('/jobs', { preHandler: [verifyJWT, requireRole('admin')] }, adminListJobs);
  // Admin: list all bookings with filters
  fastify.get('/bookings', { preHandler: [verifyJWT, requireRole('admin')] }, adminListBookings);
  // Admin: list all special service requests with related user details
  fastify.get('/special-requests', { preHandler: [verifyJWT, requireRole('admin')], schema: specialRequestListSchema }, adminListSpecialRequests);
  // Admin: list all quotes with filters
  fastify.get('/quotes', { preHandler: [verifyJWT, requireRole('admin')] }, adminListQuotes);
  // Admin: list all chats with filters
  fastify.get('/chats', { preHandler: [verifyJWT, requireRole('admin')] }, adminListChats);
  // Admin: get specific chat by ID
  fastify.get('/chats/:id', { preHandler: [verifyJWT, requireRole('admin')], schema: idParams }, adminGetChat);
  // Admin: list all wallets with filters
  fastify.get('/wallets', { preHandler: [verifyJWT, requireRole('admin')] }, adminListWallets);
  // Admin: get specific wallet by user ID
  fastify.get('/wallets/:userId', { preHandler: [verifyJWT, requireRole('admin')], schema: { params: { type: 'object', required: ['userId'], properties: { userId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } } } }, adminGetWallet);
  fastify.put('/users/:id/role', { preHandler: verifyJWT, schema: { ...idParams, ...roleSchema } }, updateUserRole);

  // Company earnings (admin only): list and summary
  fastify.get('/company-earnings', { preHandler: [verifyJWT, requireRole('admin')] }, listCompanyEarnings);
  fastify.get('/company-earnings/summary', { preHandler: [verifyJWT, requireRole('admin')] }, summaryCompanyEarnings);

  // create admin (protected) - only existing admins can create other admins
  const createAdminSchema = {
    body: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
        permissions: { type: 'object' },
      },
    },
  };

  fastify.post('/create', { preHandler: [verifyJWT, requireRole('admin')], schema: createAdminSchema }, createAdmin);

  // Config management (admin only)
  fastify.get('/configs', { preHandler: [verifyJWT, requireRole('admin')] }, listConfigs);
  fastify.get('/configs/:key', { preHandler: [verifyJWT, requireRole('admin')] }, getConfigByKey);
  fastify.put('/configs/:key', { preHandler: [verifyJWT, requireRole('admin')] }, upsertConfig);
}
