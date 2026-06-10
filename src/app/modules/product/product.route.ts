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
      if (req.body.data) {
        req.body = ProductValidation.createProductZodSchema.parse({
          body: JSON.parse(req.body.data),
        }).body;
      }
      return ProductController.createProduct(req, res, next);
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
