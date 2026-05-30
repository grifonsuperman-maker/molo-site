import { api } from './client'; import type { FullMapResponse } from './types';
export const mapApi={ get:()=>api.get<FullMapResponse>('/constructor/map') };
