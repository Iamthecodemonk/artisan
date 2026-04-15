import { createCategory, listCategories, getCategory, updateCategory, deleteCategory } from '../controllers/jobCategoryController.js';
import { verifyJWT } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';

export default async function jobCategoryRoutes(fastify, opts) {
  const idParams = { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } } };

  // public: list and get
  fastify.get('/', listCategories);
  fastify.get('/:id', { schema: idParams }, getCategory);

  // admin-only: create, update, delete
  fastify.post('/', { preHandler: [verifyJWT, requireRole('admin')] }, createCategory);
  fastify.put('/:id', { preHandler: [verifyJWT, requireRole('admin')], schema: idParams }, updateCategory);
  fastify.delete('/:id', { preHandler: [verifyJWT, requireRole('admin')], schema: idParams }, deleteCategory);
}
