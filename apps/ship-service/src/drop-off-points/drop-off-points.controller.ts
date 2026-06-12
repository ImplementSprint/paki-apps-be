import { Controller, Get, Query } from "@nestjs/common";
import { DropOffPointsService } from "./drop-off-points.service";

@Controller("drop-off-points")
export class DropOffPointsController {
  constructor(private readonly dropOffPointsService: DropOffPointsService) {}

  @Get()
  listNearby(@Query("query") query?: string) {
    return this.dropOffPointsService.listNearby(query);
  }
}
