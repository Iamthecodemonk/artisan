// import {  } from '../controllers/adminController.js';
import { adminListJobs,adminOverview, listUsers, updateUserRole, createAdmin, listAdmins, centralFeed, adminListBookings, adminListQuotes, adminListChats, adminGetChat, adminListWallets, adminGetWallet, listArtisans, banUser, unbanUser } from '../controllers/adminController.js';
import { listConfigs, getConfigByKey, upsertConfig } from '../controllers/configController.js';
import { listCompanyEarnings, summaryCompanyEarnings } from '../controllers/companyEarningController.js';
import { verifyJWT } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';

export default async function adminRoutes(fastify, opts) {
  // In a real app you'd check req.user.role === 'admin'
  const idParams = { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } } };

  const roleSchema = { body: { type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['user', 'artisan', 'admin'] } } } };

  fastify.get('/overview', { preHandler: verifyJWT }, adminOverview);
  // Central aggregated feed for dashboards (role-aware)
  fastify.get('/central', { preHandler: verifyJWT }, centralFeed);
  fastify.get('/users', { preHandler: verifyJWT }, listUsers);
  // Admin: list artisans with enriched profiles (admin only)
  fastify.get('/artisans', { preHandler: [verifyJWT, requireRole('admin')] }, listArtisans);
  // Ban / unban users (admin only)
  fastify.put('/users/:id/ban', { preHandler: [verifyJWT, requireRole('admin')], schema: idParams }, banUser);
  fastify.put('/users/:id/unban', { preHandler: [verifyJWT, requireRole('admin')], schema: idParams }, unbanUser);
  // Admin: list all admins (admin only)
  fastify.get('/admins', { preHandler: [verifyJWT, requireRole('admin')] }, listAdmins);
  // Admin: list all jobs with filters and aggregation
  fastify.get('/jobs', { preHandler: [verifyJWT, requireRole('admin')] }, adminListJobs);
  // Admin: list all bookings with filters
  fastify.get('/bookings', { preHandler: [verifyJWT, requireRole('admin')] }, adminListBookings);
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
