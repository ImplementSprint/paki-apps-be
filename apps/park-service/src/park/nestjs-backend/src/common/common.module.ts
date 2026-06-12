import { Module, Global } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { SupabaseService } from './supabase.service';
import { ApiCenterService } from './api-center.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Global()
@Module({
  providers: [SupabaseService, ApiCenterService, JwtAuthGuard],
  exports: [SupabaseService, ApiCenterService, JwtAuthGuard],
})
export class CommonModule {}
