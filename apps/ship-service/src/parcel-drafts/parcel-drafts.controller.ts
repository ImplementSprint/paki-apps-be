import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import type { SessionPayload } from "../common/session/session.types";
import { SessionAuthGuard } from "../common/session/session-auth.guard";
import { ParcelDraftsService } from "./parcel-drafts.service";

function getSessionUser(request: Request) {
  return (request as Request & { user: SessionPayload }).user;
}

@Controller("parcel-drafts")
@UseGuards(SessionAuthGuard)
export class ParcelDraftsController {
  constructor(private readonly parcelDraftsService: ParcelDraftsService) {}

  @Post("estimate-route")
  estimateRoute(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.parcelDraftsService.estimateRoute(
      getSessionUser(request),
      body,
    );
  }

  @Post("get-route")
  getRoute(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.parcelDraftsService.getRoute(getSessionUser(request), body);
  }

  @Post("reverse-geocode")
  reverseGeocode(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.parcelDraftsService.reverseGeocode(getSessionUser(request), body);
  }

  @Get("maps/autocomplete")
  autocompleteLocation(@Req() request: Request, @Query("query") query = "") {
    return this.parcelDraftsService.autocompleteLocation(
      getSessionUser(request),
      query,
    );
  }

  @Get("maps/details")
  getPlaceDetails(@Req() request: Request, @Query("placeId") placeId = "") {
    return this.parcelDraftsService.getPlaceDetails(getSessionUser(request), placeId);
  }

  @Get("hubs")
  getAvailableHubs(@Req() request: Request) {
    return this.parcelDraftsService.getAvailableHubs(getSessionUser(request));
  }

  @Post("pakishare/preview")
  previewRelayHubs(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.parcelDraftsService.previewRelayHubs(getSessionUser(request), body);
  }

  @Post("step-1")
  saveStepOne(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.parcelDraftsService.saveRouteDetails(
      getSessionUser(request),
      body,
    );
  }

  @Get("track/:trackingNumber")
  getTrackingDetails(
    @Req() request: Request,
    @Param("trackingNumber") trackingNumber: string,
  ) {
    return this.parcelDraftsService.getTrackingDetails(
      getSessionUser(request),
      trackingNumber,
    );
  }

  @Get("history")
  getHistory(@Req() request: Request) {
    return this.parcelDraftsService.getHistory(getSessionUser(request));
  }

  @Get("history/:trackingNumber")
  getHistoryDetails(
    @Req() request: Request,
    @Param("trackingNumber") trackingNumber: string,
  ) {
    return this.parcelDraftsService.getHistoryDetails(
      getSessionUser(request),
      trackingNumber,
    );
  }

  @Get(":draftId")
  getDraft(
    @Req() request: Request,
    @Param("draftId") draftId: string,
    @Query("itemsLimit") itemsLimit?: string,
  ) {
    const parsedLimit = Number(itemsLimit ?? "");
    return this.parcelDraftsService.getDraftDetails(
      getSessionUser(request),
      draftId,
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @Get(":draftId/items")
  getDraftItems(
    @Req() request: Request,
    @Param("draftId") draftId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const parsedLimit = Number(limit ?? "");
    const parsedOffset = Number(offset ?? "");

    return this.parcelDraftsService.getDraftItemsPage(
      getSessionUser(request),
      draftId,
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      Number.isFinite(parsedOffset) ? parsedOffset : undefined,
    );
  }

  @Post(":draftId/items")
  addDraftItems(
    @Req() request: Request,
    @Param("draftId") draftId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.parcelDraftsService.addDraftItems(
      getSessionUser(request),
      draftId,
      body,
    );
  }

  @Patch(":draftId/items/:itemId")
  updateDraftItem(
    @Req() request: Request,
    @Param("draftId") draftId: string,
    @Param("itemId") itemId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.parcelDraftsService.updateDraftItem(
      getSessionUser(request),
      draftId,
      itemId,
      body,
    );
  }

  @Delete(":draftId/items/:itemId")
  removeDraftItem(
    @Req() request: Request,
    @Param("draftId") draftId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.parcelDraftsService.removeDraftItem(
      getSessionUser(request),
      draftId,
      itemId,
    );
  }

  @Post(":draftId/service")
  selectService(
    @Req() request: Request,
    @Param("draftId") draftId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.parcelDraftsService.selectDraftService(
      getSessionUser(request),
      draftId,
      body,
    );
  }

  @Post(":draftId/booking")
  completeBooking(
    @Req() request: Request,
    @Param("draftId") draftId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.parcelDraftsService.completeBooking(
      getSessionUser(request),
      draftId,
      body,
    );
  }
}
