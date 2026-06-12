import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';

import { CommonModule }       from './common/common.module';
import { SmsModule }          from './sms/sms.module';
import { EmailModule }        from './email/email.module';
import { PaymentModule }      from './payment/payment.module';
import { LogModule }          from './logs/log.module';
import { NotificationModule } from './notification/notification.module';
import { JwtAuthGuard }       from './common/jwt-auth.guard';

import { AuthModule }          from './auth/auth.module';
import { BookingModule }       from './booking/booking.module';
import { LocationModule }      from './location/location.module';
import { UserModule }          from './user/user.module';
import { VehicleModule }       from './vehicle/vehicle.module';
import { ParkingSlotModule }   from './parking-slot/parking-slot.module';
import { AnalyticsModule }     from './analytics/analytics.module';
import { SettingsModule }      from './settings/settings.module';
import { UploadModule }        from './upload/upload.module';
import { ReviewModule }        from './review/review.module';
import { PaymentMethodModule } from './payment-method/payment-method.module';
import { SchedulerModule }     from './scheduler/scheduler.module';
import { HealthModule }        from './health/health.module';

// ── Models registered globally with Sequelize ──────────────────────────────
// Only models with confirmed table/schema mappings. All point to non-public schemas.
import { BookingModel }      from './models/booking.model';      // reservation.bookings
import { LocationModel }     from './models/location.model';     // parking_lot.locations
import { UserModel }         from './models/user.model';         // account.profiles
import { VehicleModel }      from './models/vehicle.model';      // teller.vehicles
import { ParkingSlotModel }  from './models/parking-slot.model'; // parking_lot.parking_slots
import { ReviewModel }       from './models/review.model';       // partner.reviews
import { SettingsModel }     from './models/settings.model';     // teller.settings
import { ParkingRateModel }  from './models/parking-rate.model'; // parking_lot.parking_rates
import { UploadModel }       from './models/upload.model';       // teller.uploads
import { PaymentMethodModel } from './models/payment-method.model'; // payment.payment_transactions

// NOTE: NotificationModel, TransactionLogModel, ActivityLogModel are intentionally
// excluded — their services use raw SQL queries directly, avoiding ORM model mismatches.

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => {
        const dbUrl = cfg.get<string>('DATABASE_URL') || '';
        return {
          dialect: 'postgres',
          uri:     dbUrl || undefined,
          logging: cfg.get('NODE_ENV') === 'development' ? console.log : false,
          dialectOptions: dbUrl ? { ssl: { require: true, rejectUnauthorized: false } } : {},
          pool: { max: 10, min: 2, acquire: 30_000, idle: 10_000 },
          models: [
            BookingModel, LocationModel, UserModel, VehicleModel,
            ParkingSlotModel, ReviewModel, SettingsModel,
            ParkingRateModel, UploadModel, PaymentMethodModel,
          ],
          autoLoadModels: false,
          synchronize:    false,
        };
      },
      inject: [ConfigService],
    }),

    // Global utility modules (load before feature modules)
    CommonModule,
    SmsModule,
    EmailModule,
    PaymentModule,
    LogModule,
    NotificationModule,

    // Feature modules
    AuthModule,
    BookingModule,
    LocationModule,
    UserModule,
    VehicleModule,
    ParkingSlotModule,
    AnalyticsModule,
    SettingsModule,
    UploadModule,
    ReviewModule,
    PaymentMethodModule,
    SchedulerModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
