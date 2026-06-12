import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'activity_logs', schema: 'partner', timestamps: false })
export class ActivityLogModel extends Model {
  @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER }) id: number;
  @Column({ field: 'admin_id', type: DataType.INTEGER }) userId: number;
  @Column(DataType.STRING) action: string;
  @Column({ field: 'target_type', type: DataType.STRING }) entityType: string;
  @Column({ field: 'target_id', type: DataType.STRING }) entityId: string;
  @Column(DataType.TEXT) details: string;
  @Column({ field: 'created_at', type: DataType.DATE }) createdAt: Date;
}
