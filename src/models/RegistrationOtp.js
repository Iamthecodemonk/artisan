import mongoose from 'mongoose';

const registrationOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, index: true },
  codeHash: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed },
  delivered: { type: mongoose.Schema.Types.Mixed },
  expiresAt: { type: Date, required: true, index: true },
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

registrationOtpSchema.index({ email: 1 }, { unique: true });

export default mongoose.model('RegistrationOtp', registrationOtpSchema);
