import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * Maps to parking_lot.locations — canonical schema.
 * UUID primary key.
 */
@Table({ tableName: 'locations', schema: 'parking_lot', timestamps: false })
export class LocationModel extends Model {
  @Column({ primaryKey: true, type: DataType.UUID, defaultValue: DataType.UUIDV4 }) id: string;
  @Column(DataType.STRING)  name:            string;
  @Column(DataType.STRING)  address:         string;
  @Column(DataType.STRING)  status:          string;
  @Column({ field: 'is_active',       type: DataType.BOOLEAN }) isActive:       boolean;
  @Column({ field: 'total_spots',     type: DataType.INTEGER }) totalSpots:     number;
  @Column({ field: 'available_spots', type: DataType.INTEGER }) availableSpots: number;
  @Column({ field: 'image_url',       type: DataType.STRING  }) imageUrl:       string;
  @Column({ field: 'owner_id',        type: DataType.UUID    }) ownerId:        string;
  @Column({ field: 'pricePerHour',    type: DataType.FLOAT   }) pricePerHour:   number;
  @Column({ field: 'operatingHours',  type: DataType.JSONB   }) operatingHours: object;
  @Column(DataType.FLOAT) lat: number;
  @Column(DataType.FLOAT) lng: number;
  @Column(DataType.JSONB) amenities:   object;
  @Column(DataType.JSONB) coordinates: object;
  @Column({ field: 'created_at', type: DataType.DATE }) createdAt: Date;
  @Column({ field: 'updatedAt',  type: DataType.DATE }) updatedAt: Date;

  // Legacy alias used in guard RBAC
  get partnerUserId(): string { return this.ownerId; }
}
