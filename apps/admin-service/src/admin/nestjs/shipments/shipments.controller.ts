import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';

import { ListShipmentsDto } from './dto/list-shipments.dto';
import { UpdateShipmentStatusDto } from './dto/update-shipment-status.dto';
import { ShipmentsService } from './shipments.service';

@Controller('pakiship/shipments')
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Get()
  findAll(@Query() query: ListShipmentsDto) {
    return this.shipmentsService.findAll(query);
  }

  @Get('drivers')
  async getDrivers() {
    return {
      data: await this.shipmentsService.getDrivers(),
    };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shipmentsService.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateShipmentStatusDto) {
    return this.shipmentsService.updateStatus(id, dto);
  }
}
