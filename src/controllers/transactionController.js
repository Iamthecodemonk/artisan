import Transaction from '../models/Transaction.js';
import { getConfig } from '../utils/config.js';

export async function listTransactions(request, reply) {
  try {
    const userId = request.user?.id;
    const userRole = request.user?.role;
    const { page = 1, limit = 20, status, bookingId, startDate, endDate } = request.query || {};
    
    const filters = {};
    
    // Role-based filtering
    if (userRole === 'admin') {
      // Admin can see all transactions, no filter
    } else if (userRole === 'artisan') {
      // Artisan sees transactions where they are the payee
      filters.payeeId = userId;
    } else {
      // Regular user sees transactions where they are the payer
      filters.payerId = userId;
    }
    
    // Additional filters
    if (status) filters.status = status;
    if (bookingId) filters.bookingId = bookingId;
    
    // Date range filter
    if (startDate || endDate) {
      filters.createdAt = {};
      if (startDate) filters.createdAt.$gte = new Date(startDate);
      if (endDate) filters.createdAt.$lte = new Date(endDate);
    }
    
    const transactions = await Transaction.find(filters)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('bookingId', 'status serviceDate totalPrice')
      .populate('payerId', 'name email phone role')
      .populate('payeeId', 'name email phone role')
      .lean();
    
    const total = await Transaction.countDocuments(filters);
    
    return reply.send({ 
      success: true, 
      data: transactions,
      meta: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to list transactions' });
  }
}

export async function getTransaction(request, reply) {
  try {
    const { id } = request.params;
    const userId = request.user?.id;
    const userRole = request.user?.role;
    
    const transaction = await Transaction.findById(id)
      .populate('bookingId', 'status serviceDate totalPrice')
      .populate('payerId', 'name email phone role')
      .populate('payeeId', 'name email phone role')
      .lean();
    
    if (!transaction) {
      return reply.code(404).send({ success: false, message: 'Transaction not found' });
    }
    
    // Check access: admin can see all, users can only see their own
    if (userRole !== 'admin') {
      const isOwner = String(transaction.payerId._id) === userId || String(transaction.payeeId._id) === userId;
      if (!isOwner) {
        return reply.code(403).send({ success: false, message: 'Access denied' });
      }
    }
    
    return reply.send({ success: true, data: transaction });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to get transaction' });
  }
}

export async function createTransaction(request, reply) {
  try {
    const payload = request.body || {};
    // ensure amount present
    const amount = Number(payload.amount || 0);
    // fetch current company fee percent from DB (falls back to env)
    let pct = await getConfig('COMPANY_FEE_PCT');
    if (pct === null || pct === undefined) pct = Number(process.env.COMPANY_FEE_PCT || 0);
    pct = Number(pct) || 0;

    const companyFee = Math.round((amount * pct / 100) * 100) / 100;
    const transferAmount = Math.round((amount - companyFee) * 100) / 100;

    const toCreate = { ...payload, amount, companyFee, transferAmount };
    const tx = await Transaction.create(toCreate);
    return reply.code(201).send({ success: true, data: tx });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(400).send({ success: false, message: err.message });
  }
}

export async function getTransactionSummary(request, reply) {
  try {
    // aggregate totals by status
    const agg = await Transaction.aggregate([
      { $match: {} },
      { $group: { _id: '$status', total: { $sum: { $ifNull: ['$amount', 0] } } } }
    ]);

    const byStatus = {
      holding: 0,
      pending: 0,
      released: 0,
      paid: 0,
      refunded: 0,
    };

    for (const row of agg) {
      const key = String(row._id || '').toLowerCase();
      if (Object.prototype.hasOwnProperty.call(byStatus, key)) {
        byStatus[key] = Math.round((row.total || 0) * 100) / 100;
      }
    }

    const total = Object.values(byStatus).reduce((s, v) => s + Number(v || 0), 0);
    const refunded = Number(byStatus.refunded || 0);
    const pending = Number(byStatus.pending || 0);

    // amount not on the platform yet = total - refunded - pending
    const netAvailable = Math.round((total - refunded - pending) * 100) / 100;

    return reply.send({ success: true, data: { byStatus, total: Math.round(total * 100) / 100, netAvailable } });
  } catch (err) {
    request.log?.error?.(err);
    return reply.code(500).send({ success: false, message: 'Failed to compute transaction summary' });
  }
}
