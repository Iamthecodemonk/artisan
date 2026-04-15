import Artisan from '../models/Artisan.js';
import ArtisanService from '../models/ArtisanService.js';
import JobCategory from '../models/JobCategory.js';
import JobSubCategory from '../models/JobSubCategory.js';

export const createOrUpdateServices = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });

    const artisan = await Artisan.findOne({ userId });
    if (!artisan) return reply.code(404).send({ success: false, message: 'Artisan profile not found' });

    const { categoryId, services } = req.body || {};
    if (!categoryId || !Array.isArray(services) || services.length === 0) return reply.code(400).send({ success: false, message: 'categoryId and services required' });

    // Basic validation of subCategory existence
    const subIds = services.map(s => s.subCategoryId).filter(Boolean);
    const existingSubs = await JobSubCategory.find({ _id: { $in: subIds }, categoryId }).select('_id').lean();
    if (existingSubs.length !== subIds.length) return reply.code(400).send({ success: false, message: 'One or more subCategoryId values are invalid for the given categoryId' });

    // Store the artisanId as the underlying user id (artisan.userId)
    const userArtisanId = String(artisan.userId);
    const doc = await ArtisanService.findOneAndUpdate(
      { artisanId: userArtisanId, categoryId },
      { $set: { artisanId: userArtisanId, services, isActive: true, updatedAt: new Date() } },
      { upsert: true, new: true }
    );

    return reply.code(200).send({ success: true, data: doc });
  } catch (err) {
    req.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to save services' });
  }
};

export const listMyServices = async (req, reply) => {
  try {
    const userId = req.user?.id;
    if (!userId) return reply.code(401).send({ success: false, message: 'Authentication required' });
    const artisan = await Artisan.findOne({ userId });
    if (!artisan) return reply.code(404).send({ success: false, message: 'Artisan profile not found' });

    const docs = await ArtisanService.find({ artisanId: artisan.userId, isActive: true }).populate('categoryId', 'name').populate('services.subCategoryId', 'name').lean();
    return reply.send({ success: true, data: docs });
  } catch (err) {
    req.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list services' });
  }
};

export const getService = async (req, reply) => {
  try {
    const id = req.params.id;
    const doc = await ArtisanService.findById(id).populate('categoryId', 'name').populate('services.subCategoryId', 'name');
    if (!doc) return reply.code(404).send({ success: false, message: 'Not found' });
    // ensure ownership
    const userId = req.user?.id;
    const artisan = await Artisan.findOne({ userId });
    if (!artisan || String(doc.artisanId) !== String(artisan.userId)) return reply.code(403).send({ success: false, message: 'Forbidden' });
    return reply.send({ success: true, data: doc });
  } catch (err) {
    req.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to get service' });
  }
};

export const updateService = async (req, reply) => {
  try {
    const id = req.params.id;
    const updates = req.body || {};
    const userId = req.user?.id;
    const artisan = await Artisan.findOne({ userId });
    if (!artisan) return reply.code(404).send({ success: false, message: 'Artisan profile not found' });

    const doc = await ArtisanService.findById(id);
    if (!doc) return reply.code(404).send({ success: false, message: 'Not found' });
    if (String(doc.artisanId) !== String(artisan.userId)) return reply.code(403).send({ success: false, message: 'Forbidden' });

    if (updates.services) doc.services = updates.services;
    if (typeof updates.isActive !== 'undefined') doc.isActive = Boolean(updates.isActive);
    doc.updatedAt = new Date();
    await doc.save();
    return reply.send({ success: true, data: doc });
  } catch (err) {
    req.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to update service' });
  }
};

export const deleteService = async (req, reply) => {
  try {
    const id = req.params.id;
    const userId = req.user?.id;
    const artisan = await Artisan.findOne({ userId });
    if (!artisan) return reply.code(404).send({ success: false, message: 'Artisan profile not found' });

    const doc = await ArtisanService.findById(id);
    if (!doc) return reply.code(404).send({ success: false, message: 'Not found' });
    if (String(doc.artisanId) !== String(artisan.userId)) return reply.code(403).send({ success: false, message: 'Forbidden' });

    // soft delete
    doc.isActive = false;
    doc.updatedAt = new Date();
    await doc.save();
    return reply.send({ success: true, message: 'Service removed' });
  } catch (err) {
    req.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to remove service' });
  }
};

// Public: list services for a given artisan (accepts artisanId which may be Artisan._id or User._id)
export const listByArtisan = async (req, reply) => {
  try {
    const artisanIdParam = req.params.artisanId || req.query.artisanId;
    if (!artisanIdParam) return reply.code(400).send({ success: false, message: 'artisanId required' });

    // Resolve artisan doc: accept either Artisan._id or User._id
    const artisan = await (async () => {
      const a = await (await import('../models/Artisan.js')).default.findById(artisanIdParam).lean();
      if (a) return a;
      // try as user id
      return (await import('../models/Artisan.js')).default.findOne({ userId: artisanIdParam }).lean();
    })();

    if (!artisan) return reply.code(404).send({ success: false, message: 'Artisan not found' });

    const docs = await ArtisanService.find({ artisanId: artisan.userId, isActive: true }).populate('categoryId', 'name').populate('services.subCategoryId', 'name').lean();
    return reply.send({ success: true, data: docs });
  } catch (err) {
    req.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list artisan services' });
  }
};
