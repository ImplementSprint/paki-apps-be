import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'notifications', schema: 'notifications', timestamps: false })
export class NotificationModel extends Model {
  @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER }) id: number;
  @Column({ field: 'user_id', type: DataType.INTEGER }) userId: number;
  @Column(DataType.STRING) type: string;
  @Column(DataType.STRING) title: string;
  @Column(DataType.TEXT) message: string;
  @Column({ field: 'is_read', type: DataType.BOOLEAN, defaultValue: false }) isRead: boolean;
  @Column({ field: 'source_service', type: DataType.STRING }) sourceService: string;
  @Column({ field: 'created_at', type: DataType.DATE }) createdAt: Date;
}
