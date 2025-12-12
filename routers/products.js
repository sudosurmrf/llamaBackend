import express from 'express';
import { query } from '../config/database.js';
import { authenticate, authorize, optionalAuth } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { uploadMultiple, handleUploadError } from '../middleware/upload.js';
import { uploadToS3, deleteFromS3, extractKeyFromUrl } from '../config/s3.js';

const router = express.Router();

// Helper to generate slug
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};

// Get all products (public)
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { category, featured, active, search, sort, order, limit, offset } = req.query;

  let queryText = `
    SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 1;

  // Filter by active status - only admins can see inactive products
  if (!req.user || req.user.role === 'customer') {
    queryText += ` AND p.active = true`;
  } else if (active !== undefined) {
    queryText += ` AND p.active = $${paramCount}`;
    params.push(active === 'true');
    paramCount++;
  }

  // Filter by category
  if (category) {
    queryText += ` AND (c.slug = $${paramCount} OR c.id::text = $${paramCount})`;
    params.push(category);
    paramCount++;
  }

  // Filter by featured
  if (featured !== undefined) {
    queryText += ` AND p.featured = $${paramCount}`;
    params.push(featured === 'true');
    paramCount++;
  }

  // Search
  if (search) {
    queryText += ` AND (p.name ILIKE $${paramCount} OR p.description ILIKE $${paramCount})`;
    params.push(`%${search}%`);
    paramCount++;
  }

  // Sorting
  const validSortFields = ['name', 'price', 'created_at', 'updated_at'];
  const sortField = validSortFields.includes(sort) ? sort : 'created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  queryText += ` ORDER BY p.${sortField} ${sortOrder}`;

  // Pagination
  if (limit) {
    queryText += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    paramCount++;
  }

  if (offset) {
    queryText += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));
    paramCount++;
  }

  const result = await query(queryText, params);

  // Get total count for pagination
  let countQuery = `
    SELECT COUNT(*) FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE 1=1
  `;
  const countParams = [];
  let countParamCount = 1;

  if (!req.user || req.user.role === 'customer') {
    countQuery += ` AND p.active = true`;
  } else if (active !== undefined) {
    countQuery += ` AND p.active = $${countParamCount}`;
    countParams.push(active === 'true');
    countParamCount++;
  }

  if (category) {
    countQuery += ` AND (c.slug = $${countParamCount} OR c.id::text = $${countParamCount})`;
    countParams.push(category);
    countParamCount++;
  }

  if (featured !== undefined) {
    countQuery += ` AND p.featured = $${countParamCount}`;
    countParams.push(featured === 'true');
    countParamCount++;
  }

  if (search) {
    countQuery += ` AND (p.name ILIKE $${countParamCount} OR p.description ILIKE $${countParamCount})`;
    countParams.push(`%${search}%`);
    countParamCount++;
  }

  const countResult = await query(countQuery, countParams);

  res.json({
    products: result.rows,
    total: parseInt(countResult.rows[0].count),
  });
}));

// Get single product by ID or slug (public)
router.get('/:idOrSlug', optionalAuth, asyncHandler(async (req, res) => {
  const { idOrSlug } = req.params;

  let queryText = `
    SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE (p.id::text = $1 OR p.slug = $1)
  `;

  // Only show active products to non-admin users
  if (!req.user || !['admin', 'staff', 'baker'].includes(req.user.role)) {
    queryText += ` AND p.active = true`;
  }

  const result = await query(queryText, [idOrSlug]);

  if (result.rows.length === 0) {
    throw new AppError('Product not found', 404);
  }

  res.json({ product: result.rows[0] });
}));

// Create product (admin/staff only)
router.post('/', authenticate, authorize('admin', 'staff', 'baker'), uploadMultiple, handleUploadError, asyncHandler(async (req, res) => {
  const {
    name,
    description,
    price,
    category_id,
    featured = false,
    active = true,
    allergens,
    ingredients,
    nutrition_info,
    servings,
  } = req.body;

  if (!name || !price) {
    throw new AppError('Name and price are required', 400);
  }

  // Generate slug
  let slug = generateSlug(name);

  // Check if slug exists and make unique if needed
  const existingSlug = await query('SELECT id FROM products WHERE slug = $1', [slug]);
  if (existingSlug.rows.length > 0) {
    slug = `${slug}-${Date.now()}`;
  }

  // Upload images to S3
  let imageUrls = [];
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      const uploaded = await uploadToS3(file, 'products');
      imageUrls.push(uploaded.url);
    }
  }

  // Parse arrays if they're strings
  const parsedAllergens = typeof allergens === 'string' ? JSON.parse(allergens) : allergens;
  const parsedNutrition = typeof nutrition_info === 'string' ? JSON.parse(nutrition_info) : nutrition_info;

  const result = await query(
    `INSERT INTO products (name, slug, description, price, category_id, images, featured, active, allergens, ingredients, nutrition_info, servings)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [name, slug, description, parseFloat(price), category_id || null, imageUrls, featured === 'true' || featured === true, active === 'true' || active === true, parsedAllergens || [], ingredients, parsedNutrition || null, servings]
  );

  res.status(201).json({
    message: 'Product created successfully',
    product: result.rows[0],
  });
}));

