import mongoose from 'mongoose';

const CompanyEarningSchema = new mongoose.Schema({
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  amount: { type: Number, required: true },
  note: { type: String },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('CompanyEarning', CompanyEarningSchema);
