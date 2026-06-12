import { Column, DataType, Model, Table, BeforeCreate } from 'sequelize-typescript';

function generateReference(): string {
  return `PKP-${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`;
}
function generateBarcode(): string {
  return `BC${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

/**
 * Maps to reservation.bookings — matches exact schema columns and UUID types.
 * No non-existent columns (cancelledAt, cancelReason, reminderSentAt removed).
 */
@Table({ tableName: 'bookings', schema: 'reservation', timestamps: true })
export class BookingModel extends Model {
  @Column({ primaryKey: true, type: DataType.UUID, defaultValue: DataType.UUIDV4 }) id: string;

  // FK columns (UUID)
  @Column({ field: 'user_id',         type: DataType.UUID }) userId:        string;
  @Column({ field: 'vehicle_id',      type: DataType.UUID }) vehicleId:     string;
  @Column({ field: 'location_id',     type: DataType.UUID }) locationId:    string;
  @Column({ field: 'parking_slot_id', type: DataType.UUID }) parkingSlotId: string;

  // Core booking fields
  @Column(DataType.STRING) reference:     string;
  @Column(DataType.STRING) barcode:       string;
  @Column(DataType.STRING) spot:          string;
  @Column(DataType.DATEONLY) date:        string;
  @Column(DataType.STRING) timeSlot:      string;
  @Column(DataType.STRING) type:          string;
  @Column(DataType.FLOAT)  amount:        number;
  @Column(DataType.STRING) paymentMethod: string;
  @Column(DataType.STRING) paymentStatus: string;
  @Column(DataType.STRING) status:        string;

  // Check-in / check-out
  @Column(DataType.BOOLEAN) checkedInByTeller: boolean;
  @Column(DataType.DATE)    checkInAt:          Date;
  @Column(DataType.DATE)    checkOutAt:         Date;

  // Payment gateway
  @Column({ field: 'payment_session_id', type: DataType.STRING }) paymentSessionId: string;

  // Snapshot columns
  @Column(DataType.STRING) vehiclePlate:    string;
  @Column(DataType.STRING) vehicleType:     string;
  @Column(DataType.STRING) vehicleColor:    string;
  @Column(DataType.STRING) locationName:    string;
  @Column(DataType.STRING) locationAddress: string;

  // Timestamps
  @Column({ field: 'createdAt', type: DataType.DATE }) createdAt: Date;
  @Column({ field: 'updatedAt', type: DataType.DATE }) updatedAt: Date;

  @BeforeCreate
  static setDefaults(instance: BookingModel) {
    if (!instance.reference)     instance.reference     = generateReference();
    if (!instance.barcode)       instance.barcode       = generateBarcode();
    if (!instance.status)        instance.status        = 'upcoming';
    if (!instance.paymentStatus) instance.paymentStatus = 'pending';
  }
}
