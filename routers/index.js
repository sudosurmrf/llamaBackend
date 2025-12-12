import express from 'express';
import authRouter from './auth.js';
import productsRouter from './products.js';
import categoriesRouter from './categories.js';
import specialsRouter from './specials.js';
import promotionsRouter from './promotions.js';
import bannersRouter from './banners.js';
import settingsRouter from './settings.js';
import uploadRouter from './upload.js';

const router = express.Router();

// Auth routes
router.use('/auth', authRouter);

// Resource routes
router.use('/products', productsRouter);
router.use('/categories', categoriesRouter);
router.use('/specials', specialsRouter);
router.use('/promotions', promotionsRouter);
router.use('/banners', bannersRouter);
router.use('/settings', settingsRouter);

// Upload routes
router.use('/upload', uploadRouter);

export default router;
