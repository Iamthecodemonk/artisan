import mongoose from 'mongoose';

const adSchema = new mongoose.Schema({
  type: { type: String, enum: ['marquee', 'banner', 'carousel', 'general'], default: 'general', index: true },
  title: { type: String },
  text: { type: String },
  image: { type: String },
  link: { type: String },
  active: { type: Boolean, default: true },
  meta: { type: Object, default: {} },
  order: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Ad', adSchema);
