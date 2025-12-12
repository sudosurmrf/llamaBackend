import express from 'express';
import { query } from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Default settings
const defaultSettings = {
  bakery_name: 'Llama Treats Bakery',
  tagline: 'Handcrafted with love',
  phone: '(555) 123-4567',
  email: 'hello@llamatreats.com',
  address: '123 Baker Street, Llamaville, CA 90210',
  hours: {
    monday: { open: '07:00', close: '18:00', closed: false },
    tuesday: { open: '07:00', close: '18:00', closed: false },
    wednesday: { open: '07:00', close: '18:00', closed: false },
    thursday: { open: '07:00', close: '18:00', closed: false },
    friday: { open: '07:00', close: '19:00', closed: false },
    saturday: { open: '08:00', close: '17:00', closed: false },
    sunday: { open: '09:00', close: '15:00', closed: false },
  },
  social: {
    facebook: '',
    instagram: '',
    twitter: '',
    tiktok: '',
  },
  notifications: {
    email_new_order: true,
    email_low_stock: true,
    sms_new_order: false,
  },
  theme: {
    primary_color: '#8B4513',
    secondary_color: '#DEB887',
    accent_color: '#CD853F',
  },
};

// Get all settings (public for some, admin for all)
router.get('/', asyncHandler(async (req, res) => {
  const result = await query('SELECT key, value FROM settings');

  // Convert to object
  const settings = {};
  for (const row of result.rows) {
    settings[row.key] = row.value;
  }

  // Merge with defaults for any missing settings
  const mergedSettings = { ...defaultSettings };
  for (const key of Object.keys(settings)) {
    mergedSettings[key] = settings[key];
  }

  res.json({ settings: mergedSettings });
}));

// Get single setting by key
router.get('/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;

  const result = await query('SELECT value FROM settings WHERE key = $1', [key]);

  if (result.rows.length === 0) {
    // Return default if exists
    if (defaultSettings[key] !== undefined) {
      return res.json({ key, value: defaultSettings[key] });
    }
    throw new AppError('Setting not found', 404);
  }

  res.json({ key, value: result.rows[0].value });
}));

// Update or create setting (admin only)
router.put('/:key', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  if (value === undefined) {
    throw new AppError('Value is required', 400);
  }

  const result = await query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [key, JSON.stringify(value)]
  );

  res.json({
    message: 'Setting updated successfully',
    key: result.rows[0].key,
    value: result.rows[0].value,
  });
}));

// Bulk update settings (admin only)
router.put('/', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { settings } = req.body;

  if (!settings || typeof settings !== 'object') {
    throw new AppError('Settings object is required', 400);
  }

  const updatedSettings = {};

  for (const [key, value] of Object.entries(settings)) {
    const result = await query(
      `INSERT INTO settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [key, JSON.stringify(value)]
    );
    updatedSettings[key] = result.rows[0].value;
  }

  res.json({
    message: 'Settings updated successfully',
    settings: updatedSettings,
  });
}));

// Delete setting (admin only)
router.delete('/:key', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { key } = req.params;

  const result = await query('DELETE FROM settings WHERE key = $1 RETURNING key', [key]);

  if (result.rows.length === 0) {
    throw new AppError('Setting not found', 404);
  }

  res.json({ message: 'Setting deleted successfully' });
}));

// Reset settings to defaults (admin only)
router.post('/reset', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  // Delete all settings
  await query('DELETE FROM settings');

  // Insert defaults
  for (const [key, value] of Object.entries(defaultSettings)) {
    await query(
      'INSERT INTO settings (key, value) VALUES ($1, $2)',
      [key, JSON.stringify(value)]
    );
  }

  res.json({
    message: 'Settings reset to defaults',
    settings: defaultSettings,
  });
}));

export default router;
