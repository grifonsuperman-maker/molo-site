import { Injectable } from '@nestjs/common';

import { assertSafeGuestPushDeliveryEndpoint } from './guest-push-endpoint';

type WebPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type GuestPushVapidCredentials = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

type WebPushResponse = {
  statusCode?: number;
};

type WebPushClient = {
  sendNotification(
    subscription: WebPushSubscription,
    payload: string,
    options?: {
      TTL?: number;
      timeout?: number;
      vapidDetails?: GuestPushVapidCredentials;
    },
  ): Promise<WebPushResponse>;
};

const webPush = require('web-push') as WebPushClient;

@Injectable()
export class GuestPushTransport {
  async send(
    subscription: WebPushSubscription,
    payload: string,
    credentials: GuestPushVapidCredentials,
  ) {
    await assertSafeGuestPushDeliveryEndpoint(subscription.endpoint);
    return webPush.sendNotification(subscription, payload, {
      TTL: 60 * 60,
      timeout: 5_000,
      vapidDetails: credentials,
    });
  }
}
