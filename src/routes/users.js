import { getAllUsers, getUserById, getMyProfile, createUser, deleteProfileImage, updateMyProfile, deleteUserById, deleteMyAccount, getFullCustomerProfile } from '../controllers/userController.js';
import upload from '../middlewares/upload.js';
import { verifyJWT } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';

export default function usersRoutes(fastify, opts) {
  const idParams = {
    params: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } },
    },
  };

  const createUserSchema = {
    body: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
      },
    },
  };

  // explicit endpoints for the authenticated user's profile
  fastify.get('/me', { preHandler: verifyJWT }, getMyProfile);

  fastify.get('/profile', { preHandler: verifyJWT }, getMyProfile);

  // Delete authenticated user's account and all related data
  fastify.delete('/me', { preHandler: verifyJWT }, deleteMyAccount);

  // Update authenticated user's profile (accepts JSON or multipart/form-data with `profileImage` file)
  fastify.put('/me', { preHandler: [verifyJWT, upload] }, updateMyProfile);

  fastify.get('/', getAllUsers);
  // place profile-image route before `/:id` to avoid path conflicts
  fastify.delete('/profile-image', { preHandler: verifyJWT }, deleteProfileImage);
  // Full aggregated profile (admin or owner)
  fastify.get('/:id/full', { preHandler: verifyJWT, schema: idParams }, getFullCustomerProfile);
  fastify.get('/:id', { schema: idParams }, getUserById);
  // Admin-only: delete any user (and related data)
  fastify.delete('/:id', { preHandler: [verifyJWT, requireRole('admin')] }, deleteUserById);
  fastify.post('/', { schema: createUserSchema }, createUser);
}
