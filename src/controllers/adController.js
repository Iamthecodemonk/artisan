import Ad from '../models/Ad.js';

const DEFAULT_MARQUEE = 'Welcome to Artisan — Book trusted professionals near you.';

export async function createAd(request, reply) {
  try {
    const payload = { ...request.body };
    if (request.user && request.user.id) payload.createdBy = request.user.id;
    const ad = await Ad.create(payload);
    return reply.code(201).send(ad);
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ error: 'Failed to create ad' });
  }
}

export async function listAds(request, reply) {
  try {
    const filter = {};
    if (request.query?.type) filter.type = request.query.type;
    const ads = await Ad.find(filter).sort({ order: 1, createdAt: -1 });
    return reply.send(ads);
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ error: 'Failed to list ads' });
  }
}

export async function getAd(request, reply) {
  try {
    const ad = await Ad.findById(request.params.id);
    if (!ad) return reply.code(404).send({ error: 'Ad not found' });
    return reply.send(ad);
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ error: 'Failed to fetch ad' });
  }
}

export async function updateAd(request, reply) {
  try {
    const ad = await Ad.findByIdAndUpdate(request.params.id, request.body, { new: true });
    if (!ad) return reply.code(404).send({ error: 'Ad not found' });
    return reply.send(ad);
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ error: 'Failed to update ad' });
  }
}

export async function deleteAd(request, reply) {
  try {
    const ad = await Ad.findByIdAndDelete(request.params.id);
    if (!ad) return reply.code(404).send({ error: 'Ad not found' });
    return reply.send({ ok: true });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ error: 'Failed to delete ad' });
  }
}

// Marquee helpers
export async function getMarquee(request, reply) {
  try {
    const ad = await Ad.findOne({ type: 'marquee', active: true }).sort({ createdAt: -1 });
    if (!ad || !ad.text) return reply.send({ text: DEFAULT_MARQUEE });
    return reply.send({ text: ad.text, active: ad.active, id: ad._id });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ text: DEFAULT_MARQUEE });
  }
}

export async function upsertMarquee(request, reply) {
  try {
    const { text, active = true } = request.body;
    const payload = { type: 'marquee', text, active };
    if (request.user && request.user.id) payload.createdBy = request.user.id;
    const ad = await Ad.findOneAndUpdate({ type: 'marquee' }, payload, { upsert: true, new: true, setDefaultsOnInsert: true });
    return reply.send(ad);
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ error: 'Failed to upsert marquee' });
  }
}

// Banners
export async function listBanner(request, reply) {
  try {
    const banners = await Ad.find({ type: 'banner', active: true }).sort({ order: 1, createdAt: -1 });
    return reply.send(banners);
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ error: 'Failed to list banners' });
  }
}

export async function createBanner(request, reply) {
  try {
    const payload = { ...request.body, type: 'banner' };
    if (request.user && request.user.id) payload.createdBy = request.user.id;
    const ad = await Ad.create(payload);
    return reply.code(201).send(ad);
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ error: 'Failed to create banner' });
  }
}

// Carousel
export async function listCarousel(request, reply) {
  try {
    const items = await Ad.find({ type: 'carousel', active: true }).sort({ order: 1, createdAt: -1 });
    return reply.send(items);
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ error: 'Failed to list carousel items' });
  }
}

export async function createCarousel(request, reply) {
  try {
    const payload = { ...request.body, type: 'carousel' };
    if (request.user && request.user.id) payload.createdBy = request.user.id;
    const ad = await Ad.create(payload);
    return reply.code(201).send(ad);
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ error: 'Failed to create carousel item' });
  }
}

export default {
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
};
