import express from 'express';
import Stripe from 'stripe';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Create Stripe Checkout Session
router.post('/create-session', asyncHandler(async (req, res) => {
  const { items, customerInfo } = req.body;

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
  const orderMetadata = {
    orderType: customerInfo?.orderType || 'pickup',
    customerEmail: customerInfo?.email || '',
    customerPhone: customerInfo?.phone || '',
  };

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
    success_url: `${process.env.FRONTEND_URL}/order-confirmation?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/order-confirmation?canceled=true`,
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
