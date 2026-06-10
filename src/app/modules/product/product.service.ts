import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import QueryBuilder from '../../builder/QueryBuilder';
import { IProduct } from './product.interface';
import { Product } from './product.model';
import { uploadToS3 } from '../../../helpers/s3Helper';
import fs from 'fs';

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
  return result;
};

const getAllProductsFromDB = async (query: Record<string, unknown>) => {
  // Only show items still available for sale unless a specific status is requested
  const queryWithDefaults = { status: 'available', ...query };

  const productQuery = new QueryBuilder(Product.find(), queryWithDefaults)
    .search(['name', 'brand', 'description'])
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await productQuery.modelQuery.populate('seller', 'name location contact');
  const meta = await productQuery.getPaginationInfo();

  return { result, meta };
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
  return result;
};

export const ProductService = {
  createProductToDB,
  getAllProductsFromDB,
  getProductDetailsFromDB,
  updateProductToDB,
  deleteProductFromDB,
};
