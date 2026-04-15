import CompanyEarning from '../models/CompanyEarning.js';

// Admin: list company earnings with paging and optional filters
export async function listCompanyEarnings(request, reply) {
  try {
    const { page = 1, limit = 20, from, to, bookingId, transactionId } = request.query || {};
    const q = {};
    if (from) q.createdAt = { ...(q.createdAt || {}), $gte: new Date(from) };
    if (to) q.createdAt = { ...(q.createdAt || {}), $lte: new Date(to) };
    if (bookingId) q.bookingId = bookingId;
    if (transactionId) q.transactionId = transactionId;

    const [total, items] = await Promise.all([
      CompanyEarning.countDocuments(q),
      CompanyEarning.find(q)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit || 20))
        .lean()
    ]);

    const agg = await CompanyEarning.aggregate([
      { $match: q },
      { $group: { _id: null, totalAmount: { $sum: '$amount' } } }
    ]);
    const totalAmount = (agg && agg[0] && agg[0].totalAmount) || 0;

    return reply.send({ success: true, data: { items, total, totalAmount } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list company earnings' });
  }
}

// Admin: summary (totals) for a date range
export async function summaryCompanyEarnings(request, reply) {
  try {
    const { from, to } = request.query || {};
    const q = {};
    if (from) q.createdAt = { ...(q.createdAt || {}), $gte: new Date(from) };
    if (to) q.createdAt = { ...(q.createdAt || {}), $lte: new Date(to) };

    const agg = await CompanyEarning.aggregate([
      { $match: q },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);
    const totalAmount = (agg && agg[0] && agg[0].totalAmount) || 0;
    const count = (agg && agg[0] && agg[0].count) || 0;

    return reply.send({ success: true, data: { totalAmount, count } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to compute company earnings summary' });
  }
}

export default { listCompanyEarnings, summaryCompanyEarnings };
