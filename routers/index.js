import express from 'express';
import authRouter from './auth.js';
import customersRouter from './customers.js';
import ordersRouter from './orders.js';
import productsRouter from './products.js';
import categoriesRouter from './categories.js';
import specialsRouter from './specials.js';
import promotionsRouter from './promotions.js';
import bannersRouter from './banners.js';
import settingsRouter from './settings.js';
import uploadRouter from './upload.js';
import checkoutRouter from './checkout.js';

const router = express.Router();

// Auth routes (admin/staff)
router.use('/auth', authRouter);

// Customer routes (public registration/login)
router.use('/customers', customersRouter);

// Orders routes
router.use('/orders', ordersRouter);

// Resource routes
router.use('/products', productsRouter);
router.use('/categories', categoriesRouter);
router.use('/specials', specialsRouter);
router.use('/promotions', promotionsRouter);
router.use('/banners', bannersRouter);
router.use('/settings', settingsRouter);

// Upload routes
router.use('/upload', uploadRouter);

// Checkout routes
router.use('/checkout', checkoutRouter);

export default router;
