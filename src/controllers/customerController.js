import Customer from '../models/Customer.js';

export async function getCustomer(request, reply) {
  try {
    const customer = await Customer.findOne({ userId: request.params.userId });
    if (!customer) return reply.code(404).send({ success: false, message: 'Not found' });
    return reply.send({ success: true, data: customer });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to get customer' });
  }
}

export async function createOrUpdateCustomer(request, reply) {
  try {
    const userId = request.body.userId || request.params.userId || request.user?.id;
    if (!userId) return reply.code(400).send({ success: false, message: 'userId required' });
    const payload = request.body || {};
    const customer = await Customer.findOneAndUpdate({ userId }, payload, { new: true, upsert: true });
    return reply.send({ success: true, data: customer });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function searchCustomers(request, reply) {
  try {
    const { q, page = 1, limit = 20 } = request.query || {};
    const filter = {};
    if (q) filter['location.address'] = { $regex: q, $options: 'i' };
    const results = await Customer.find(filter)
      .skip((page - 1) * limit)
      .limit(Number(limit));
    return reply.send({ success: true, data: results });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Search failed' });
  }
}
