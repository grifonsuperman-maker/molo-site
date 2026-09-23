import { lookup } from 'dns/promises';
import { BlockList, isIP } from 'net';

const NON_PUBLIC_PUSH_ADDRESSES = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC_PUSH_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  NON_PUBLIC_PUSH_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}

function matchesHostname(hostname: string, suffix: string) {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function isRecognizedGuestPushEndpoint(value: URL) {
  if (
    value.protocol !== 'https:' ||
    (value.port && value.port !== '443') ||
    Boolean(value.username) ||
    Boolean(value.password) ||
    Boolean(value.hash)
  ) {
    return false;
  }

  const hostname = value.hostname.toLowerCase();
  return (
    hostname === 'fcm.googleapis.com' ||
    hostname === 'android.googleapis.com' ||
    matchesHostname(hostname, 'push.apple.com') ||
    matchesHostname(hostname, 'push.services.mozilla.com') ||
    matchesHostname(hostname, 'push.services.mozaws.net') ||
    matchesHostname(hostname, 'notify.windows.com')
  );
}

export function isPublicGuestPushAddress(address: string) {
  const family = isIP(address);
  if (family === 4) {
    return !NON_PUBLIC_PUSH_ADDRESSES.check(address, 'ipv4');
  }
  if (family === 6) {
    return !NON_PUBLIC_PUSH_ADDRESSES.check(address, 'ipv6');
  }
  return false;
}

async function lookupGuestPushAddresses(hostname: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Web Push DNS lookup timed out')),
          2_000,
        );
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function assertSafeGuestPushDeliveryEndpoint(endpoint: string) {
  const parsed = new URL(endpoint);
  if (!isRecognizedGuestPushEndpoint(parsed)) {
    throw new Error('Unrecognized Web Push endpoint');
  }

  const addresses = await lookupGuestPushAddresses(parsed.hostname);
  if (
    addresses.length === 0 ||
    addresses.some((entry) => !isPublicGuestPushAddress(entry.address))
  ) {
    throw new Error('Web Push endpoint resolved to a non-public address');
  }
}
