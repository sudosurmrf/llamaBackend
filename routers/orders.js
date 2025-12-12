import express from 'express';
import { query, getClient } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authenticateCustomer } from './customers.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// Generate order number
const generateOrderNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `LT-${timestamp}-${random}`;
};

// Get customer's orders (customer auth required)
router.get('/my-orders', authenticateCustomer, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT o.*,
            json_agg(json_build_object(
              'id', oi.id,
              'productId', oi.product_id,
              'productName', oi.product_name,
              'quantity', oi.quantity,
              'unitPrice', oi.unit_price,
              'totalPrice', oi.total_price
            )) as items
     FROM orders o
     LEFT JOIN order_items oi ON o.id = oi.order_id
     WHERE o.customer_id = $1
     GROUP BY o.id
     ORDER BY o.created_at DESC`,
    [req.customer.id]
  );

  const orders = result.rows.map(order => ({
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    subtotal: parseFloat(order.subtotal),
    tax: parseFloat(order.tax),
    total: parseFloat(order.total),
    fulfillmentType: order.fulfillment_type,
    pickupTime: order.pickup_time,
    deliveryAddress: order.delivery_address,
    notes: order.notes,
    items: order.items[0]?.id ? order.items : [],
    createdAt: order.created_at,
  }));

  res.json({ orders });
}));

// Get single order by order number (customer auth required)
router.get('/my-orders/:orderNumber', authenticateCustomer, asyncHandler(async (req, res) => {
  const { orderNumber } = req.params;

  const result = await query(
    `SELECT o.*,
            json_agg(json_build_object(
              'id', oi.id,
              'productId', oi.product_id,
              'productName', oi.product_name,
              'quantity', oi.quantity,
              'unitPrice', oi.unit_price,
              'totalPrice', oi.total_price
            )) as items
     FROM orders o
     LEFT JOIN order_items oi ON o.id = oi.order_id
     WHERE o.order_number = $1 AND o.customer_id = $2
     GROUP BY o.id`,
    [orderNumber, req.customer.id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Order not found', 404);
  }

  const order = result.rows[0];

  res.json({
    order: {
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      subtotal: parseFloat(order.subtotal),
      tax: parseFloat(order.tax),
      total: parseFloat(order.total),
      fulfillmentType: order.fulfillment_type,
      pickupTime: order.pickup_time,
      deliveryAddress: order.delivery_address,
      customerName: order.customer_name,
      customerEmail: order.customer_email,
      customerPhone: order.customer_phone,
      notes: order.notes,
      items: order.items[0]?.id ? order.items : [],
      createdAt: order.created_at,
    },
  });
}));

// Create order (can be guest or authenticated customer)
router.post('/', asyncHandler(async (req, res) => {
  const {
    items,
    customerInfo,
    fulfillmentType = 'pickup',
    pickupTime,
    deliveryAddress,
    notes,
    stripeSessionId,
    customerId,
  } = req.body;

  if (!items || items.length === 0) {
    throw new AppError('Order must contain at least one item', 400);
  }

  if (!customerInfo?.email || !customerInfo?.name) {
    throw new AppError('Customer email and name are required', 400);
  }

  // Calculate totals
  const subtotal = items.reduce((sum, item) => {
    return sum + (parseFloat(item.price) * item.quantity);
  }, 0);
  const taxRate = 0.085;
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Create order
    const orderResult = await client.query(
      `INSERT INTO orders (
        customer_id, order_number, status, subtotal, tax, total,
        fulfillment_type, pickup_time, delivery_address,
        customer_name, customer_email, customer_phone, notes, stripe_session_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        customerId || null,
        generateOrderNumber(),
        'pending',
        subtotal.toFixed(2),
        tax.toFixed(2),
        total.toFixed(2),
        fulfillmentType,
        pickupTime || null,
        deliveryAddress ? JSON.stringify(deliveryAddress) : null,
        customerInfo.name,
        customerInfo.email,
        customerInfo.phone || null,
        notes || null,
        stripeSessionId || null,
      ]
    );

    const order = orderResult.rows[0];

    // Insert order items
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          order.id,
          item.id || null,
          item.name,
          item.quantity,
          parseFloat(item.price).toFixed(2),
          (parseFloat(item.price) * item.quantity).toFixed(2),
        ]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Order created successfully',
      order: {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        total: parseFloat(order.total),
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

// =====================================================
// ADMIN ROUTES (Staff authentication required)
// =====================================================

// Get all orders (admin/staff only)
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let whereClause = '';
  const params = [];

  if (status) {
    whereClause = 'WHERE o.status = $1';
    params.push(status);
  }

  const countResult = await query(
    `SELECT COUNT(*) FROM orders o ${whereClause}`,
    params
  );
  const totalCount = parseInt(countResult.rows[0].count);

  params.push(limit, offset);
  const limitParam = params.length - 1;
  const offsetParam = params.length;

  const result = await query(
    `SELECT o.*,
            json_agg(json_build_object(
              'id', oi.id,
              'productName', oi.product_name,
              'quantity', oi.quantity,
              'unitPrice', oi.unit_price,
              'totalPrice', oi.total_price
            )) as items
     FROM orders o
     LEFT JOIN order_items oi ON o.id = oi.order_id
     ${whereClause}
     GROUP BY o.id
     ORDER BY o.created_at DESC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );

  const orders = result.rows.map(order => ({
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    subtotal: parseFloat(order.subtotal),
    tax: parseFloat(order.tax),
    total: parseFloat(order.total),
    fulfillmentType: order.fulfillment_type,
    pickupTime: order.pickup_time,
    customerName: order.customer_name,
    customerEmail: order.customer_email,
    customerPhone: order.customer_phone,
    items: order.items[0]?.id ? order.items : [],
    createdAt: order.created_at,
  }));

  res.json({
    orders,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  });
}));

// Get single order by ID (admin/staff only)
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await query(
    `SELECT o.*,
            json_agg(json_build_object(
              'id', oi.id,
              'productId', oi.product_id,
              'productName', oi.product_name,
              'quantity', oi.quantity,
              'unitPrice', oi.unit_price,
              'totalPrice', oi.total_price
            )) as items
     FROM orders o
     LEFT JOIN order_items oi ON o.id = oi.order_id
     WHERE o.id = $1
     GROUP BY o.id`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Order not found', 404);
  }

  const order = result.rows[0];

  res.json({
    order: {
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      subtotal: parseFloat(order.subtotal),
      tax: parseFloat(order.tax),
      total: parseFloat(order.total),
      fulfillmentType: order.fulfillment_type,
      pickupTime: order.pickup_time,
      deliveryAddress: order.delivery_address,
      customerName: order.customer_name,
      customerEmail: order.customer_email,
      customerPhone: order.customer_phone,
      customerId: order.customer_id,
      notes: order.notes,
      stripeSessionId: order.stripe_session_id,
      items: order.items[0]?.id ? order.items : [],
      createdAt: order.created_at,
      updatedAt: order.updated_at,
    },
  });
}));

// Update order status (admin/staff only)
router.patch('/:id/status', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
  }

  const result = await query(
    `UPDATE orders SET status = $1 WHERE id = $2
     RETURNING id, order_number, status, updated_at`,
    [status, id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Order not found', 404);
  }

  res.json({
    message: 'Order status updated',
    order: {
      id: result.rows[0].id,
      orderNumber: result.rows[0].order_number,
      status: result.rows[0].status,
      updatedAt: result.rows[0].updated_at,
    },
  });
}));

export default router;
