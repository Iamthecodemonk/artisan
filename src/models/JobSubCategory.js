import mongoose from 'mongoose';

const jobSubCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, index: true },
  description: { type: String },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobCategory', required: true, index: true },
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

// Ensure unique subcategory name per parent category
jobSubCategorySchema.index({ name: 1, categoryId: 1 }, { unique: true });

export default mongoose.model('JobSubCategory', jobSubCategorySchema);
