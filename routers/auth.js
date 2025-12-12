import express from 'express';
import bcrypt from 'bcrypt';
import { query } from '../config/database.js';
import { generateToken, authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Register a new user (admin only can create new staff accounts)
router.post('/register', authenticate, asyncHandler(async (req, res) => {
  // Only admins can create new users
  if (req.user.role !== 'admin') {
    throw new AppError('Only administrators can create new accounts', 403);
  }

  const { email, password, name, role = 'staff' } = req.body;

  if (!email || !password || !name) {
    throw new AppError('Email, password, and name are required', 400);
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new AppError('Invalid email format', 400);
  }

  // Validate password length
  if (password.length < 6) {
    throw new AppError('Password must be at least 6 characters', 400);
  }

  // Validate role
  const validRoles = ['admin', 'staff', 'baker'];
  if (!validRoles.includes(role)) {
    throw new AppError('Invalid role. Must be admin, staff, or baker', 400);
  }

  // Hash password
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Insert user
  const result = await query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, role, active, created_at`,
    [email, passwordHash, name, role]
  );

  res.status(201).json({
    message: 'User created successfully',
    user: result.rows[0],
  });
}));

// Login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  // Find user by email
  const result = await query(
    'SELECT id, email, password_hash, name, role, active FROM users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invalid email or password', 401);
  }

  const user = result.rows[0];

  // Check if account is active
  if (!user.active) {
    throw new AppError('Account is deactivated', 401);
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password_hash);

  if (!isValidPassword) {
    throw new AppError('Invalid email or password', 401);
  }

  // Generate token
  const token = generateToken(user.id);

  // Remove password hash from response
  delete user.password_hash;

  res.json({
    message: 'Login successful',
    token,
    user,
  });
}));

// Verify token / Get current user
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  res.json({
    user: req.user,
  });
}));

// Update current user's profile
router.put('/me', authenticate, asyncHandler(async (req, res) => {
  const { name, email } = req.body;
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (name) {
    updates.push(`name = $${paramCount}`);
    values.push(name);
    paramCount++;
  }

  if (email) {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new AppError('Invalid email format', 400);
    }
    updates.push(`email = $${paramCount}`);
    values.push(email);
    paramCount++;
  }

  if (updates.length === 0) {
    throw new AppError('No updates provided', 400);
  }

  values.push(req.user.id);

  const result = await query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}
     RETURNING id, email, name, role, active, updated_at`,
    values
  );

  res.json({
    message: 'Profile updated successfully',
    user: result.rows[0],
  });
}));

// Change password
router.put('/change-password', authenticate, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError('Current password and new password are required', 400);
  }

  if (newPassword.length < 6) {
    throw new AppError('New password must be at least 6 characters', 400);
  }

  // Get user with password hash
  const userResult = await query(
    'SELECT password_hash FROM users WHERE id = $1',
    [req.user.id]
  );

  // Verify current password
  const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);

  if (!isValidPassword) {
    throw new AppError('Current password is incorrect', 401);
  }

  // Hash new password
  const saltRounds = 10;
  const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

  // Update password
  await query(
    'UPDATE users SET password_hash = $1 WHERE id = $2',
    [newPasswordHash, req.user.id]
  );

  res.json({ message: 'Password changed successfully' });
}));

// Get all users (admin only)
router.get('/users', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw new AppError('Only administrators can view all users', 403);
  }

  const result = await query(
    'SELECT id, email, name, role, active, created_at, updated_at FROM users ORDER BY created_at DESC'
  );

  res.json({ users: result.rows });
}));

// Update user status (admin only)
router.put('/users/:id/status', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw new AppError('Only administrators can update user status', 403);
  }

  const { id } = req.params;
  const { active } = req.body;

  if (typeof active !== 'boolean') {
    throw new AppError('Active status must be a boolean', 400);
  }

  // Prevent admin from deactivating themselves
  if (parseInt(id) === req.user.id && !active) {
    throw new AppError('Cannot deactivate your own account', 400);
  }

  const result = await query(
    `UPDATE users SET active = $1 WHERE id = $2
     RETURNING id, email, name, role, active, updated_at`,
    [active, id]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  res.json({
    message: `User ${active ? 'activated' : 'deactivated'} successfully`,
    user: result.rows[0],
  });
}));

export default router;
