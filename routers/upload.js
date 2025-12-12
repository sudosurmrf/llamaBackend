import express from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { uploadSingle, uploadMultiple, handleUploadError } from '../middleware/upload.js';
import { uploadToS3, deleteFromS3, extractKeyFromUrl } from '../config/s3.js';

const router = express.Router();

// Upload single image
router.post('/single', authenticate, authorize('admin', 'staff', 'baker'), uploadSingle, handleUploadError, asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const folder = req.body.folder || 'general';
  const uploaded = await uploadToS3(req.file, folder);

  res.json({
    message: 'Image uploaded successfully',
    image: uploaded,
  });
}));

// Upload multiple images
router.post('/multiple', authenticate, authorize('admin', 'staff', 'baker'), uploadMultiple, handleUploadError, asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files uploaded', 400);
  }

  const folder = req.body.folder || 'general';
  const uploaded = [];

  for (const file of req.files) {
    const result = await uploadToS3(file, folder);
    uploaded.push(result);
  }

  res.json({
    message: `${uploaded.length} images uploaded successfully`,
    images: uploaded,
  });
}));

// Delete image by URL or key
router.delete('/', authenticate, authorize('admin', 'staff', 'baker'), asyncHandler(async (req, res) => {
  const { url, key } = req.body;

  let deleteKey = key;

  if (!deleteKey && url) {
    deleteKey = extractKeyFromUrl(url);
  }

  if (!deleteKey) {
    throw new AppError('URL or key is required', 400);
  }

  await deleteFromS3(deleteKey);

  res.json({ message: 'Image deleted successfully' });
}));

export default router;
