import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SessionAuthGuard } from "../common/session/session-auth.guard";
import type { SessionPayload } from "../common/session/session.types";
import { CustomerFeedbackService } from "./customer-feedback.service";

function getSessionUser(request: Request) {
  return (request as Request & { user: SessionPayload }).user;
}

@Controller("customer/feedback")
@UseGuards(SessionAuthGuard)
export class CustomerFeedbackController {
  constructor(private readonly customerFeedbackService: CustomerFeedbackService) {}

  @Get("my-reviews")
  getMyReviews(@Req() request: Request) {
    return this.customerFeedbackService.getMyReviews(getSessionUser(request));
  }

  @Post()
  submitFeedback(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.customerFeedbackService.submitFeedback(getSessionUser(request), {
      trackingNumber: String(body.trackingNumber ?? ""),
      rating: Number(body.rating ?? 0),
      review: body.review !== undefined ? String(body.review ?? "") : undefined,
      tags: Array.isArray(body.tags) ? body.tags.map((value) => String(value)) : undefined,
    });
  }
}
