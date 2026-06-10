/* eslint-disable no-unused-vars */
export enum ORDER_STATUS {
  PENDING_PAYMENT = 'pending_payment',
  SECURED = 'secured',
  COLLECTION_PENDING = 'collection_pending',
  COLLECTED = 'collected',
  VERIFICATION = 'verification',
  PAYOUT_PROCESSING = 'payout_processing',
  READY_FOR_DELIVERY = 'ready_for_delivery',
  DELIVERED = 'delivered',
  COMPLETED = 'completed',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
}

export enum PAYMENT_STATUS {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

export enum PAYOUT_STATUS {
  PENDING = 'pending',
  PAID = 'paid',
}
