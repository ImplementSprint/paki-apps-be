import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * Maps to payment.payment_transactions
 * Replaces public.payment_methods — this is the canonical payment record table.
 * UUID types.
 */
@Table({ tableName: 'payment_transactions', schema: 'payment', timestamps: false })
export class PaymentMethodModel extends Model {
  @Column({ primaryKey: true, type: DataType.UUID, defaultValue: DataType.UUIDV4 }) id: string;
  @Column({ field: 'user_id',               type: DataType.UUID    }) userId:             string;
  @Column({ field: 'payment_method',        type: DataType.STRING  }) paymentMethod:      string;
  @Column({ field: 'amount',                type: DataType.FLOAT   }) amount:             number;
  @Column({ field: 'currency',              type: DataType.STRING  }) currency:           string;
  @Column({ field: 'status',                type: DataType.STRING  }) status:             string;
  @Column({ field: 'reference_id',          type: DataType.STRING  }) referenceId:        string;
  @Column({ field: 'gateway_transaction_id',type: DataType.STRING  }) gatewayTransactionId: string;
  @Column({ field: 'source_service',        type: DataType.STRING  }) sourceService:      string;
  @Column({ field: 'hold_id',               type: DataType.STRING  }) holdId:             string;
  @Column({ field: 'captured_at',           type: DataType.DATE    }) capturedAt:         Date;
  @Column({ field: 'refunded_at',           type: DataType.DATE    }) refundedAt:         Date;
  @Column({ field: 'created_at',            type: DataType.DATE    }) createdAt:          Date;
}
