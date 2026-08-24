import { cache } from '../../../helpers/cache';
import { socketHelper } from '../../../helpers/socketHelper';
import { IProductStatus } from './product.interface';

export const PRODUCT_LIST_CACHE_PREFIX = 'products:list:';
export const PRODUCT_STATUS_CHANGED_EVENT = 'product:status-changed';

export const invalidateProductListCache = () => {
  cache.flushPrefix(PRODUCT_LIST_CACHE_PREFIX);
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

  invalidateProductListCache();
  socketHelper.emitToAll(PRODUCT_STATUS_CHANGED_EVENT, {
    productId: change.productId,
    status: change.status,
    changedAt: new Date().toISOString(),
  });
  return result;
};
