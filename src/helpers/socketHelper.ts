import colors from 'colors';
import { Secret } from 'jsonwebtoken';
import { Server } from 'socket.io';
import config from '../config';
import { jwtHelper } from './jwtHelper';
import { logger } from '../shared/logger';
import { User } from '../app/modules/user/user.model';

let socketServer: Server | undefined;

const userRoom = (userId: string) => `user:${userId}`;

const readSocketToken = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('Bearer ') ? trimmed.slice(7).trim() : trimmed;
};

const socket = (io: Server) => {
  socketServer = io;

  io.use(async (client, next) => {
    try {
      const token =
        readSocketToken(client.handshake.auth?.token) ??
        readSocketToken(client.handshake.headers.authorization);
      if (!token) return next(new Error('Authentication required'));

      const payload = jwtHelper.verifyToken(
        token,
        config.jwt.jwt_secret as Secret,
      );
      if (typeof payload.id !== 'string') {
        return next(new Error('Authentication failed'));
      }
      const eligibleUser = await User.exists({
        _id: payload.id,
        status: 'active',
        verified: true,
      });
      if (!eligibleUser) return next(new Error('Authentication failed'));

      client.data.userId = payload.id;
      return next();
    } catch (_error) {
      return next(new Error('Authentication failed'));
    }
  });

  io.on('connection', socket => {
    const userId = socket.data.userId as string;
    void socket.join(userRoom(userId));
    logger.info(colors.blue('A user connected'));

    //disconnect
    socket.on('disconnect', () => {
      logger.info(colors.red('A user disconnect'));
    });
  });
};

const emitToUser = (userId: string, event: string, payload: unknown) => {
  socketServer?.to(userRoom(userId)).emit(event, payload);
};

export const socketHelper = { socket, emitToUser };
