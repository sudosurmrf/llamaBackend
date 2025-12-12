import express from 'express';
import { query } from '../config/database.js';
import { authenticate, authorize, optionalAuth } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { uploadSingle, handleUploadError } from '../middleware/upload.js';
import { uploadToS3, deleteFromS3, extractKeyFromUrl } from '../config/s3.js';

const router = express.Router();

// Get all promotions (public - filtered by location and date)
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { location, active, includeExpired } = req.query;
  const isAdmin = req.user && ['admin', 'staff', 'baker'].includes(req.user.role);

  let queryText = 'SELECT * FROM promotions WHERE 1=1';
  const params = [];
  let paramCount = 1;

  // For public users, only show active promotions within date range
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

  // Filter by display location
  if (location) {
    queryText += ` AND display_location = $${paramCount}`;
    params.push(location);
    paramCount++;
  }

  queryText += ' ORDER BY display_order ASC, start_date DESC';

  const result = await query(queryText, params);

  res.json({ promotions: result.rows });
}));

// Get single promotion by ID
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isAdmin = req.user && ['admin', 'staff', 'baker'].includes(req.user.role);

  let queryText = 'SELECT * FROM promotions WHERE id = $1';

  if (!isAdmin) {
    queryText += ' AND active = true AND start_date <= NOW() AND end_date >= NOW()';
  }

  const result = await query(queryText, [id]);

  if (result.rows.length === 0) {
    throw new AppError('Promotion not found', 404);
  }

  res.json({ promotion: result.rows[0] });
}));

// Create promotion (admin/staff only)
router.post('/', authenticate, authorize('admin', 'staff'), uploadSingle, handleUploadError, asyncHandler(async (req, res) => {
  const {
    name,
    title,
    subtitle,
    description,
    button_text,
    button_link,
    background_color = '#f8e8d4',
    text_color = '#5c3d2e',
    start_date,
    end_date,
    active = true,
    display_location = 'homepage_hero',
    display_order = 0,
  } = req.body;

  if (!name || !title || !start_date || !end_date) {
    throw new AppError('Name, title, start_date, and end_date are required', 400);
  }

  const validLocations = ['homepage_hero', 'homepage_banner', 'menu_page', 'checkout'];
  if (!validLocations.includes(display_location)) {
    throw new AppError('Invalid display location', 400);
  }

  // Upload image if provided
  let imageUrl = null;
  if (req.file) {
    const uploaded = await uploadToS3(req.file, 'promotions');
    imageUrl = uploaded.url;
  }

  const result = await query(
    `INSERT INTO promotions (name, title, subtitle, description, button_text, button_link, image, background_color, text_color, start_date, end_date, active, display_location, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      name,
      title,
      subtitle,
      description,
      button_text,
      button_link,
      imageUrl,
      background_color,
      text_color,
      start_date,
      end_date,
      active === 'true' || active === true,
      display_location,
      parseInt(display_order),
    ]
  );

  res.status(201).json({
    message: 'Promotion created successfully',
    promotion: result.rows[0],
  });
}));

// Update promotion (admin/staff only)
router.put('/:id', authenticate, authorize('admin', 'staff'), uploadSingle, handleUploadError, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name,
    title,
    subtitle,
    description,
    button_text,
    button_link,
    background_color,
    text_color,
    start_date,
    end_date,
    active,
    display_location,
    display_order,
    removeImage,
  } = req.body;

  // Check if promotion exists
  const existing = await query('SELECT * FROM promotions WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('Promotion not found', 404);
  }

  const promotion = existing.rows[0];

  // Build update query dynamically
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramCount}`);
    values.push(name);
    paramCount++;
  }

  if (title !== undefined) {
    updates.push(`title = $${paramCount}`);
    values.push(title);
    paramCount++;
  }

  if (subtitle !== undefined) {
    updates.push(`subtitle = $${paramCount}`);
    values.push(subtitle);
    paramCount++;
  }

  if (description !== undefined) {
    updates.push(`description = $${paramCount}`);
    values.push(description);
    paramCount++;
  }

  if (button_text !== undefined) {
    updates.push(`button_text = $${paramCount}`);
    values.push(button_text);
    paramCount++;
  }

  if (button_link !== undefined) {
    updates.push(`button_link = $${paramCount}`);
    values.push(button_link);
    paramCount++;
  }

  if (background_color !== undefined) {
    updates.push(`background_color = $${paramCount}`);
    values.push(background_color);
    paramCount++;
  }

  if (text_color !== undefined) {
    updates.push(`text_color = $${paramCount}`);
    values.push(text_color);
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

  if (display_location !== undefined) {
    const validLocations = ['homepage_hero', 'homepage_banner', 'menu_page', 'checkout'];
    if (!validLocations.includes(display_location)) {
      throw new AppError('Invalid display location', 400);
    }
    updates.push(`display_location = $${paramCount}`);
    values.push(display_location);
    paramCount++;
  }

  if (display_order !== undefined) {
    updates.push(`display_order = $${paramCount}`);
    values.push(parseInt(display_order));
    paramCount++;
  }

  // Handle image update
  if (req.file) {
    if (promotion.image) {
      const oldKey = extractKeyFromUrl(promotion.image);
      if (oldKey) {
        try {
          await deleteFromS3(oldKey);
        } catch (err) {
          console.error('Failed to delete old image:', err);
        }
      }
    }

    const uploaded = await uploadToS3(req.file, 'promotions');
    updates.push(`image = $${paramCount}`);
    values.push(uploaded.url);
    paramCount++;
  } else if (removeImage === 'true') {
    if (promotion.image) {
      const oldKey = extractKeyFromUrl(promotion.image);
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
    `UPDATE promotions SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  res.json({
    message: 'Promotion updated successfully',
    promotion: result.rows[0],
  });
}));

// Delete promotion (admin only)
router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await query('SELECT image FROM promotions WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('Promotion not found', 404);
  }

  // Delete image from S3
  const promotion = existing.rows[0];
  if (promotion.image) {
    const key = extractKeyFromUrl(promotion.image);
    if (key) {
      try {
        await deleteFromS3(key);
      } catch (err) {
        console.error('Failed to delete image from S3:', err);
      }
    }
  }

  await query('DELETE FROM promotions WHERE id = $1', [id]);

  res.json({ message: 'Promotion deleted successfully' });
}));

// Reorder promotions (admin/staff only)
router.put('/reorder/batch', authenticate, authorize('admin', 'staff'), asyncHandler(async (req, res) => {
  const { orders } = req.body; // Array of { id, display_order }

  if (!Array.isArray(orders)) {
    throw new AppError('Orders must be an array', 400);
  }

  for (const item of orders) {
    await query(
      'UPDATE promotions SET display_order = $1 WHERE id = $2',
      [item.display_order, item.id]
    );
  }

  const result = await query('SELECT * FROM promotions ORDER BY display_order ASC');

  res.json({
    message: 'Promotions reordered successfully',
    promotions: result.rows,
  });
}));

export default router;
