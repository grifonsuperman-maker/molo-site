export type SyrveWebhookSettingsSummary = {
  settingsReadAccess: 'confirmed';
  settingsWriteAccess: 'not_checked';
  webhookAddressSet: boolean;
  authorizationSet: boolean;
  settingsChanged: false;
  statusesApplied: false;
};

export function summarizeSyrveWebhookSettings(value: unknown): SyrveWebhookSettingsSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid webhook settings');
  const settings = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const nullableString = (input: unknown) => input === null || typeof input === 'string';
  if (typeof settings.correlationId !== 'string' || !uuid.test(settings.correlationId)
    || !nullableString(settings.apiLoginName) || !nullableString(settings.webHooksUri)
    || (settings.authToken !== undefined && !nullableString(settings.authToken))) {
    throw new Error('Invalid webhook settings');
  }
  // URLs may contain credentials, and authToken is a secret. Neither the raw
  // response nor any strings from it enter the durable operation result.
  return {
    settingsReadAccess: 'confirmed', settingsWriteAccess: 'not_checked',
    webhookAddressSet: typeof settings.webHooksUri === 'string' && settings.webHooksUri.trim().length > 0,
    authorizationSet: typeof settings.authToken === 'string' && settings.authToken.trim().length > 0,
    settingsChanged: false, statusesApplied: false,
  };
}
