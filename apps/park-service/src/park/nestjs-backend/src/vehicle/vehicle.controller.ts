import { Controller, Get, Post, Put, Delete, Patch, Body, Param, Req, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { VehicleModel } from '../models/vehicle.model';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@Controller('vehicles')
@UseGuards(JwtAuthGuard)
export class VehicleController {
  constructor(@InjectModel(VehicleModel) private vehicleModel: typeof VehicleModel) {}

  @Get()
  async getMyVehicles(@Req() req: any) {
    try {
      const vehicles = await this.vehicleModel.findAll({ where: { userId: req.user.id }, order: [['isDefault', 'DESC'], ['createdAt', 'DESC']] });
      return { success: true, data: vehicles.map((v) => v.toJSON()) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Post()
  async addVehicle(@Req() req: any, @Body() body: any) {
    try {
      const count = await this.vehicleModel.count({ where: { userId: req.user.id } });
      const vehicle = await this.vehicleModel.create({ userId: req.user.id, ...body, isDefault: count === 0 });
      return { success: true, data: vehicle.toJSON() };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Put(':id')
  async updateVehicle(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    try {
      const vehicle = await this.vehicleModel.findOne({ where: { id: parseInt(id), userId: req.user.id } });
      if (!vehicle) return { success: false, message: 'Vehicle not found' };
      const { isDefault: _skip, ...safe } = body;
      await vehicle.update(safe);
      return { success: true, data: vehicle.toJSON() };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Delete(':id')
  async deleteVehicle(@Param('id') id: string, @Req() req: any) {
    try {
      const count = await this.vehicleModel.count({ where: { userId: req.user.id } });
      if (count <= 1) return { success: false, message: 'You must have at least one vehicle' };
      const vehicle = await this.vehicleModel.findOne({ where: { id: parseInt(id), userId: req.user.id } });
      if (!vehicle) return { success: false, message: 'Vehicle not found' };
      const wasDefault = vehicle.isDefault;
      await vehicle.destroy();
      if (wasDefault) {
        const next = await this.vehicleModel.findOne({ where: { userId: req.user.id }, order: [['createdAt', 'ASC']] });
        if (next) await next.update({ isDefault: true });
      }
      return { success: true, message: 'Vehicle deleted' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Patch(':id/default')
  async setDefault(@Param('id') id: string, @Req() req: any) {
    try {
      const vehicle = await this.vehicleModel.findOne({ where: { id: parseInt(id), userId: req.user.id } });
      if (!vehicle) return { success: false, message: 'Vehicle not found' };
      await this.vehicleModel.update({ isDefault: false } as any, { where: { userId: req.user.id } });
      await vehicle.update({ isDefault: true });
      return { success: true, data: vehicle.toJSON(), message: 'Default vehicle updated' };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
