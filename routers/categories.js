import express from 'express';
import { query } from '../config/database.js';
import { authenticate, authorize, optionalAuth } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { uploadSingle, handleUploadError } from '../middleware/upload.js';
import { uploadToS3, deleteFromS3, extractKeyFromUrl } from '../config/s3.js';

const router = express.Router();

// Helper to generate slug
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};

// Get all categories (public)
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { active, withProducts } = req.query;

  let queryText = 'SELECT * FROM categories WHERE 1=1';
  const params = [];
  let paramCount = 1;

  // Filter by active - only admin can see inactive
  if (!req.user || !['admin', 'staff', 'baker'].includes(req.user.role)) {
    queryText += ' AND active = true';
  } else if (active !== undefined) {
    queryText += ` AND active = $${paramCount}`;
    params.push(active === 'true');
    paramCount++;
  }

  queryText += ' ORDER BY display_order ASC, name ASC';

  const result = await query(queryText, params);

  // Optionally include product count
  if (withProducts === 'true') {
    for (const category of result.rows) {
      const countResult = await query(
        'SELECT COUNT(*) FROM products WHERE category_id = $1 AND active = true',
        [category.id]
      );
      category.product_count = parseInt(countResult.rows[0].count);
    }
  }

  res.json({ categories: result.rows });
}));

// Get single category by ID or slug (public)
router.get('/:idOrSlug', optionalAuth, asyncHandler(async (req, res) => {
  const { idOrSlug } = req.params;
  const { withProducts } = req.query;

  let queryText = 'SELECT * FROM categories WHERE (id::text = $1 OR slug = $1)';

  if (!req.user || !['admin', 'staff', 'baker'].includes(req.user.role)) {
    queryText += ' AND active = true';
  }

  const result = await query(queryText, [idOrSlug]);

  if (result.rows.length === 0) {
    throw new AppError('Category not found', 404);
  }

  const category = result.rows[0];

  // Optionally include products
  if (withProducts === 'true') {
    const productsResult = await query(
      'SELECT * FROM products WHERE category_id = $1 AND active = true ORDER BY name ASC',
      [category.id]
    );
    category.products = productsResult.rows;
  }

  res.json({ category });
}));

// Create category (admin/staff only)
router.post('/', authenticate, authorize('admin', 'staff'), uploadSingle, handleUploadError, asyncHandler(async (req, res) => {
  const { name, description, display_order = 0, active = true } = req.body;

  if (!name) {
    throw new AppError('Name is required', 400);
  }

  // Generate slug
  let slug = generateSlug(name);

  // Check if slug exists
  const existingSlug = await query('SELECT id FROM categories WHERE slug = $1', [slug]);
  if (existingSlug.rows.length > 0) {
    slug = `${slug}-${Date.now()}`;
  }

  // Upload image if provided
  let imageUrl = null;
  if (req.file) {
    const uploaded = await uploadToS3(req.file, 'categories');
    imageUrl = uploaded.url;
  }

  const result = await query(
    `INSERT INTO categories (name, slug, description, image, display_order, active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, slug, description, imageUrl, parseInt(display_order), active === 'true' || active === true]
  );

  res.status(201).json({
    message: 'Category created successfully',
    category: result.rows[0],
  });
}));

// Update category (admin/staff only)
router.put('/:id', authenticate, authorize('admin', 'staff'), uploadSingle, handleUploadError, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, description, display_order, active, removeImage } = req.body;

  // Check if category exists
  const existing = await query('SELECT * FROM categories WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('Category not found', 404);
  }

  const category = existing.rows[0];

  // Build update query dynamically
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramCount}`);
    values.push(name);
    paramCount++;

    // Update slug if name changed
    let slug = generateSlug(name);
    const existingSlug = await query('SELECT id FROM categories WHERE slug = $1 AND id != $2', [slug, id]);
    if (existingSlug.rows.length > 0) {
      slug = `${slug}-${Date.now()}`;
    }
    updates.push(`slug = $${paramCount}`);
    values.push(slug);
    paramCount++;
  }

  if (description !== undefined) {
    updates.push(`description = $${paramCount}`);
    values.push(description);
    paramCount++;
  }

  if (display_order !== undefined) {
    updates.push(`display_order = $${paramCount}`);
    values.push(parseInt(display_order));
    paramCount++;
  }

  if (active !== undefined) {
    updates.push(`active = $${paramCount}`);
    values.push(active === 'true' || active === true);
    paramCount++;
  }

  // Handle image update
  if (req.file) {
    // Delete old image if exists
    if (category.image) {
      const oldKey = extractKeyFromUrl(category.image);
      if (oldKey) {
        try {
          await deleteFromS3(oldKey);
        } catch (err) {
          console.error('Failed to delete old image:', err);
        }
      }
    }

    const uploaded = await uploadToS3(req.file, 'categories');
    updates.push(`image = $${paramCount}`);
    values.push(uploaded.url);
    paramCount++;
  } else if (removeImage === 'true') {
    // Remove existing image
    if (category.image) {
      const oldKey = extractKeyFromUrl(category.image);
      if (oldKey) {
        try {
          await deleteFromS3(oldKey);
        } catch (err) {
          console.error('Failed to delete old image:', err);
        }
      }
    }
    updates.push(`image = $${paramCount}`);
    values.push(null);
    paramCount++;
  }

  if (updates.length === 0) {
    throw new AppError('No updates provided', 400);
  }

  values.push(id);

  const result = await query(
    `UPDATE categories SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  res.json({
    message: 'Category updated successfully',
    category: result.rows[0],
  });
}));

// Delete category (admin only)
router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Get category to delete image
  const existing = await query('SELECT image FROM categories WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('Category not found', 404);
  }

  // Delete image from S3
  const category = existing.rows[0];
  if (category.image) {
    const key = extractKeyFromUrl(category.image);
    if (key) {
      try {
        await deleteFromS3(key);
      } catch (err) {
        console.error('Failed to delete image from S3:', err);
      }
    }
  }

  // Delete category (products will have category_id set to NULL due to ON DELETE SET NULL)
  await query('DELETE FROM categories WHERE id = $1', [id]);

  res.json({ message: 'Category deleted successfully' });
}));

// Reorder categories (admin/staff only)
router.put('/reorder/batch', authenticate, authorize('admin', 'staff'), asyncHandler(async (req, res) => {
  const { orders } = req.body; // Array of { id, display_order }

  if (!Array.isArray(orders)) {
    throw new AppError('Orders must be an array', 400);
  }

  for (const item of orders) {
    await query(
      'UPDATE categories SET display_order = $1 WHERE id = $2',
      [item.display_order, item.id]
    );
  }

  const result = await query('SELECT * FROM categories ORDER BY display_order ASC, name ASC');

  res.json({
    message: 'Categories reordered successfully',
    categories: result.rows,
  });
}));

export default router;
