import mongoose from 'mongoose';

const quoteItemSchema = new mongoose.Schema({
  name: String,
  qty: { type: Number, default: 1 },
  note: String,
  cost: { type: Number, default: 0 },
});

const quoteSchema = new mongoose.Schema({
  // A quote can be attached to a Booking or to a Job. bookingId is used for booking-based quotes,
  // jobId is used for direct job quotes from artisans. At least one should be present (validated in controllers).
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', index: true },
  artisanId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [quoteItemSchema],
  serviceCharge: { type: Number, default: 0 },
  notes: String,
  total: { type: Number, default: 0 },
  status: { type: String, enum: ['proposed', 'accepted', 'rejected'], default: 'proposed' },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Quote', quoteSchema);
