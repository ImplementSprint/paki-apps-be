import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'uploads', schema: 'teller', timestamps: false })
export class UploadModel extends Model {
  @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER }) id: number;
  @Column({ field: 'user_id', type: DataType.INTEGER }) userId: number;
  @Column({ field: 'entity_type', type: DataType.STRING }) entityType: string;
  @Column({ field: 'entity_id', type: DataType.INTEGER }) entityId: number;
  @Column(DataType.TEXT) url: string;
  @Column({ field: 'created_at', type: DataType.DATE }) createdAt: Date;
}
