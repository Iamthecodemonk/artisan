// src/models/Booking.js
import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  artisanId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  service: String,
  services: [
    {
      subCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobSubCategory' },
      name: String,
      unitPrice: Number,
      quantity: { type: Number, default: 1 },
      totalPrice: Number,
    }
  ],
  schedule: Date,
  price: Number,
  status: {
    type: String,
    enum: ["pending", "awaiting-acceptance", "accepted", "in-progress", "completed", "closed", "cancelled"],
    default: "pending",
  },
  paymentStatus: { type: String, enum: ["unpaid", "paid"], default: "unpaid" },
  artisanApprovalStatus: {
    type: String,
    enum: ["pending", "accepted", "rejected"],
    default: "pending",
  },
  artisanApprovalDate: { type: Date },
  rejectionReason: { type: String },
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" },
  notes: String,
  awaitingReview: { type: Boolean, default: false },
  reviewed: { type: Boolean, default: false },
  refundStatus: { type: String, enum: ['none','requested','refunded'], default: 'none' },
  acceptedQuote: { type: mongoose.Schema.Types.ObjectId, ref: 'Quote', default: null },
  createdAt: { type: Date, default: Date.now },

});

export default mongoose.model('Booking', bookingSchema);
