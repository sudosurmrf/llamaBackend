import express from 'express';
import Stripe from 'stripe';
import { query, getClient } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Ensure FRONTEND_URL has a scheme
const getFrontendUrl = () => {
  let url = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  return url.replace(/\/$/, ''); // Remove trailing slash
};

// Generate order number
const generateOrderNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `LT-${timestamp}-${random}`;
};

// Create Stripe Checkout Session
router.post('/create-session', asyncHandler(async (req, res) => {
  const { items } = req.body;
  // Handle both snake_case and camelCase from frontend
  const rawCustomerInfo = req.body.customer_info || req.body.customerInfo || {};

  // Normalize customer info to handle both naming conventions
  const customerInfo = {
    email: rawCustomerInfo.email,
    phone: rawCustomerInfo.phone,
    orderType: rawCustomerInfo.order_type || rawCustomerInfo.orderType,
    customerId: rawCustomerInfo.customer_id || rawCustomerInfo.customerId,
    firstName: rawCustomerInfo.first_name || rawCustomerInfo.firstName,
    lastName: rawCustomerInfo.last_name || rawCustomerInfo.lastName,
    name: rawCustomerInfo.name,
    pickupDate: rawCustomerInfo.pickup_date || rawCustomerInfo.pickupDate,
    pickupTime: rawCustomerInfo.pickup_time || rawCustomerInfo.pickupTime,
    address: rawCustomerInfo.address,
    apartment: rawCustomerInfo.apartment,
    city: rawCustomerInfo.city,
    state: rawCustomerInfo.state,
    zipCode: rawCustomerInfo.zip_code || rawCustomerInfo.zipCode,
    deliveryInstructions: rawCustomerInfo.delivery_instructions || rawCustomerInfo.deliveryInstructions,
  };

  if (!items || items.length === 0) {
    throw new AppError('No items in cart', 400);
  }

  // Calculate delivery fee if applicable
  const deliveryFee = customerInfo?.orderType === 'delivery' ? 500 : 0; // 500 cents = $5.00

  // Create line items for Stripe
  const lineItems = items.map((item) => ({
    price_data: {
      currency: 'usd',
      product_data: {
        name: item.name,
        images: item.image ? [item.image] : [],
        metadata: {
          productId: String(item.id),
        },
      },
      unit_amount: Math.round(item.price * 100), // Convert to cents
    },
    quantity: item.quantity,
  }));

  // Add delivery fee as a line item if applicable
  if (deliveryFee > 0) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'Delivery Fee',
        },
        unit_amount: deliveryFee,
      },
      quantity: 1,
    });
  }

  // Build metadata for the order
  // Note: Stripe metadata values have a 500 char limit, so we store items separately
  const orderMetadata = {
    orderType: customerInfo?.orderType || 'pickup',
    customerEmail: customerInfo?.email || '',
    customerName: customerInfo?.name || `${customerInfo?.firstName || ''} ${customerInfo?.lastName || ''}`.trim(),
    customerPhone: customerInfo?.phone || '',
    customerId: customerInfo?.customerId ? String(customerInfo.customerId) : '',
  };

  // Store items as JSON (keeping it simple - product id, name, qty, price)
  const itemsData = items.map(item => ({
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    price: item.price,
  }));
  orderMetadata.items = JSON.stringify(itemsData);

  if (customerInfo?.orderType === 'pickup') {
    orderMetadata.pickupDate = customerInfo.pickupDate || '';
    orderMetadata.pickupTime = customerInfo.pickupTime || '';
  } else if (customerInfo?.orderType === 'delivery') {
    orderMetadata.deliveryAddress = JSON.stringify({
      firstName: customerInfo.firstName,
      lastName: customerInfo.lastName,
      address: customerInfo.address,
      apartment: customerInfo.apartment,
      city: customerInfo.city,
      state: customerInfo.state,
      zipCode: customerInfo.zipCode,
      instructions: customerInfo.deliveryInstructions,
    });
  }

  // Create Checkout Session
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: lineItems,
    mode: 'payment',
    success_url: `${getFrontendUrl()}/order-confirmation?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${getFrontendUrl()}/order-confirmation?canceled=true`,
    customer_email: customerInfo?.email,
    metadata: orderMetadata,
    automatic_tax: {
      enabled: false, // We're handling tax in the frontend
    },
    // Add tax as a separate line item
    // Note: Tax is calculated on frontend at 8.5%
  });

  res.json({
    url: session.url,
    sessionId: session.id,
  });
}));

