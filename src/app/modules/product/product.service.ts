/* eslint-disable @typescript-eslint/no-explicit-any */
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import QueryBuilder from '../../builder/QueryBuilder';
import { IProduct } from './product.interface';
import { Product } from './product.model';
import { uploadToS3 } from '../../../helpers/s3Helper';
import { cache } from '../../../helpers/cache';
import fs from 'fs';

const PRODUCT_LIST_CACHE_PREFIX = 'products:list:';
const PRODUCT_LIST_CACHE_TTL_MS = 60 * 1000;

const createProductToDB = async (
  payload: Partial<IProduct>,
  files: any
) => {
  if (!files?.image || !files?.doc) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Product image and proof of purchase are required');
  }

  // Upload to S3
  const imageUrl = await uploadToS3(files.image[0], 'product-images');
  const proofUrl = await uploadToS3(files.doc[0], 'product-proofs');

  // Cleanup local files
  fs.unlinkSync(files.image[0].path);
  fs.unlinkSync(files.doc[0].path);

  payload.image = imageUrl;
  payload.proofOfPurchase = proofUrl;
  payload.status = 'available';

  const result = await Product.create(payload);
  cache.flushPrefix(PRODUCT_LIST_CACHE_PREFIX);
  return result;
};

const getAllProductsFromDB = async (query: Record<string, unknown>) => {
  // Only show items still available for sale unless a specific status is requested
  const queryWithDefaults = { status: 'available', ...query };

  type ProductListResponse = {
    result: IProduct[];
    meta: { total: number; limit: number; page: number; totalPage: number };
  };

  const cacheKey = PRODUCT_LIST_CACHE_PREFIX + JSON.stringify(queryWithDefaults);
  const cached = cache.get<ProductListResponse>(cacheKey);
  if (cached) {
    return cached;
  }

  const productQuery = new QueryBuilder(Product.find(), queryWithDefaults)
    .search(['name', 'brand', 'description'])
    .filter()
    .sort()
    .paginate()
    .fields();

  const [result, meta] = await Promise.all([
    productQuery.modelQuery.populate('seller', 'name location contact'),
    productQuery.getPaginationInfo(),
  ]);

  const response = { result, meta };
  cache.set(cacheKey, response, PRODUCT_LIST_CACHE_TTL_MS);

  return response;
};

const getProductDetailsFromDB = async (id: string) => {
  const result = await Product.findById(id).populate('seller', 'name location contact');
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
  }
  return result;
};

const updateProductToDB = async (
  id: string,
  userId: string,
  userRole: string,
  payload: Partial<IProduct>
) => {
  const product = await Product.findById(id);
  if (!product) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
  }

  // Only seller or admin can update
  if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN' && product.seller.toString() !== userId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'You do not have permission to update this product');
  }

  const result = await Product.findByIdAndUpdate(id, payload, { new: true });
  cache.flushPrefix(PRODUCT_LIST_CACHE_PREFIX);
  return result;
};

const deleteProductFromDB = async (id: string, userId: string, userRole: string) => {
  const product = await Product.findById(id);
  if (!product) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
  }

  // Only seller or admin can delete
  if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN' && product.seller.toString() !== userId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'You do not have permission to delete this product');
  }

  const result = await Product.findByIdAndDelete(id);
  cache.flushPrefix(PRODUCT_LIST_CACHE_PREFIX);
  return result;
};

export const ProductService = {
  createProductToDB,
  getAllProductsFromDB,
  getProductDetailsFromDB,
  updateProductToDB,
  deleteProductFromDB,
};
