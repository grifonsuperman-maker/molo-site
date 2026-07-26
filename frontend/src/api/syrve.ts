import { api } from './client';

export type SyrveIntegrationStatus = {
  id: string;
  displayName: string;
  apiBaseUrl: string;
  apiLoginMasked: string | null;
  hasCredentials: boolean;
  organizationId: string | null;
  organizationName: string | null;
  status: 'not_connected' | 'connected' | 'error';
  lastCheckedAt: string | null;
  connectedAt: string | null;
  lastError: string | null;
  syncEnabled: false;
};

export type SyrveOrganization = {
  id: string;
  name: string;
};

export type SyrveConnectionInput = {
  displayName: string;
  apiBaseUrl: string;
  apiLogin: string;
};

export const syrveApi = {
  getStatus: () => api.get<SyrveIntegrationStatus>('/syrve-integration'),
  test: (payload: SyrveConnectionInput) =>
    api.post<{
      message: string;
      apiBaseUrl: string;
      organizations: SyrveOrganization[];
    }>('/syrve-integration/test', payload),
  connect: (payload: SyrveConnectionInput & { organizationId: string; organizationName: string }) =>
    api.post<{ message: string; integration: SyrveIntegrationStatus }>(
      '/syrve-integration/connect',
      payload,
    ),
  recheck: () =>
    api.post<{ message: string; integration: SyrveIntegrationStatus }>(
      '/syrve-integration/recheck',
    ),
  disconnect: (reason?: string) =>
    api.post<{ message: string; integration: SyrveIntegrationStatus }>(
      '/syrve-integration/disconnect',
      { reason },
    ),
};
