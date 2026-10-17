import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_WINDOW_MS = 60 * 1000;
const MAX_ADDRESSES = 200;

@Injectable()
export class DeveloperLoginThrottle {
  private readonly attempts = new Map<string, number[]>();
  private globalAttempts: number[] = [];

  // Reserve before bcrypt starts: concurrent requests count, including valid
  // logins. Untrusted forwarded headers are never used as limiter identities.
  reserve(address: string, now = Date.now()) {
    for (const [key, timestamps] of this.attempts) {
      const recent = timestamps.filter((time) => time > now - WINDOW_MS);
      if (recent.length) this.attempts.set(key, recent);
      else this.attempts.delete(key);
    }
    this.globalAttempts = this.globalAttempts.filter((time) => time > now - GLOBAL_WINDOW_MS);
    const recent = this.attempts.get(address) || [];
    if (recent.length >= 5 || this.globalAttempts.length >= 20 ||
        (!this.attempts.has(address) && this.attempts.size >= MAX_ADDRESSES)) {
      throw new HttpException('Забагато спроб входу. Спробуйте пізніше.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.attempts.set(address, [...recent, now]);
    this.globalAttempts.push(now);
  }
}
