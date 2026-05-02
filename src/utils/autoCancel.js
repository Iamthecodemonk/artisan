import Booking from '../models/Booking.js';
import Transaction from '../models/Transaction.js';
import { createNotification } from './notifier.js';
import axios from 'axios';

// Auto-cancel unpaid bookings older than AUTO_CANCEL_HOURS (default 24h)
// Auto-reject bookings awaiting acceptance older than AUTO_CANCEL_HOURS (default 24h)
export function startAutoCancel(fastify) {
  const hours = Number(process.env.AUTO_CANCEL_HOURS || 24);
  const intervalMinutes = Number(process.env.AUTO_CANCEL_CHECK_MINUTES || 15);
  const cutoffMs = hours * 60 * 60 * 1000;

  async function checkAndCancel() {
    try {
      const cutoff = new Date(Date.now() - cutoffMs);
      
      // Cancel unpaid bookings
      const toCancel = await Booking.find({ 
        paymentStatus: { $ne: 'paid' }, 
        status: 'pending', 
        createdAt: { $lt: cutoff } 
      });
      
      if (toCancel && toCancel.length > 0) {
        for (const booking of toCancel) {
          booking.status = 'cancelled';
          booking.refundStatus = booking.refundStatus || 'none';
          await booking.save();
          try { 
            const bookingName = booking?.service || 'your booking';
            await createNotification(fastify, booking.customerId, { 
              type: 'booking', 
              title: 'Booking auto-cancelled', 
              body: `${bookingName} was auto-cancelled due to unpaid status.`, 
              data: { bookingId: booking._id, bookingName } 
            }); 
          } catch (e) { 
            fastify.log?.warn?.('notify failed', e?.message); 
          }
        }
        fastify.log?.info?.(`Auto-cancelled ${toCancel.length} unpaid bookings older than ${hours}h`);
      }

      // Auto-reject bookings awaiting artisan acceptance
      const toReject = await Booking.find({
        status: 'awaiting-acceptance',
        paymentStatus: 'paid',
        createdAt: { $lt: cutoff }
      }).populate('customerId artisanId');

      if (toReject && toReject.length > 0) {
        for (const booking of toReject) {
          booking.status = 'cancelled';
          booking.artisanApprovalStatus = 'rejected';
          booking.artisanApprovalDate = new Date();
          booking.rejectionReason = 'Artisan did not respond within 24 hours';
          booking.refundStatus = 'requested';
          await booking.save();

          // Process refund
          const tx = await Transaction.findOne({ bookingId: booking._id, status: 'holding' });
          if (tx && process.env.PAYSTACK_SECRET_KEY && tx.paymentGatewayRef) {
            try {
              const res = await axios.post('https://api.paystack.co/refund', 
                { transaction: tx.paymentGatewayRef }, 
                { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } }
              );
              
              if (res?.data?.status === true) {
                tx.refundId = res.data.data?.id || res.data.data?.reference;
                tx.refundStatus = 'refunded';
                tx.status = 'refunded';
                await tx.save();
                booking.refundStatus = 'refunded';
                await booking.save();
              }
            } catch (refundErr) {
              fastify.log?.warn?.('auto-refund failed', refundErr?.response?.data || refundErr?.message);
            }
          }

          // Notify customer
          try {
            const bookingName = booking?.service || 'your booking';
            await createNotification(fastify, booking.customerId._id, {
              type: 'booking',
              title: 'Booking auto-cancelled',
              body: `${bookingName} was cancelled because the artisan did not respond within 24 hours. ${booking.refundStatus === 'refunded' ? 'Refund has been processed.' : 'Refund will be processed shortly.'}`,
              data: { bookingId: booking._id, bookingName }
            });
          } catch (e) {
            fastify.log?.warn?.('notify customer failed', e?.message);
          }

          // Notify artisan about missed booking
          try {
            if (booking.artisanId) {
              try {
                const bookingName = booking?.service || 'the booking';
                await createNotification(fastify, booking.artisanId._id, {
                  type: 'booking',
                  title: 'Booking expired',
                  body: `${bookingName} was auto-cancelled because you did not respond within 24 hours.`,
                  data: { bookingId: booking._id, bookingName }
                });
              } catch (e) {
                fastify.log?.warn?.('notify artisan failed', e?.message);
              }
            }
          } catch (e) {
            fastify.log?.warn?.('notify artisan failed', e?.message);
          }
        }
        fastify.log?.info?.(`Auto-rejected ${toReject.length} unaccepted bookings older than ${hours}h`);
      }
    } catch (err) {
      fastify.log?.error?.('autoCancel error', err);
    }
  }

  // Run immediately and then on interval
  checkAndCancel();
  const timer = setInterval(checkAndCancel, intervalMinutes * 60 * 1000);

  // return stop function
  return () => clearInterval(timer);
}
