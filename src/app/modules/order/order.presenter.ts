/* eslint-disable @typescript-eslint/no-explicit-any */
import { ORDER_STATUS } from '../../../enums/order';
import { USER_ROLES } from '../../../enums/user';
import { ORDER_STATUS_TRANSITIONS } from './order.constant';

const STATUS_RANK: Record<ORDER_STATUS, number> = {
  [ORDER_STATUS.PENDING_PAYMENT]: 0,
  [ORDER_STATUS.SECURED]: 1,
  [ORDER_STATUS.COLLECTION_PENDING]: 1,
  [ORDER_STATUS.COLLECTED]: 2,
  [ORDER_STATUS.VERIFICATION]: 2,
  [ORDER_STATUS.PAYOUT_PROCESSING]: 3,
  [ORDER_STATUS.READY_FOR_DELIVERY]: 3,
  [ORDER_STATUS.DELIVERED]: 4,
  [ORDER_STATUS.COMPLETED]: 4,
  [ORDER_STATUS.REFUNDED]: -1,
  [ORDER_STATUS.CANCELLED]: -1,
};

const CURRENT_PROGRESS: Record<
  ORDER_STATUS,
  { label: string; description: string }
> = {
  [ORDER_STATUS.PENDING_PAYMENT]: {
    label: 'Awaiting payment',
    description: 'Payment confirmation is pending',
  },
  [ORDER_STATUS.SECURED]: {
    label: 'Reserved',
    description: 'Payment is secured and pickup is being arranged',
  },
  [ORDER_STATUS.COLLECTION_PENDING]: {
    label: 'Pickup pending',
    description: 'The item is awaiting collection from the seller',
  },
  [ORDER_STATUS.COLLECTED]: {
    label: 'Collected',
    description: 'The item was collected and is awaiting authentication',
  },
  [ORDER_STATUS.VERIFICATION]: {
    label: 'Verification',
    description: 'Authentication is in progress',
  },
  [ORDER_STATUS.PAYOUT_PROCESSING]: {
    label: 'Verified',
    description: 'Authentication passed and seller payout is processing',
  },
  [ORDER_STATUS.READY_FOR_DELIVERY]: {
    label: 'Ready for delivery',
    description: 'The verified item is ready to be delivered',
  },
  [ORDER_STATUS.DELIVERED]: {
    label: 'Delivered',
    description: 'The item was delivered to the buyer',
  },
  [ORDER_STATUS.COMPLETED]: {
    label: 'Completed',
    description: 'The order is complete',
  },
  [ORDER_STATUS.REFUNDED]: {
    label: 'Refunded',
    description: 'The payment was refunded',
  },
  [ORDER_STATUS.CANCELLED]: {
    label: 'Cancelled',
    description: 'The order was cancelled',
  },
};

const toPlain = (value: any): any =>
  value && typeof value.toJSON === 'function' ? value.toJSON() : value;

const idOf = (value: any) =>
  String(value?._id ?? value?.id ?? value ?? '');

const currentStepFor = (status: ORDER_STATUS) => {
  if (
    status === ORDER_STATUS.SECURED ||
    status === ORDER_STATUS.COLLECTION_PENDING
  ) {
    return 'reserved';
  }
  if (status === ORDER_STATUS.COLLECTED) return 'collected';
  if (
    status === ORDER_STATUS.VERIFICATION ||
    status === ORDER_STATUS.PAYOUT_PROCESSING
  ) {
    return 'verified';
  }
  if (
    status === ORDER_STATUS.READY_FOR_DELIVERY ||
    status === ORDER_STATUS.DELIVERED
  ) {
    return 'delivered';
  }
  return null;
};

export const getOrderProgress = (
  status: ORDER_STATUS,
  statusHistory: Array<{ status: ORDER_STATUS }> = [],
) => {
  const effectiveRank = Math.max(
    STATUS_RANK[status],
    ...statusHistory.map(item => STATUS_RANK[item.status] ?? -1),
  );
  const currentStep = currentStepFor(status);
  const steps = [
    { key: 'reserved', label: 'Reserved', rank: 1 },
    { key: 'collected', label: 'Collected', rank: 2 },
    { key: 'verified', label: 'Verified', rank: 3 },
    { key: 'delivered', label: 'Delivered', rank: 4 },
  ];

  return steps.map(step => ({
    key: step.key,
    label: step.label,
    state:
      currentStep === step.key
        ? 'current'
        : effectiveRank >= step.rank
          ? 'completed'
          : 'pending',
  }));
};

export const getVerificationState = (
  status: ORDER_STATUS,
  verificationFailed: boolean,
) => {
  if (verificationFailed) {
    return { status: 'failed', label: 'Verification failed', isVerified: false };
  }
  if (
    status === ORDER_STATUS.PAYOUT_PROCESSING ||
    status === ORDER_STATUS.READY_FOR_DELIVERY ||
    status === ORDER_STATUS.DELIVERED ||
    status === ORDER_STATUS.COMPLETED
  ) {
    return { status: 'verified', label: 'Verified', isVerified: true };
  }
  if (status === ORDER_STATUS.VERIFICATION) {
    return {
      status: 'in_progress',
      label: 'Authentication pending',
      isVerified: false,
    };
  }
  return { status: 'pending', label: 'Not verified yet', isVerified: false };
};

export const getDeliveryState = (status: ORDER_STATUS) => {
  if (
    status === ORDER_STATUS.DELIVERED ||
    status === ORDER_STATUS.COMPLETED
  ) {
    return { status: 'delivered', label: 'Delivered' };
  }
  if (status === ORDER_STATUS.READY_FOR_DELIVERY) {
    return { status: 'ready_for_delivery', label: 'Ready for delivery' };
  }
  if (
    status === ORDER_STATUS.CANCELLED ||
    status === ORDER_STATUS.REFUNDED
  ) {
    return { status: 'not_applicable', label: 'Delivery cancelled' };
  }
  return { status: 'pending', label: 'Delivery pending' };
};

