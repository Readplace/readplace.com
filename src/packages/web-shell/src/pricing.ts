/** The annual price as shown to people — in the checkout-recovery email and the
 * MCP renewal upsell. Display-only: the amount actually charged is Stripe's
 * STRIPE_PRICE_ID. Centralised so the two surfaces can't quote different prices. */
export const ANNUAL_PRICE_DISPLAY = "$49";

export const SUBSCRIBE_CTA_LABEL = `Subscribe — ${ANNUAL_PRICE_DISPLAY}/year`;
