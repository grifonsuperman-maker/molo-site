import type { FullMapResponse, Restaurant } from '../../api/types';

export function getRestaurantFromResponse(value: unknown): Restaurant | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as { data?: Restaurant } | Restaurant;
  return 'data' in data && data.data ? data.data : (data as Restaurant);
}

export function getMapFromResponse(value: unknown): FullMapResponse | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as { data?: FullMapResponse } | FullMapResponse;
  return 'data' in data && data.data ? data.data : (data as FullMapResponse);
}