const normalizeParty = (party: any, fallback: any = {}) => {
  const value = toPlain(party) ?? {};
  return {
    _id: idOf(value),
    name: value.name ?? null,
    email: value.email ?? null,
    phone: value.phone || value.contact || fallback.phone || null,
    location: value.location || fallback.location || null,
    country: value.country ?? null,
    profileImage: value.avatar || value.image || null,
  };
};

export const buildOrderDetails = ({
  order,
  openIssue,
  viewer,
  currency,
}: {
  order: any;
  openIssue: any;
  viewer: { id: string; role: string };
  currency: string;
}) => {
  const value = toPlain(order);
  const product = toPlain(value.product) ?? {};
  const deliveryDetails = value.deliveryDetails ?? {};
  const issue = toPlain(openIssue);
  const hasOpenIssue = Boolean(issue && issue.resolved === false);
  const status = value.status as ORDER_STATUS;
  const isAdmin =
    viewer.role === USER_ROLES.ADMIN || viewer.role === USER_ROLES.SUPER_ADMIN;
  const isBuyer = idOf(value.buyer) === viewer.id;
  const allowedStatusTransitions = isAdmin
    ? ORDER_STATUS_TRANSITIONS[status] ?? []
    : [];
  const verification = getVerificationState(
    status,
    issue?.issueType === 'verification_failed',
  );
  const features = Array.isArray(product.features) ? product.features : [];
  const hasProduct = Boolean(idOf(product));
  const displayDetails = [product.material, ...features]
    .filter(Boolean)
    .join(' • ');

  return {
    _id: idOf(value),
    orderNumber: value.orderNumber,
    status,
    product: {
      _id: idOf(product),
      orderId: product.orderId ?? null,
      name: product.name ?? null,
      brand: product.brand ?? null,
      images:
        Array.isArray(product.images) && product.images.length > 0
          ? product.images
          : product.image
            ? [product.image]
            : [],
      price: value.price,
      currency,
      verified: verification.isVerified,
      details: {
        material: product.material ?? null,
        features,
        condition: product.condition ?? null,
        description: product.description ?? null,
        originalPackagingAvailable: Boolean(
          product.originalPackagingAvailable,
        ),
        displayText:
          displayDetails || product.description || product.condition || null,
      },
    },
    pricing: {
      price: value.price,
      platformFee: value.platformFee,
      sellerPayout: value.sellerPayout,
      currency,
    },
    verification,
    pickupWindow:
      value.pickupWindow?.start || value.pickupWindow?.end
      ? {
          start: value.pickupWindow.start ?? null,
          end: value.pickupWindow.end ?? null,
        }
      : null,
    estimatedDeliveryAt: value.estimatedDeliveryAt ?? null,
    seller: normalizeParty(value.seller),
    buyer: normalizeParty(value.buyer, deliveryDetails),
    deliveryDetails: {
      address: deliveryDetails.address ?? null,
      location: deliveryDetails.location ?? null,
      phone: deliveryDetails.phone ?? null,
    },
    note: value.note ?? null,
    progress: getOrderProgress(status, value.statusHistory ?? []),
    currentProgress: {
      status,
      ...CURRENT_PROGRESS[status],
    },
    deliveryStatus: getDeliveryState(status),
    statusHistory: (value.statusHistory ?? []).map((item: any) => ({
      status: item.status,
      note: item.note ?? null,
      changedAt: item.changedAt,
    })),
    payment: {
      provider: value.payment?.provider ?? null,
      status: value.payment?.status ?? null,
    },
    payoutStatus: value.payoutStatus,
    issue: {
      hasOpenIssue,
      openIssue: hasOpenIssue
        ? {
            _id: idOf(issue),
            issueType: issue.issueType,
            reason: issue.reason,
            createdAt: issue.createdAt,
          }
        : null,
      canReport: isAdmin && hasProduct && !hasOpenIssue,
    },
    actions: {
      allowedStatusTransitions,
      markAsDelivered: {
        enabled: allowedStatusTransitions.includes(ORDER_STATUS.DELIVERED),
        requiredStatus: ORDER_STATUS.READY_FOR_DELIVERY,
        disabledReason: allowedStatusTransitions.includes(ORDER_STATUS.DELIVERED)
          ? null
          : 'Order must be ready for delivery',
        method: 'PATCH',
        endpoint: `/api/v1/orders/${idOf(value)}/status`,
        payload: { status: ORDER_STATUS.DELIVERED },
      },
      reportIssue: {
        enabled: isAdmin && hasProduct && !hasOpenIssue,
        disabledReason: !isAdmin
          ? 'Admin access is required'
          : !hasProduct
            ? 'Product is no longer available'
          : hasOpenIssue
              ? 'An unresolved issue already exists'
              : null,
        method: 'POST',
        endpoint: '/api/v1/issues',
        payload: { productId: idOf(product) },
      },
      cancelOrder: {
        enabled:
          isBuyer &&
          (status === ORDER_STATUS.PENDING_PAYMENT ||
            status === ORDER_STATUS.SECURED),
        disabledReason: !isBuyer
          ? 'Only the buyer can cancel this order'
          : status !== ORDER_STATUS.PENDING_PAYMENT &&
              status !== ORDER_STATUS.SECURED
            ? 'Order can only be cancelled before collection'
            : null,
        method: 'POST',
        endpoint: `/api/v1/orders/${idOf(value)}/cancel`,
      },
    },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};