// Get session details (for order confirmation)
router.get('/session/:sessionId', asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'payment_intent'],
  });

  res.json({
    session: {
      id: session.id,
      status: session.payment_status,
      customerEmail: session.customer_email,
      amountTotal: session.amount_total,
      metadata: session.metadata,
      lineItems: session.line_items?.data,
    },
  });
}));

// Confirm order - creates order in database after successful Stripe payment
router.post('/confirm-order', asyncHandler(async (req, res) => {
  // Handle both snake_case and camelCase from frontend
  const sessionId = req.body.session_id || req.body.sessionId;
  const customerId = req.body.customer_id || req.body.customerId;

  if (!sessionId) {
    throw new AppError('Session ID is required', 400);
  }

  // Check if order already exists for this session
  const existingOrder = await query(
    'SELECT id, order_number FROM orders WHERE stripe_session_id = $1',
    [sessionId]
  );

  if (existingOrder.rows.length > 0) {
    // Order already created, return it
    return res.json({
      message: 'Order already exists',
      order: {
        id: existingOrder.rows[0].id,
        orderNumber: existingOrder.rows[0].order_number,
      },
    });
  }

  // Retrieve session from Stripe
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'payment_intent'],
  });

  // Verify payment was successful
  if (session.payment_status !== 'paid') {
    throw new AppError('Payment not completed', 400);
  }

  // Parse metadata
  const metadata = session.metadata || {};
  const items = metadata.items ? JSON.parse(metadata.items) : [];
  const deliveryAddress = metadata.deliveryAddress ? JSON.parse(metadata.deliveryAddress) : null;

  // Calculate totals from Stripe
  const total = session.amount_total / 100; // Convert from cents
  const taxRate = 0.085;
  const subtotal = total / (1 + taxRate);
  const tax = total - subtotal;

  // Determine customer ID - prefer the one passed in (authenticated user), fallback to metadata
  const orderCustomerId = customerId || (metadata.customerId ? parseInt(metadata.customerId) : null);

  // Parse pickup time if available
  let pickupTime = null;
  if (metadata.pickupDate && metadata.pickupTime) {
    pickupTime = new Date(`${metadata.pickupDate}T${metadata.pickupTime}`);
  }

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Create order
    const orderResult = await client.query(
      `INSERT INTO orders (
        customer_id, order_number, status, subtotal, tax, total,
        fulfillment_type, pickup_time, delivery_address,
        customer_name, customer_email, customer_phone,
        stripe_session_id, stripe_payment_intent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        orderCustomerId,
        generateOrderNumber(),
        'confirmed',
        subtotal.toFixed(2),
        tax.toFixed(2),
        total.toFixed(2),
        metadata.orderType || 'pickup',
        pickupTime,
        deliveryAddress ? JSON.stringify(deliveryAddress) : null,
        metadata.customerName || session.customer_email,
        metadata.customerEmail || session.customer_email,
        metadata.customerPhone || null,
        sessionId,
        session.payment_intent?.id || null,
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

// Stripe Webhook to handle events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('Payment successful for session:', session.id);
      // Here you would:
      // 1. Save the order to your database
      // 2. Send confirmation email
      // 3. Notify the bakery staff
      // For now, just log it
      console.log('Order details:', {
        email: session.customer_email,
        amount: session.amount_total,
        metadata: session.metadata,
      });
      break;

    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('PaymentIntent succeeded:', paymentIntent.id);
      break;

    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.error('Payment failed:', failedPayment.id);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

export default router;
