import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'transaction_logs', schema: 'reservation', timestamps: false })
export class TransactionLogModel extends Model {
  @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER }) id: number;
  @Column({ field: 'booking_id', type: DataType.INTEGER }) bookingId: number;
  @Column({ field: 'user_id', type: DataType.INTEGER }) userId: number;
  @Column(DataType.STRING) type: string;
  @Column(DataType.FLOAT) amount: number;
  @Column(DataType.TEXT) details: string;
  @Column({ field: 'created_at', type: DataType.DATE }) createdAt: Date;
  @Column({ field: 'updated_at', type: DataType.DATE }) updatedAt: Date;
}
