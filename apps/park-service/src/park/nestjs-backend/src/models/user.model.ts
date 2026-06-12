import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * Maps to account.profiles
 * PK = Supabase auth UUID (string), not an integer.
 */
@Table({ tableName: 'profiles', schema: 'account', timestamps: false })
export class UserModel extends Model {
  @Column({ primaryKey: true, type: DataType.UUID }) id: string; // Supabase auth UUID

  @Column({ field: 'full_name',    type: DataType.STRING }) fullName:    string;
  @Column({ field: 'email',        type: DataType.STRING }) email:       string;
  @Column({ field: 'phone',        type: DataType.STRING }) phone:       string;
  @Column({ field: 'dob',          type: DataType.STRING }) dob:         string;
  @Column({ field: 'role',         type: DataType.STRING }) role:        string;
  @Column({ field: 'address',      type: DataType.STRING }) address:     string;
  @Column({ field: 'city',         type: DataType.STRING }) city:        string;
  @Column({ field: 'province',     type: DataType.STRING }) province:    string;
  @Column({ field: 'profile_picture', type: DataType.STRING }) profilePicture: string;
  @Column({ field: 'is_verified',  type: DataType.BOOLEAN }) isVerified: boolean;
  @Column({ field: 'documents',    type: DataType.JSONB   }) documents:  object;
  @Column({ field: 'two_factor_enabled', type: DataType.BOOLEAN }) twoFactorEnabled: boolean;
  @Column({ field: 'notification_preferences', type: DataType.JSONB }) notificationPreferences: object;
  @Column({ field: 'created_at',   type: DataType.DATE    }) createdAt:  Date;

  // Convenience: split name → firstName / lastName on the fly
  get firstName(): string {
    const parts = (this.fullName || '').trim().split(/\s+/);
    if (parts.length > 1) {
      return parts.slice(0, -1).join(' ');
    }
    return parts[0] || '';
  }
  get lastName():  string {
    const parts = (this.fullName || '').trim().split(/\s+/);
    if (parts.length > 1) {
      return parts[parts.length - 1];
    }
    return '';
  }
  // Alias for code that references supabaseId
  get supabaseId(): string { return this.id; }
}
