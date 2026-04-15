import JobCategory from '../models/JobCategory.js';

export async function createCategory(request, reply) {
  try {
    const { name, slug, description, parentId, icon, order } = request.body || {};
    if (!name) return reply.code(400).send({ success: false, message: 'Name required' });
    
    // Validate parentId if provided
    if (parentId) {
      const parent = await JobCategory.findById(parentId);
      if (!parent) return reply.code(400).send({ success: false, message: 'Parent category not found' });
    }
    
    const cat = await JobCategory.create({ name, slug, description, parentId, icon, order });
    return reply.code(201).send({ success: true, data: cat });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function listCategories(request, reply) {
  try {
    const { parentId, includeSubcategories = 'false' } = request.query || {};
    
    // Filter by parentId: null for top-level, specific ID for children of that parent
    const query = parentId === 'null' || parentId === undefined 
      ? { parentId: null } 
      : parentId 
        ? { parentId } 
        : {};
    
    let cats = await JobCategory.find(query)
      .sort({ order: 1, name: 1 })
      .lean();
    
    // Optionally populate subcategories for hierarchical view
    if (includeSubcategories === 'true') {
      for (const cat of cats) {
        cat.subcategories = await JobCategory.find({ parentId: cat._id })
          .sort({ order: 1, name: 1 })
          .lean();
      }
    }
    
    return reply.send({ success: true, data: cats });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list categories' });
  }
}

export async function getCategory(request, reply) {
  try {
    const cat = await JobCategory.findById(request.params.id)
      .populate('parentId', 'name slug')
      .lean();
      
    if (!cat) return reply.code(404).send({ success: false, message: 'Not found' });
    
    // Get subcategories
    cat.subcategories = await JobCategory.find({ parentId: cat._id })
      .sort({ order: 1, name: 1 })
      .lean();
    
    return reply.send({ success: true, data: cat });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to get category' });
  }
}

export async function updateCategory(request, reply) {
  try {
    const cat = await JobCategory.findById(request.params.id);
    if (!cat) return reply.code(404).send({ success: false, message: 'Not found' });
    
    const { name, slug, description, parentId, icon, order, isActive } = request.body || {};
    
    // Prevent category from being its own parent
    if (parentId && String(parentId) === String(cat._id)) {
      return reply.code(400).send({ success: false, message: 'Category cannot be its own parent' });
    }
    
    // Validate new parent exists
    if (parentId !== undefined && parentId !== null) {
      const parent = await JobCategory.findById(parentId);
      if (!parent) return reply.code(400).send({ success: false, message: 'Parent category not found' });
    }
    
    if (name !== undefined) cat.name = name;
    if (slug !== undefined) cat.slug = slug;
    if (description !== undefined) cat.description = description;
    if (parentId !== undefined) cat.parentId = parentId;
    if (icon !== undefined) cat.icon = icon;
    if (order !== undefined) cat.order = order;
    if (isActive !== undefined) cat.isActive = isActive;
    
    await cat.save();
    return reply.send({ success: true, data: cat });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to update category' });
  }
}

export async function deleteCategory(request, reply) {
  try {
    const cat = await JobCategory.findById(request.params.id);
    if (!cat) return reply.code(404).send({ success: false, message: 'Not found' });
    
    // Check if category has subcategories
    const hasChildren = await JobCategory.countDocuments({ parentId: cat._id });
    if (hasChildren > 0) {
      return reply.code(400).send({ 
        success: false, 
        message: 'Cannot delete category with subcategories. Delete subcategories first.' 
      });
    }
    
    await cat.deleteOne();
    return reply.send({ success: true, message: 'Category removed' });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to delete category' });
  }
}
