import { createSubCategory, listSubCategories, getSubCategory, updateSubCategory, deleteSubCategory } from '../controllers/jobSubCategoryController.js';
import { verifyJWT } from '../middlewares/auth.js';
import { requireRole } from '../middlewares/roles.js';

export default async function jobSubCategoryRoutes(fastify, opts) {
  const idParams = { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } } };

  // public: list and get
  fastify.get('/', listSubCategories);
  fastify.get('/:id', { schema: idParams }, getSubCategory);

  // admin-only: create, update, delete
  fastify.post('/', { preHandler: [verifyJWT, requireRole('admin')] }, createSubCategory);
  fastify.put('/:id', { preHandler: [verifyJWT, requireRole('admin')], schema: idParams }, updateSubCategory);
  fastify.delete('/:id', { preHandler: [verifyJWT, requireRole('admin')], schema: idParams }, deleteSubCategory);
}
