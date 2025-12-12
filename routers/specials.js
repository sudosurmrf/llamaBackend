import express from 'express';
import { query } from '../config/database.js';
import { authenticate, authorize, optionalAuth } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { uploadSingle, handleUploadError } from '../middleware/upload.js';
import { uploadToS3, deleteFromS3, extractKeyFromUrl } from '../config/s3.js';

const router = express.Router();

// Get all specials (public - only active and within date range)
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { active, includeExpired } = req.query;
  const isAdmin = req.user && ['admin', 'staff', 'baker'].includes(req.user.role);

  let queryText = 'SELECT * FROM specials WHERE 1=1';
  const params = [];
  let paramCount = 1;

  // For public users, only show active specials within date range
  if (!isAdmin) {
    queryText += ` AND active = true AND start_date <= NOW() AND end_date >= NOW()`;
  } else {
    if (active !== undefined) {
      queryText += ` AND active = $${paramCount}`;
      params.push(active === 'true');
      paramCount++;
    }

    if (includeExpired !== 'true') {
      queryText += ` AND end_date >= NOW()`;
    }
  }

  queryText += ' ORDER BY start_date DESC';

  const result = await query(queryText, params);

  // Enrich with product/category details
  for (const special of result.rows) {
    if (special.product_ids && special.product_ids.length > 0) {
      const productsResult = await query(
        'SELECT id, name, slug, price, images FROM products WHERE id = ANY($1)',
        [special.product_ids]
      );
      special.products = productsResult.rows;
    }

    if (special.category_ids && special.category_ids.length > 0) {
      const categoriesResult = await query(
        'SELECT id, name, slug FROM categories WHERE id = ANY($1)',
        [special.category_ids]
      );
      special.categories = categoriesResult.rows;
    }
  }

  res.json({ specials: result.rows });
}));

// Get single special by ID (public - only if active and in date range)
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isAdmin = req.user && ['admin', 'staff', 'baker'].includes(req.user.role);

  let queryText = 'SELECT * FROM specials WHERE id = $1';

  if (!isAdmin) {
    queryText += ' AND active = true AND start_date <= NOW() AND end_date >= NOW()';
  }

  const result = await query(queryText, [id]);

  if (result.rows.length === 0) {
    throw new AppError('Special not found', 404);
  }

  const special = result.rows[0];

  // Enrich with product/category details
  if (special.product_ids && special.product_ids.length > 0) {
    const productsResult = await query(
      'SELECT id, name, slug, price, images FROM products WHERE id = ANY($1)',
      [special.product_ids]
    );
    special.products = productsResult.rows;
  }

  if (special.category_ids && special.category_ids.length > 0) {
    const categoriesResult = await query(
      'SELECT id, name, slug FROM categories WHERE id = ANY($1)',
      [special.category_ids]
    );
    special.categories = categoriesResult.rows;
  }

  res.json({ special });
}));

// Validate promo code and calculate discount
router.post('/validate-code', asyncHandler(async (req, res) => {
  const { code, subtotal, items } = req.body;

  if (!code) {
    throw new AppError('Promo code is required', 400);
  }

  const result = await query(
    `SELECT * FROM specials
     WHERE code = $1
     AND active = true
     AND start_date <= NOW()
     AND end_date >= NOW()
     AND (max_uses IS NULL OR used_count < max_uses)`,
    [code.toUpperCase()]
  );

  if (result.rows.length === 0) {
    return res.status(400).json({
      valid: false,
      error: 'Invalid or expired promo code',
    });
  }

  const special = result.rows[0];

  // Check minimum purchase requirement
  if (special.min_purchase && subtotal < special.min_purchase) {
    return res.status(400).json({
      valid: false,
      error: `Minimum purchase of $${special.min_purchase.toFixed(2)} required`,
    });
  }

  // Calculate discount based on type
  let discount = 0;

  switch (special.type) {
    case 'discount_percentage':
      // value is the percentage (e.g., 10 for 10% off)
      discount = (subtotal * special.value) / 100;
      break;

    case 'fixed_price':
      // value is the fixed discount amount
      discount = Math.min(special.value, subtotal);
      break;

    case 'bundle_discount':
      // value is the discount percentage for bundle
      discount = (subtotal * special.value) / 100;
      break;

    case 'buy_x_get_y':
      // Complex logic would go here - for now, just apply as percentage
      const buyQty = special.value?.buy_quantity || special.value?.buyQuantity || 2;
      const getQty = special.value?.get_quantity || special.value?.getQuantity || 1;
      // Simplified: give getQty items free worth based on average item price
      if (items && items.length > 0) {
        const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
        if (totalItems >= buyQty) {
          const avgPrice = subtotal / totalItems;
          const freeItems = Math.floor(totalItems / (buyQty + getQty)) * getQty;
          discount = avgPrice * freeItems;
        }
      }
      break;

    default:
      discount = 0;
  }

  // Round to 2 decimal places
  discount = Math.round(discount * 100) / 100;

  res.json({
    valid: true,
    special: {
      id: special.id,
      name: special.name,
      code: special.code,
      type: special.type,
      description: special.description,
    },
    discount,
  });
}));

