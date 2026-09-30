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

export type SyrveCatalogTable = {
  id: string;
  number: number;
  name: string;
  isDeleted: boolean;
  sectionId: string;
  sectionName: string;
  terminalGroupId: string;
};

export type SyrveCatalogPreview = {
  organization: SyrveOrganization;
  checkedAt: string;
  summary: { syrveTables: number; proposals: number; missingInMolo: number; missingInSyrve: number; conflicts: number; deletedTables: number };
  proposals: { moloTableId: string; moloTableNumber: string; syrveTableId: string; syrveTableNumber: number; sectionName: string }[];
  missingInMolo: SyrveCatalogTable[];
  missingInSyrve: { id: string; tableNumber: string }[];
  deletedTables: SyrveCatalogTable[];
  conflicts: { code: 'duplicate_syrve_id' | 'duplicate_syrve_number' | 'duplicate_molo_number'
    | 'unsupported_syrve_number' | 'unsupported_molo_number'; number: string | null; moloTableIds: string[]; syrveTableIds: string[] }[];
  diagnostics: { terminalGroups: { active: { id: string; name: string }[]; sleeping: { id: string; name: string }[] };
    sectionsCount: number; catalogScope: 'available_restaurant_sections'; orders: 'not_checked'; warnings: string[] };
  mappingConfirmationAvailable: false;
  syncEnabled: false;
};

export const syrveApi = {
  getStatus: () => api.get<SyrveIntegrationStatus>('/syrve-integration'),
  test: (payload: SyrveConnectionInput) =>
    api.post<{
      message: string;
      apiBaseUrl: string;
      organizations: SyrveOrganization[];
    }>('/syrve-integration/test', payload),
  previewTables: (payload: SyrveConnectionInput & { organizationId: string }) =>
    api.post<SyrveCatalogPreview>('/syrve-integration/tables-preview', payload),
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
