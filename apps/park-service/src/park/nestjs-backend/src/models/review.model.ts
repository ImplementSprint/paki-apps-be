import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'reviews', schema: 'partner', timestamps: false })
export class ReviewModel extends Model {
  @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER }) id: number;
  @Column({ field: 'user_id', type: DataType.INTEGER }) userId: number;
  @Column({ field: 'location_id', type: DataType.INTEGER }) locationId: number;
  @Column({ field: 'booking_id', type: DataType.INTEGER }) bookingId: number;
  @Column(DataType.INTEGER) rating: number;
  @Column(DataType.TEXT) comment: string;
  @Column({ field: 'created_at', type: DataType.DATE }) createdAt: Date;
}