// Create special (admin/staff only)
router.post('/', authenticate, authorize('admin', 'staff'), uploadSingle, handleUploadError, asyncHandler(async (req, res) => {
  const {
    name,
    description,
    type,
    value,
    product_ids,
    category_ids,
    start_date,
    end_date,
    active = true,
    min_purchase,
    max_uses,
    code,
  } = req.body;

  if (!name || !type || !value || !start_date || !end_date) {
    throw new AppError('Name, type, value, start_date, and end_date are required', 400);
  }

  const validTypes = ['discount_percentage', 'bundle_discount', 'buy_x_get_y', 'fixed_price'];
  if (!validTypes.includes(type)) {
    throw new AppError('Invalid special type', 400);
  }

  // Upload image if provided
  let imageUrl = null;
  if (req.file) {
    const uploaded = await uploadToS3(req.file, 'specials');
    imageUrl = uploaded.url;
  }

  // Parse arrays if strings
  const parsedProductIds = typeof product_ids === 'string' ? JSON.parse(product_ids) : product_ids;
  const parsedCategoryIds = typeof category_ids === 'string' ? JSON.parse(category_ids) : category_ids;
  const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;

  const result = await query(
    `INSERT INTO specials (name, description, type, value, product_ids, category_ids, start_date, end_date, active, min_purchase, max_uses, code, image)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      name,
      description,
      type,
      parsedValue,
      parsedProductIds || [],
      parsedCategoryIds || [],
      start_date,
      end_date,
      active === 'true' || active === true,
      min_purchase ? parseFloat(min_purchase) : null,
      max_uses ? parseInt(max_uses) : null,
      code ? code.toUpperCase() : null,
      imageUrl,
    ]
  );

  res.status(201).json({
    message: 'Special created successfully',
    special: result.rows[0],
  });
}));

// Update special (admin/staff only)
router.put('/:id', authenticate, authorize('admin', 'staff'), uploadSingle, handleUploadError, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    type,
    value,
    product_ids,
    category_ids,
    start_date,
    end_date,
    active,
    min_purchase,
    max_uses,
    code,
    removeImage,
  } = req.body;

  // Check if special exists
  const existing = await query('SELECT * FROM specials WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('Special not found', 404);
  }

  const special = existing.rows[0];

  // Build update query dynamically
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramCount}`);
    values.push(name);
    paramCount++;
  }

  if (description !== undefined) {
    updates.push(`description = $${paramCount}`);
    values.push(description);
    paramCount++;
  }

  if (type !== undefined) {
    const validTypes = ['discount_percentage', 'bundle_discount', 'buy_x_get_y', 'fixed_price'];
    if (!validTypes.includes(type)) {
      throw new AppError('Invalid special type', 400);
    }
    updates.push(`type = $${paramCount}`);
    values.push(type);
    paramCount++;
  }

  if (value !== undefined) {
    updates.push(`value = $${paramCount}`);
    const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
    values.push(parsedValue);
    paramCount++;
  }

  if (product_ids !== undefined) {
    updates.push(`product_ids = $${paramCount}`);
    const parsed = typeof product_ids === 'string' ? JSON.parse(product_ids) : product_ids;
    values.push(parsed || []);
    paramCount++;
  }

  if (category_ids !== undefined) {
    updates.push(`category_ids = $${paramCount}`);
    const parsed = typeof category_ids === 'string' ? JSON.parse(category_ids) : category_ids;
    values.push(parsed || []);
    paramCount++;
  }

  if (start_date !== undefined) {
    updates.push(`start_date = $${paramCount}`);
    values.push(start_date);
    paramCount++;
  }

  if (end_date !== undefined) {
    updates.push(`end_date = $${paramCount}`);
    values.push(end_date);
    paramCount++;
  }

  if (active !== undefined) {
    updates.push(`active = $${paramCount}`);
    values.push(active === 'true' || active === true);
    paramCount++;
  }

  if (min_purchase !== undefined) {
    updates.push(`min_purchase = $${paramCount}`);
    values.push(min_purchase ? parseFloat(min_purchase) : null);
    paramCount++;
  }

  if (max_uses !== undefined) {
    updates.push(`max_uses = $${paramCount}`);
    values.push(max_uses ? parseInt(max_uses) : null);
    paramCount++;
  }

  if (code !== undefined) {
    updates.push(`code = $${paramCount}`);
    values.push(code ? code.toUpperCase() : null);
    paramCount++;
  }

  // Handle image update
  if (req.file) {
    if (special.image) {
      const oldKey = extractKeyFromUrl(special.image);
      if (oldKey) {
        try {
          await deleteFromS3(oldKey);
        } catch (err) {
          console.error('Failed to delete old image:', err);
        }
      }
    }

    const uploaded = await uploadToS3(req.file, 'specials');
    updates.push(`image = $${paramCount}`);
    values.push(uploaded.url);
    paramCount++;
  } else if (removeImage === 'true') {
    if (special.image) {
      const oldKey = extractKeyFromUrl(special.image);
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
    `UPDATE specials SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  res.json({
    message: 'Special updated successfully',
    special: result.rows[0],
  });
}));

// Delete special (admin only)
router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await query('SELECT image FROM specials WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('Special not found', 404);
  }

  // Delete image from S3
  const special = existing.rows[0];
  if (special.image) {
    const key = extractKeyFromUrl(special.image);
    if (key) {
      try {
        await deleteFromS3(key);
      } catch (err) {
        console.error('Failed to delete image from S3:', err);
      }
    }
  }

  await query('DELETE FROM specials WHERE id = $1', [id]);

  res.json({ message: 'Special deleted successfully' });
}));

export default router;
