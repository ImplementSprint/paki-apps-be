import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * Maps to parking_lot.parking_rates — canonical schema.
 * UUID types.
 */
@Table({ tableName: 'parking_rates', schema: 'parking_lot', timestamps: false })
export class ParkingRateModel extends Model {
  @Column({ primaryKey: true, type: DataType.UUID, defaultValue: DataType.UUIDV4 }) id: string;
  @Column({ field: 'location_id', type: DataType.UUID }) locationId: string;
  @Column(DataType.STRING) type: string;
  @Column(DataType.FLOAT)  rate: number;
  @Column({ field: 'createdAt', type: DataType.DATE }) createdAt: Date;
  @Column({ field: 'updatedAt', type: DataType.DATE }) updatedAt: Date;
}
