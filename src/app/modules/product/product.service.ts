/* eslint-disable @typescript-eslint/no-explicit-any */
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import QueryBuilder from '../../builder/QueryBuilder';
import { IProduct } from './product.interface';
import { Product } from './product.model';
import { uploadToS3, deleteFromS3 } from '../../../helpers/s3Helper';
import { cache } from '../../../helpers/cache';
import fs from 'fs';
import { ConnectService } from '../payment/connect.service';

export const PRODUCT_LIST_CACHE_PREFIX = 'products:list:';
const PRODUCT_LIST_CACHE_TTL_MS = 60 * 1000;

const createProductToDB = async (
  payload: Partial<IProduct>,
  files: any
) => {
  await ConnectService.assertPayoutReady(String(payload.seller));

  const imageFiles = files?.image ?? [];
  if (imageFiles.length < 1 || imageFiles.length > 4) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'A product requires between 1 and 4 images',
    );
  }

  // Generate unique orderId
  const lastProduct = await Product.findOne().sort({ orderId: -1 });
  const nextOrderId = lastProduct ? lastProduct.orderId + 1 : 1000; // Start from 1000 if no products exist
  payload.orderId = nextOrderId;

  // Upload to S3
  const imageUrls: string[] = [];
  try {
    for (const imageFile of imageFiles) {
      imageUrls.push(await uploadToS3(imageFile, 'product-images'));
    }
  } catch (error) {
    await Promise.all(
      imageUrls.map(url => deleteFromS3(url).catch(() => undefined)),
    );
    throw error;
  } finally {
    await Promise.all(
      imageFiles.map((file: any) =>
        fs.promises.unlink(file.path).catch(() => undefined),
      ),
    );
  }

  payload.images = imageUrls;
  delete payload.image;
  payload.status = 'available';

  // Handle proof of purchase if provided
  if (files?.doc) {
    let proofUrl: string;
    try {
      proofUrl = await uploadToS3(files.doc[0], 'product-proofs');
    } finally {
      await fs.promises.unlink(files.doc[0].path).catch(() => undefined);
    }
    payload.proofOfPurchase = proofUrl;
  }

  const created = await Product.create(payload);
  const result = await Product.findById(created._id).populate(
    'seller',
    'name image avatar contact location country',
  );
  cache.flushPrefix(PRODUCT_LIST_CACHE_PREFIX);
  return toPublicProduct(result);
};

const toPublicProduct = (product: any) => {
  if (!product) return product;
  const value = typeof product.toJSON === 'function' ? product.toJSON() : product;
  value.originalPackagingAvailable = Boolean(
    value.originalPackagingAvailable,
  );
  value.proofOfPurchase = value.proofOfPurchase || null;
  if (value.seller && typeof value.seller === 'object') {
    const { _id, name, avatar, image, contact } = value.seller;
    let { location, country } = value.seller;
    // Keep legacy "City, Country" profiles compatible while new profiles
    // persist the two values independently.
    if (!country && typeof location === 'string' && location.includes(',')) {
      const locationParts = location.split(',').map((part: string) => part.trim());
      country = locationParts.pop() || null;
      location = locationParts.join(', ');
    }
    value.seller = {
      _id,
      name,
      profileImage: avatar || image || null,
      contact,
      location,
      country: country || null,
    };
  }
  return value;
};

const getAllProductsFromDB = async (query: Record<string, unknown>) => {
  // Only show items still available for sale unless a specific status is requested
  const queryWithDefaults = { status: 'available', ...query };

  type ProductListResponse = {
    result: IProduct[];
    meta: { total: number; limit: number; page: number; totalPage: number };
  };

  const cacheKey =
    PRODUCT_LIST_CACHE_PREFIX + JSON.stringify(queryWithDefaults);
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
    productQuery.modelQuery.populate(
      'seller',
      'name image avatar contact location country',
    ),
    productQuery.getPaginationInfo(),
  ]);

  const response = { result: result.map(toPublicProduct), meta };
  cache.set(cacheKey, response, PRODUCT_LIST_CACHE_TTL_MS);

  return response;
};

const getAllProductsForAdmin = async (query: Record<string, unknown>) => {
  const productQuery = new QueryBuilder(Product.find(), query)
    .search(['name', 'brand', 'description'])
    .filter()
    .sort()
    .paginate()
    .fields();

  const [result, meta] = await Promise.all([
    productQuery.modelQuery.populate(
      'seller',
      'name image avatar contact location country',
    ),
    productQuery.getPaginationInfo(),
  ]);

  return { result: result.map(toPublicProduct), meta };
};

const getProductDetailsFromDB = async (id: string) => {
  const result = await Product.findById(id).populate(
    'seller',
    'name image avatar contact location country',
  );
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
  }
  return toPublicProduct(result);
};

const updateProductToDB = async (
  id: string,
  userId: string,
  userRole: string,
  payload: Partial<IProduct>,
) => {
  const product = await Product.findById(id);
  if (!product) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
  }

  // Only seller or admin can update
  if (
    userRole !== 'ADMIN' &&
    userRole !== 'SUPER_ADMIN' &&
    product.seller.toString() !== userId
  ) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'You do not have permission to update this product',
    );
  }

  const result = await Product.findByIdAndUpdate(id, payload, { new: true });
  cache.flushPrefix(PRODUCT_LIST_CACHE_PREFIX);
  return result;
};

const deleteProductFromDB = async (
  id: string,
  userId: string,
  userRole: string,
) => {
  const product = await Product.findById(id);
  if (!product) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found');
  }

  // Only seller or admin can delete
  if (
    userRole !== 'ADMIN' &&
    userRole !== 'SUPER_ADMIN' &&
    product.seller.toString() !== userId
  ) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'You do not have permission to delete this product',
    );
  }

  // Delete images from S3
  const deletePromises = [];
  const productImages = product.images?.length
    ? product.images
    : product.image
      ? [product.image]
      : [];
  deletePromises.push(...productImages.map(image => deleteFromS3(image)));
  if (product.proofOfPurchase) {
    deletePromises.push(deleteFromS3(product.proofOfPurchase));
  }
  await Promise.all(deletePromises);

  const result = await Product.findByIdAndDelete(id);
  cache.flushPrefix(PRODUCT_LIST_CACHE_PREFIX);
  return result;
};

export const ProductService = {
  createProductToDB,
  getAllProductsFromDB,
  getAllProductsForAdmin,
  getProductDetailsFromDB,
  updateProductToDB,
  deleteProductFromDB,
};
