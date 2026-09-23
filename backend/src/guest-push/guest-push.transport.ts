import { Injectable } from '@nestjs/common';

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
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: WebPushSubscription,
    payload: string,
    options?: { TTL?: number },
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
    webPush.setVapidDetails(
      credentials.subject,
      credentials.publicKey,
      credentials.privateKey,
    );

    return webPush.sendNotification(subscription, payload, {
      TTL: 60 * 60,
    });
  }
}
