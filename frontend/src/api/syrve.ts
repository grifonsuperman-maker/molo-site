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
  configurationRevision: string | null;
  settingsPrepared: boolean;
  confirmedLinks: number;
  syncEnabled: false;
};

export type SyrveOrganization = {
  id: string;
  name: string;
};

export type SyrveReadiness = {
  syncEnabled: false;
  activationAvailable: false;
  configurationRevision: string | null;
  checkedAt: string;
  checks: { key: string; status: 'ok' | 'blocked' | 'not_checked'; code: string }[];
};

export type SyrveConnectionInput = {
  displayName: string;
  apiBaseUrl: string;
  apiLogin: string;
};

export type SyrveOrderCheckKey = 'connection' | 'terminalGroups' | 'restaurantSections'
  | 'posAvailability' | 'ordersByTable' | 'ordersById';
export type SyrveOrderDiagnostics = {
  configurationRevision: string;
  organizationId: string;
  startedAt: string;
  checkedAt: string;
  checks: { key: SyrveOrderCheckKey; status: 'ok' | 'error' | 'not_checked'; code: string | null }[];
  summary: {
    linkedTables: number; tablesWithOccupancy: number; unknownTables: number;
    terminalGroups: { alive: number; sleeping: number; offline: number; unknown: number };
  };
  posVersions: { read: { supported: number; unsupported: number; unknown: number };
    initialization: { supported: number; unsupported: number; unknown: number } };
  diagnostics: { complete: false; posOrderVisibility: 'not_verified'; posVersion: 'verified' | 'unsupported' | 'not_verified'; initializationPerformed: false };
  activationAvailable: false;
  syncEnabled: false;
  statusesApplied: false;
  renamingApplied: false;
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
  summary: { syrveTables: number; proposals: number; missingInMolo: number; missingInSyrve: number; conflicts: number; deletedTables: number; confirmedLinks: number };
  proposals: { moloTableId: string; moloTableNumber: string; syrveTableId: string; syrveTableNumber: number; sectionName: string }[];
  missingInMolo: SyrveCatalogTable[];
  missingInSyrve: { id: string; tableNumber: string }[];
  deletedTables: SyrveCatalogTable[];
  conflicts: { code: 'duplicate_syrve_id' | 'duplicate_syrve_number' | 'duplicate_molo_number'
    | 'unsupported_syrve_number' | 'unsupported_molo_number' | 'already_linked'; number: string | null; moloTableIds: string[]; syrveTableIds: string[] }[];
  diagnostics: { terminalGroups: { active: { id: string; name: string }[]; sleeping: { id: string; name: string }[] };
    sectionsCount: number; catalogScope: 'available_restaurant_sections'; orders: 'not_checked'; warnings: string[] };
  confirmedLinks: { moloTableId: string; syrveTableId: string; organizationId: string; moloTableNumber: string | null; lastKnownNumber: number }[];
  confirmation: { proof: string; expiresAt: string } | null;
  mappingConfirmationAvailable: boolean;
  syncEnabled: false;
};

export const syrveApi = {
  getStatus: () => api.get<SyrveIntegrationStatus>('/syrve-integration'),
  getReadiness: () => api.get<SyrveReadiness>('/syrve-integration/readiness'),
  orderDiagnostics: (configurationRevision: string) =>
    api.post<SyrveOrderDiagnostics>('/syrve-integration/orders-diagnostics', { configurationRevision }),
  test: (payload: SyrveConnectionInput) =>
    api.post<{
      message: string;
      apiBaseUrl: string;
      organizations: SyrveOrganization[];
    }>('/syrve-integration/test', payload),
  previewTables: (payload: SyrveConnectionInput & { organizationId: string }) =>
    api.post<SyrveCatalogPreview>('/syrve-integration/tables-preview', payload),
  connect: (payload: SyrveConnectionInput & { organizationId: string; organizationName: string; confirmationProof: string; pairs: { moloTableId: string; syrveTableId: string }[] }) =>
    api.post<{ message: string; confirmedPairs: number; integration: SyrveIntegrationStatus }>(
      '/syrve-integration/connect',
      payload,
    ),
  recheck: (configurationRevision: string) =>
    api.post<{ message: string; integration: SyrveIntegrationStatus }>(
      '/syrve-integration/recheck', { configurationRevision },
    ),
  disconnect: (configurationRevision: string, reason?: string) =>
    api.post<{ message: string; integration: SyrveIntegrationStatus }>(
      '/syrve-integration/disconnect',
      { configurationRevision, reason },
    ),
};
