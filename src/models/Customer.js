// src/models/Customer.js
import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  location: {
    address: String,
    coordinates: { type: [Number], index: '2dsphere' },
  },
  preferredTrades: [String],
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Customer', customerSchema);