// Update product (admin/staff only)
router.put('/:id', authenticate, authorize('admin', 'staff', 'baker'), uploadMultiple, handleUploadError, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    price,
    category_id,
    featured,
    active,
    allergens,
    ingredients,
    nutrition_info,
    servings,
    existingImages, // URLs of images to keep
  } = req.body;

  // Check if product exists
  const existing = await query('SELECT * FROM products WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('Product not found', 404);
  }

  const product = existing.rows[0];

  // Handle images
  let imageUrls = [];

  // Keep existing images that weren't removed
  if (existingImages) {
    const keepImages = typeof existingImages === 'string' ? JSON.parse(existingImages) : existingImages;
    imageUrls = keepImages;

    // Delete removed images from S3
    if (product.images) {
      for (const oldUrl of product.images) {
        if (!keepImages.includes(oldUrl)) {
          const key = extractKeyFromUrl(oldUrl);
          if (key) {
            try {
              await deleteFromS3(key);
            } catch (err) {
              console.error('Failed to delete image from S3:', err);
            }
          }
        }
      }
    }
  }

  // Upload new images
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      const uploaded = await uploadToS3(file, 'products');
      imageUrls.push(uploaded.url);
    }
  }

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
    const existingSlug = await query('SELECT id FROM products WHERE slug = $1 AND id != $2', [slug, id]);
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

  if (price !== undefined) {
    updates.push(`price = $${paramCount}`);
    values.push(parseFloat(price));
    paramCount++;
  }

  if (category_id !== undefined) {
    updates.push(`category_id = $${paramCount}`);
    values.push(category_id || null);
    paramCount++;
  }

  if (imageUrls.length > 0 || (existingImages !== undefined)) {
    updates.push(`images = $${paramCount}`);
    values.push(imageUrls);
    paramCount++;
  }

  if (featured !== undefined) {
    updates.push(`featured = $${paramCount}`);
    values.push(featured === 'true' || featured === true);
    paramCount++;
  }

  if (active !== undefined) {
    updates.push(`active = $${paramCount}`);
    values.push(active === 'true' || active === true);
    paramCount++;
  }

  if (allergens !== undefined) {
    updates.push(`allergens = $${paramCount}`);
    const parsedAllergens = typeof allergens === 'string' ? JSON.parse(allergens) : allergens;
    values.push(parsedAllergens);
    paramCount++;
  }

  if (ingredients !== undefined) {
    updates.push(`ingredients = $${paramCount}`);
    values.push(ingredients);
    paramCount++;
  }

  if (nutrition_info !== undefined) {
    updates.push(`nutrition_info = $${paramCount}`);
    const parsedNutrition = typeof nutrition_info === 'string' ? JSON.parse(nutrition_info) : nutrition_info;
    values.push(parsedNutrition);
    paramCount++;
  }

  if (servings !== undefined) {
    updates.push(`servings = $${paramCount}`);
    values.push(servings);
    paramCount++;
  }

  if (updates.length === 0) {
    throw new AppError('No updates provided', 400);
  }

  values.push(id);

  const result = await query(
    `UPDATE products SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  res.json({
    message: 'Product updated successfully',
    product: result.rows[0],
  });
}));

// Delete product (admin only)
router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Get product to delete images
  const existing = await query('SELECT images FROM products WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('Product not found', 404);
  }

  // Delete images from S3
  const product = existing.rows[0];
  if (product.images && product.images.length > 0) {
    for (const url of product.images) {
      const key = extractKeyFromUrl(url);
      if (key) {
        try {
          await deleteFromS3(key);
        } catch (err) {
          console.error('Failed to delete image from S3:', err);
        }
      }
    }
  }

  await query('DELETE FROM products WHERE id = $1', [id]);

  res.json({ message: 'Product deleted successfully' });
}));

export default router;
