import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import config from '../config';

let messaging: Messaging | null | undefined;

export const getFirebaseMessaging = (): Messaging | null => {
  if (messaging !== undefined) return messaging;
  if (!config.firebase.enabled) {
    messaging = null;
    return messaging;
  }

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: config.firebase.projectId,
        clientEmail: config.firebase.clientEmail,
        privateKey: config.firebase.privateKey,
      }),
    });
  messaging = getMessaging(app);
  return messaging;
};
