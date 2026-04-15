// src/models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, unique: true, sparse: true, trim: true },
  password: String,
  role: { type: String, enum: ['guest', 'customer', 'artisan', 'admin'], default: 'guest' },
  authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
  banned: { type: Boolean, default: false },
  googleId: { type: String },
  profileImage: { type: { url: String, public_id: String }, default: {} },
  isVerified: { type: Boolean, default: false },
  kycVerified: { type: Boolean, default: false },
  kycLevel: { type: Number, default: 0 },
  isGuest: { type: Boolean, default: false },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

// Ensure indexes are created
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });

export default mongoose.model('User', userSchema);
