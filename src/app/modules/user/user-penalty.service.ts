import config from '../../../config';
import { ORDER_OUTCOME } from '../../../enums/order';
import { User } from './user.model';

type PenaltyResult = {
  count: number;
  status: 'active' | 'restricted' | 'suspended' | 'ban';
};

const recordSellerOffence = async (
  sellerId: string,
  outcome: ORDER_OUTCOME,
): Promise<PenaltyResult | null> => {
  const immediateSuspension = outcome === ORDER_OUTCOME.COUNTERFEIT;
  const user = await User.findByIdAndUpdate(
    sellerId,
    {
      $inc: { sellerStrikes: 1 },
      ...(immediateSuspension
        ? {
            $set: {
              status: 'suspended',
              statusReason: 'Counterfeit item pending investigation',
            },
          }
        : {}),
    },
    { new: true },
  );
  if (!user) return null;

  if (
    !immediateSuspension &&
    user.sellerStrikes >=
      config.penaltyPolicy.sellerStrikeSuspensionThreshold &&
    user.status === 'active'
  ) {
    user.status = 'suspended';
    user.statusReason = 'Repeated seller policy offences pending review';
    await user.save();
  }

  return { count: user.sellerStrikes, status: user.status };
};

const recordMissedCollection = async (
  sellerId: string,
): Promise<PenaltyResult | null> => {
  const user = await User.findByIdAndUpdate(
    sellerId,
    { $inc: { missedCollections: 1 } },
    { new: true },
  );
  return user
    ? { count: user.missedCollections, status: user.status }
    : null;
};

const recordUnjustifiedBuyerRejection = async (
  buyerId: string,
): Promise<PenaltyResult | null> => {
  const user = await User.findByIdAndUpdate(
    buyerId,
    { $inc: { buyerUnjustifiedRejections: 1 } },
    { new: true },
  );
  if (!user) return null;

  if (
    user.buyerUnjustifiedRejections >=
      config.penaltyPolicy.buyerRejectionRestrictionThreshold &&
    user.status === 'active'
  ) {
    user.status = 'restricted';
    user.statusReason = 'Repeated order rejections without a valid reason';
    await user.save();
  }

  return { count: user.buyerUnjustifiedRejections, status: user.status };
};

export const UserPenaltyService = {
  recordSellerOffence,
  recordMissedCollection,
  recordUnjustifiedBuyerRejection,
};
