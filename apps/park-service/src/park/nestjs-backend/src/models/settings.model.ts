import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'settings', schema: 'teller', timestamps: false })
export class SettingsModel extends Model {
  @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER }) id: number;
  @Column(DataType.STRING) key: string;
  @Column(DataType.TEXT) value: string;
  @Column({ field: 'updated_at', type: DataType.DATE }) updatedAt: Date;
}
