// src/models/Review.js
import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  artisanId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rating: { type: Number, min: 1, max: 5 },
  comment: String,
  createdAt: { type: Date, default: Date.now },
});

// Ensure a customer can only leave one review per artisan
reviewSchema.index({ customerId: 1, artisanId: 1 }, { unique: true });

export default mongoose.model('Review', reviewSchema);
