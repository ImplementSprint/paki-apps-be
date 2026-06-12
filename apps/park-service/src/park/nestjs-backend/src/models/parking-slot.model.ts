import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * Maps to parking_lot.parking_slots — canonical schema.
 * UUID types.
 */
@Table({ tableName: 'parking_slots', schema: 'parking_lot', timestamps: false })
export class ParkingSlotModel extends Model {
  @Column({ primaryKey: true, type: DataType.UUID, defaultValue: DataType.UUIDV4 }) id: string;
  @Column({ field: 'location_id', type: DataType.UUID }) locationId: string;
  @Column(DataType.STRING) label:   string;
  @Column(DataType.STRING) floor:   string;
  @Column(DataType.STRING) section: string;
  @Column(DataType.STRING) type:    string;
  @Column(DataType.STRING) status:  string;
}
