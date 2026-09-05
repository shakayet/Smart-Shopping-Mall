import { cache } from '../../../helpers/cache';
import { socketHelper } from '../../../helpers/socketHelper';
import { IProductStatus } from './product.interface';

export const PRODUCT_LIST_CACHE_PREFIX = 'products:list:';
export const PRODUCT_DETAIL_CACHE_PREFIX = 'products:detail:';
export const PRODUCT_STATUS_CHANGED_EVENT = 'product:status-changed';
export const PRODUCT_WISHLIST_COUNT_CHANGED_EVENT =
  'product:wishlist-count-changed';

export const invalidateProductListCache = () => {
  cache.flushPrefix(PRODUCT_LIST_CACHE_PREFIX);
};

export const invalidateProductCaches = (productId?: string) => {
  invalidateProductListCache();
  if (productId) {
    cache.flushPrefix(`${PRODUCT_DETAIL_CACHE_PREFIX}${productId}`);
  }
};

type ProductStatusChange = {
  productId: string;
  status: IProductStatus;
};

/**
 * Commits a product mutation, then synchronizes every product-list cache and
 * authenticated real-time client from the same authoritative state change.
 */
export const synchronizeProductStatusMutation = async <T>(
  mutation: PromiseLike<T>,
  change: ProductStatusChange,
): Promise<T> => {
  const result = await mutation;
  if (!result) return result;

  invalidateProductCaches(change.productId);
  socketHelper.emitToAll(PRODUCT_STATUS_CHANGED_EVENT, {
    productId: change.productId,
    status: change.status,
    changedAt: new Date().toISOString(),
  });
  return result;
};

export const publishProductWishlistCount = (
  productId: string,
  wishlistCount: number,
) => {
  const normalizedCount = Math.max(0, Math.trunc(wishlistCount));
  invalidateProductCaches(productId);
  socketHelper.emitToAll(PRODUCT_WISHLIST_COUNT_CHANGED_EVENT, {
    productId,
    wishlistCount: normalizedCount,
    changedAt: new Date().toISOString(),
  });
};
