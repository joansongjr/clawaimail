import Stripe from 'stripe';
import { getUserById, getUserByEmail } from './db.js';

// db.run 直接用导入的 default
import db from './db.js';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const PLANS = {
  free:     { name: 'Free',     price: 0,   stripePriceId: null },
  starter:  { name: 'Starter',  price: 5,   stripePriceId: process.env.STRIPE_STARTER_PRICE_ID },
  pro:      { name: 'Pro',      price: 29,  stripePriceId: process.env.STRIPE_PRO_PRICE_ID },
  business: { name: 'Business', price: 99,  stripePriceId: process.env.STRIPE_BUSINESS_PRICE_ID }
};

export function getPlans() {
  return Object.entries(PLANS).map(([id, plan]) => ({
    id, name: plan.name, price: plan.price
  }));
}

export function upgradePlan(userId, plan) {
  db.run('UPDATE users SET plan = ? WHERE id = ?', [plan, userId]);
  console.log(`[Billing] User ${userId} -> ${plan}`);
}

export async function createCheckoutSession(userId, planId, successUrl, cancelUrl) {
  if (!stripe) throw new Error('Stripe not configured. Set STRIPE_SECRET_KEY.');
  const plan = PLANS[planId];
  if (!plan || !plan.stripePriceId) throw new Error('Invalid plan');

  const user = getUserById(userId);
  if (!user) throw new Error('User not found');

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: user.email,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: successUrl || 'https://clawaimail.com/dashboard?upgraded=true',
    cancel_url: cancelUrl || 'https://clawaimail.com/pricing',
    metadata: { user_id: String(userId), plan_id: planId }
  });

  return { url: session.url, session_id: session.id };
}

export async function handleStripeWebhook(rawBody, signature) {
  if (!stripe) throw new Error('Stripe not configured');

  const event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = parseInt(session.metadata.user_id);
      const planId = session.metadata.plan_id;
      if (userId && planId) upgradePlan(userId, planId);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customer = await stripe.customers.retrieve(sub.customer);
      const user = getUserByEmail(customer.email);
      if (user) upgradePlan(user.id, 'free');
      break;
    }
  }

  return { received: true };
}
