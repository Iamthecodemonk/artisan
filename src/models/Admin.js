// src/models/Admin.js
import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true, trim: true },
  password: String,
  role: { type: String, default: "admin" },
  permissions: {
    verifyArtisans: { type: Boolean, default: true },
    manageKyc: { type: Boolean, default: true },
    handleDisputes: { type: Boolean, default: true },
    viewReports: { type: Boolean, default: true },
  },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Admin', adminSchema);