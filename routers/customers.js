import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Generate JWT token for customer
const generateCustomerToken = (customerId) => {
  return jwt.sign(
    { customerId, type: 'customer' },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Customer authentication middleware
export const authenticateCustomer = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.type !== 'customer') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const result = await query(
      'SELECT id, email, first_name, last_name, phone, active, created_at FROM customers WHERE id = $1',
      [decoded.customerId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Customer not found' });
    }

    const customer = result.rows[0];

    if (!customer.active) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    req.customer = customer;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    next(error);
  }
};

// Register a new customer (public)
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, firstName, lastName, phone } = req.body;

  if (!email || !password || !firstName || !lastName) {
    throw new AppError('Email, password, first name, and last name are required', 400);
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

  // Check if email already exists
  const existing = await query('SELECT id FROM customers WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    throw new AppError('An account with this email already exists', 400);
  }

  // Hash password
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Insert customer
  const result = await query(
    `INSERT INTO customers (email, password_hash, first_name, last_name, phone)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, first_name, last_name, phone, created_at`,
    [email.toLowerCase(), passwordHash, firstName, lastName, phone || null]
  );

  const customer = result.rows[0];
  const token = generateCustomerToken(customer.id);

  res.status(201).json({
    message: 'Account created successfully',
    token,
    customer: {
      id: customer.id,
      email: customer.email,
      firstName: customer.first_name,
      lastName: customer.last_name,
      phone: customer.phone,
    },
  });
}));

// Customer login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  // Find customer by email
  const result = await query(
    'SELECT id, email, password_hash, first_name, last_name, phone, active FROM customers WHERE email = $1',
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invalid email or password', 401);
  }

  const customer = result.rows[0];

  if (!customer.active) {
    throw new AppError('Account is deactivated', 401);
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, customer.password_hash);

  if (!isValidPassword) {
    throw new AppError('Invalid email or password', 401);
  }

  // Generate token
  const token = generateCustomerToken(customer.id);

  res.json({
    message: 'Login successful',
    token,
    customer: {
      id: customer.id,
      email: customer.email,
      firstName: customer.first_name,
      lastName: customer.last_name,
      phone: customer.phone,
    },
  });
}));

// Get current customer profile
router.get('/me', authenticateCustomer, asyncHandler(async (req, res) => {
  res.json({
    customer: {
      id: req.customer.id,
      email: req.customer.email,
      firstName: req.customer.first_name,
      lastName: req.customer.last_name,
      phone: req.customer.phone,
      createdAt: req.customer.created_at,
    },
  });
}));

// Update customer profile
router.put('/me', authenticateCustomer, asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, email } = req.body;
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (firstName) {
    updates.push(`first_name = $${paramCount}`);
    values.push(firstName);
    paramCount++;
  }

  if (lastName) {
    updates.push(`last_name = $${paramCount}`);
    values.push(lastName);
    paramCount++;
  }

  if (phone !== undefined) {
    updates.push(`phone = $${paramCount}`);
    values.push(phone || null);
    paramCount++;
  }

  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new AppError('Invalid email format', 400);
    }
    // Check if email is taken by another customer
    const existing = await query(
      'SELECT id FROM customers WHERE email = $1 AND id != $2',
      [email.toLowerCase(), req.customer.id]
    );
    if (existing.rows.length > 0) {
      throw new AppError('This email is already in use', 400);
    }
    updates.push(`email = $${paramCount}`);
    values.push(email.toLowerCase());
    paramCount++;
  }

  if (updates.length === 0) {
    throw new AppError('No updates provided', 400);
  }

  values.push(req.customer.id);

  const result = await query(
    `UPDATE customers SET ${updates.join(', ')} WHERE id = $${paramCount}
     RETURNING id, email, first_name, last_name, phone, updated_at`,
    values
  );

  const customer = result.rows[0];

  res.json({
    message: 'Profile updated successfully',
    customer: {
      id: customer.id,
      email: customer.email,
      firstName: customer.first_name,
      lastName: customer.last_name,
      phone: customer.phone,
    },
  });
}));

// Change password
router.put('/change-password', authenticateCustomer, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError('Current password and new password are required', 400);
  }

  if (newPassword.length < 6) {
    throw new AppError('New password must be at least 6 characters', 400);
  }

  // Get customer with password hash
  const customerResult = await query(
    'SELECT password_hash FROM customers WHERE id = $1',
    [req.customer.id]
  );

  // Verify current password
  const isValidPassword = await bcrypt.compare(currentPassword, customerResult.rows[0].password_hash);

  if (!isValidPassword) {
    throw new AppError('Current password is incorrect', 401);
  }

  // Hash new password
  const saltRounds = 10;
  const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

  // Update password
  await query(
    'UPDATE customers SET password_hash = $1 WHERE id = $2',
    [newPasswordHash, req.customer.id]
  );

  res.json({ message: 'Password changed successfully' });
}));

export default router;
