export class SaveLayoutTableDto {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  tableNumber?: string;
  seats?: number;
  shape?: string;
  isVisible?: boolean;
}

export class SaveLayoutZoneDto {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  name?: string;
  color?: string;
  description?: string;
  isVisible?: boolean;
  isClosed?: boolean;
}

export class SaveLayoutObjectDto {
  id: string;
  objectType?: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  color?: string;
  isVisible?: boolean;
}

export class SaveLayoutDto {
  tables?: SaveLayoutTableDto[];
  zones?: SaveLayoutZoneDto[];
  objects?: SaveLayoutObjectDto[];
}
