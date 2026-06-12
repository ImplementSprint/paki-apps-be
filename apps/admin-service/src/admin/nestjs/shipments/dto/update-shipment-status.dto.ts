import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

import { SHIPMENT_STATUSES, type ShipmentStatus } from '../shipment-status';

export class UpdateShipmentStatusDto {
  @IsIn(SHIPMENT_STATUSES)
  status: ShipmentStatus;

  @IsString()
  @MinLength(3)
  reason: string;

  @IsOptional()
  @IsString()
  updatedBy?: string;
}
