import express from 'express';
import { query } from '../config/database.js';
import { authenticate, authorize, optionalAuth } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Get all banners (public - filtered by location and date)
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { location, active, includeExpired } = req.query;
  const isAdmin = req.user && ['admin', 'staff', 'baker'].includes(req.user.role);

  let queryText = 'SELECT * FROM banners WHERE 1=1';
  const params = [];
  let paramCount = 1;

  // For public users, only show active banners within date range
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

  queryText += ' ORDER BY created_at DESC';

  const result = await query(queryText, params);

  res.json({ banners: result.rows });
}));

// Get single banner by ID
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isAdmin = req.user && ['admin', 'staff', 'baker'].includes(req.user.role);

  let queryText = 'SELECT * FROM banners WHERE id = $1';

  if (!isAdmin) {
    queryText += ' AND active = true AND start_date <= NOW() AND end_date >= NOW()';
  }

  const result = await query(queryText, [id]);

  if (result.rows.length === 0) {
    throw new AppError('Banner not found', 404);
  }

  res.json({ banner: result.rows[0] });
}));

// Create banner (admin/staff only)
router.post('/', authenticate, authorize('admin', 'staff'), asyncHandler(async (req, res) => {
  const {
    title,
    message,
    type = 'info',
    dismissible = true,
    active = true,
    start_date,
    end_date,
    display_location = 'site_wide',
    link,
    link_text,
  } = req.body;

  if (!message || !start_date || !end_date) {
    throw new AppError('Message, start_date, and end_date are required', 400);
  }

  const validTypes = ['info', 'warning', 'success', 'error'];
  if (!validTypes.includes(type)) {
    throw new AppError('Invalid banner type', 400);
  }

  const validLocations = ['site_wide', 'homepage', 'menu', 'checkout'];
  if (!validLocations.includes(display_location)) {
    throw new AppError('Invalid display location', 400);
  }

  const result = await query(
    `INSERT INTO banners (title, message, type, dismissible, active, start_date, end_date, display_location, link, link_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      title,
      message,
      type,
      dismissible === 'true' || dismissible === true,
      active === 'true' || active === true,
      start_date,
      end_date,
      display_location,
      link,
      link_text,
    ]
  );

  res.status(201).json({
    message: 'Banner created successfully',
    banner: result.rows[0],
  });
}));

// Update banner (admin/staff only)
router.put('/:id', authenticate, authorize('admin', 'staff'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    title,
    message,
    type,
    dismissible,
    active,
    start_date,
    end_date,
    display_location,
    link,
    link_text,
  } = req.body;

  // Check if banner exists
  const existing = await query('SELECT * FROM banners WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('Banner not found', 404);
  }

  // Build update query dynamically
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (title !== undefined) {
    updates.push(`title = $${paramCount}`);
    values.push(title);
    paramCount++;
  }

  if (message !== undefined) {
    updates.push(`message = $${paramCount}`);
    values.push(message);
    paramCount++;
  }

  if (type !== undefined) {
    const validTypes = ['info', 'warning', 'success', 'error'];
    if (!validTypes.includes(type)) {
      throw new AppError('Invalid banner type', 400);
    }
    updates.push(`type = $${paramCount}`);
    values.push(type);
    paramCount++;
  }

  if (dismissible !== undefined) {
    updates.push(`dismissible = $${paramCount}`);
    values.push(dismissible === 'true' || dismissible === true);
    paramCount++;
  }

  if (active !== undefined) {
    updates.push(`active = $${paramCount}`);
    values.push(active === 'true' || active === true);
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

  if (display_location !== undefined) {
    const validLocations = ['site_wide', 'homepage', 'menu', 'checkout'];
    if (!validLocations.includes(display_location)) {
      throw new AppError('Invalid display location', 400);
    }
    updates.push(`display_location = $${paramCount}`);
    values.push(display_location);
    paramCount++;
  }

  if (link !== undefined) {
    updates.push(`link = $${paramCount}`);
    values.push(link);
    paramCount++;
  }

  if (link_text !== undefined) {
    updates.push(`link_text = $${paramCount}`);
    values.push(link_text);
    paramCount++;
  }

  if (updates.length === 0) {
    throw new AppError('No updates provided', 400);
  }

  values.push(id);

  const result = await query(
    `UPDATE banners SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  res.json({
    message: 'Banner updated successfully',
    banner: result.rows[0],
  });
}));

// Delete banner (admin only)
router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await query('SELECT id FROM banners WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('Banner not found', 404);
  }

  await query('DELETE FROM banners WHERE id = $1', [id]);

  res.json({ message: 'Banner deleted successfully' });
}));

export default router;
