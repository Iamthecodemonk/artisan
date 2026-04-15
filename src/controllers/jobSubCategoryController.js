import JobSubCategory from '../models/JobSubCategory.js';
import JobCategory from '../models/JobCategory.js';

export async function createSubCategory(request, reply) {
  try {
    const { name, slug, description, categoryId, order, isActive } = request.body || {};
    if (!name) return reply.code(400).send({ success: false, message: 'name required' });
    if (!categoryId) return reply.code(400).send({ success: false, message: 'categoryId required' });

    // validate category exists
    const cat = await JobCategory.findById(categoryId);
    if (!cat) return reply.code(400).send({ success: false, message: 'Parent category not found' });

    const sub = await JobSubCategory.create({ name, slug, description, categoryId, order, isActive });
    return reply.code(201).send({ success: true, data: sub });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function listSubCategories(request, reply) {
  try {
    const { categoryId, active } = request.query || {};
    const q = {};
    if (categoryId) q.categoryId = categoryId;
    if (active !== undefined) q.isActive = String(active) === 'true';
    const subs = await JobSubCategory.find(q).sort({ order: 1, name: 1 }).lean();
    return reply.send({ success: true, data: subs });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list subcategories' });
  }
}

export async function getSubCategory(request, reply) {
  try {
    const sub = await JobSubCategory.findById(request.params.id).populate('categoryId', 'name slug').lean();
    if (!sub) return reply.code(404).send({ success: false, message: 'Not found' });
    return reply.send({ success: true, data: sub });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to get subcategory' });
  }
}

export async function updateSubCategory(request, reply) {
  try {
    const sub = await JobSubCategory.findById(request.params.id);
    if (!sub) return reply.code(404).send({ success: false, message: 'Not found' });

    const { name, slug, description, categoryId, order, isActive } = request.body || {};
    if (categoryId !== undefined && categoryId !== null) {
      const cat = await JobCategory.findById(categoryId);
      if (!cat) return reply.code(400).send({ success: false, message: 'Parent category not found' });
      sub.categoryId = categoryId;
    }
    if (name !== undefined) sub.name = name;
    if (slug !== undefined) sub.slug = slug;
    if (description !== undefined) sub.description = description;
    if (order !== undefined) sub.order = order;
    if (isActive !== undefined) sub.isActive = isActive;

    await sub.save();
    return reply.send({ success: true, data: sub });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to update subcategory' });
  }
}

export async function deleteSubCategory(request, reply) {
  try {
    const sub = await JobSubCategory.findById(request.params.id);
    if (!sub) return reply.code(404).send({ success: false, message: 'Not found' });
    await sub.deleteOne();
    return reply.send({ success: true, message: 'Subcategory removed' });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to delete subcategory' });
  }
}

export default {
  createSubCategory,
  listSubCategories,
  getSubCategory,
  updateSubCategory,
  deleteSubCategory,
};
