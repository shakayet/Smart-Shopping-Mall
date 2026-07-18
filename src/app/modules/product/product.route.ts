import express, { NextFunction, Request, Response } from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import fileUploadHandler from '../../middlewares/fileUploadHandler';
import validateRequest from '../../middlewares/validateRequest';
import { ProductController } from './product.controller';
import { ProductValidation } from './product.validation';

const router = express.Router();

router
  .route('/')
  .get(ProductController.getAllProducts)
  .post(
    auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        let productData;

        // Handle both cases: JSON in data field or individual form fields
        if (req.body.data) {
          productData = JSON.parse(req.body.data);
        } else {
          // If price is a string from form data, convert to number
          productData = {
            ...req.body,
            price: req.body.price ? Number(req.body.price) : undefined,
          };
        }

        // Validate the data
        const validatedData = ProductValidation.createProductZodSchema.parse({
          body: productData,
        }).body;

        req.body = validatedData;
        return ProductController.createProduct(req, res, next);
      } catch (error) {
        next(error);
      }
    },
  );

router
  .route('/:id')
  .get(ProductController.getProductDetails)
  .patch(
    auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    validateRequest(ProductValidation.updateProductZodSchema),
    ProductController.updateProduct,
  )
  .delete(
    auth(USER_ROLES.USER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    ProductController.deleteProduct,
  );

export const ProductRoutes = router;
