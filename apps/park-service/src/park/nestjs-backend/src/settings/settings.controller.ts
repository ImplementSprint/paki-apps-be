import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { SettingsModel } from '../models/settings.model';
import { ParkingRateModel } from '../models/parking-rate.model';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(
    @InjectModel(SettingsModel) private settingsModel: typeof SettingsModel,
    @InjectModel(ParkingRateModel) private rateModel: typeof ParkingRateModel,
  ) {}

  @Get(':category')
  @Roles('admin')
  async getSettings(@Param('category') category: string) {
    try {
      const settings = await this.settingsModel.findAll({ where: { category } });
      const result: Record<string, any> = {};
      settings.forEach((s) => { result[(s as any).key] = (s as any).value; });
      return { success: true, data: result };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Put(':category')
  @Roles('admin')
  async updateSettings(@Param('category') category: string, @Body() body: any) {
    try {
      for (const [key, value] of Object.entries(body)) {
        await this.settingsModel.upsert({ key, value: String(value), category } as any);
      }
      return { success: true, message: 'Settings updated' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('parking-rates')
  async getParkingRates() {
    try {
      const rates = await this.rateModel.findAll({ order: [['type', 'ASC']] });
      return { success: true, data: rates.map((r) => r.toJSON()) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Put('parking-rates/:id')
  @Roles('admin')
  async updateParkingRate(@Param('id') id: string, @Body() body: any) {
    try {
      const rate = await this.rateModel.findByPk(parseInt(id));
      if (!rate) return { success: false, message: 'Rate not found' };
      await rate.update(body);
      return { success: true, data: rate.toJSON() };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('admin-users')
  @Roles('admin')
  async getAdminUsers() {
    try {
      const [rows]: [any[], unknown] = await (this.settingsModel.sequelize as any).query(
        `SELECT ap.id, ap.full_name, ap.email, ap.role, ap.is_verified,
                aa.admin_role, aa.is_active, aa.permissions
         FROM account.profiles ap
         INNER JOIN account.admin_accounts aa ON aa.profile_id = ap.id
         ORDER BY aa.admin_role`,
      );
      return { success: true, data: rows };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
