import express from 'express';
import { AuthRoutes } from '../app/modules/auth/auth.route';
import { UserRoutes } from '../app/modules/user/user.route';
import { OAuthRoutes } from '../app/modules/passport/oauth.route';
import { ProductRoutes } from '../app/modules/product/product.route';
import { WishlistRoutes } from '../app/modules/wishlist/wishlist.route';
import { OrderRoutes } from '../app/modules/order/order.route';
import { AIRoutes } from '../app/modules/ai/ai.route';
import { IssueRoutes } from '../app/modules/issue/issue.route';
const router = express.Router();

const apiRoutes = [
  {
    path: '/user',
    route: UserRoutes,
  },
  {
    path: '/auth',
    route: AuthRoutes,
  },
  {
    path: '/oauth',
    route: OAuthRoutes,
  },
  {
    path: '/products',
    route: ProductRoutes,
  },
  {
    path: '/wishlist',
    route: WishlistRoutes,
  },
  {
    path: '/orders',
    route: OrderRoutes,
  },
  {
    path: '/ai',
    route: AIRoutes,
  },
  {
    path: '/issues',
    route: IssueRoutes,
  },
];

apiRoutes.forEach(route => router.use(route.path, route.route));

export default router;
