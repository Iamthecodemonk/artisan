import mongoose from 'mongoose';

const jobCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, index: true },
  description: { type: String },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobCategory', default: null, index: true },
  icon: { type: String }, // Icon name or URL for UI
  order: { type: Number, default: 0 }, // Display order
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

// Compound index to ensure unique names within the same parent category
jobCategorySchema.index({ name: 1, parentId: 1 }, { unique: true });

// Virtual for subcategories
jobCategorySchema.virtual('subcategories', {
  ref: 'JobCategory',
  localField: '_id',
  foreignField: 'parentId'
});

export default mongoose.model('JobCategory', jobCategorySchema);
