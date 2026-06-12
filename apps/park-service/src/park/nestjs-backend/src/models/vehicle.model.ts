import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * Maps to teller.vehicles — matches exact schema columns and UUID types.
 */
@Table({ tableName: 'vehicles', schema: 'teller', timestamps: true })
export class VehicleModel extends Model {
  @Column({ primaryKey: true, type: DataType.UUID, defaultValue: DataType.UUIDV4 }) id: string;
  @Column({ field: 'user_id', type: DataType.UUID }) userId: string;
  @Column(DataType.STRING) brand: string;
  @Column(DataType.STRING) model: string;
  @Column(DataType.STRING) color: string;
  @Column({ field: 'plate_number', type: DataType.STRING }) plateNumber: string;
  @Column(DataType.STRING) type: string;
  @Column({ field: 'or_doc', type: DataType.STRING }) orDoc: string;
  @Column({ field: 'cr_doc', type: DataType.STRING }) crDoc: string;
  @Column({ field: 'is_default', type: DataType.BOOLEAN }) isDefault: boolean;
  @Column({ field: 'created_at', type: DataType.DATE }) createdAt: Date;
  @Column({ field: 'updated_at', type: DataType.DATE }) updatedAt: Date;
}
