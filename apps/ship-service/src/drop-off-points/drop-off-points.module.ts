import { Module } from "@nestjs/common";
import { DropOffPointsController } from "./drop-off-points.controller";
import { DropOffPointsService } from "./drop-off-points.service";

@Module({
  controllers: [DropOffPointsController],
  providers: [DropOffPointsService],
  exports: [DropOffPointsService],
})
export class DropOffPointsModule {}
