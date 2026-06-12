import { Controller, Get, Post, Body, Query, Req, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';
import { ReviewModel } from '../models/review.model';
import { UserModel } from '../models/user.model';
import { LocationModel } from '../models/location.model';
import { formatReview } from '../common/formatters';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@Controller('reviews')
@UseGuards(JwtAuthGuard)
export class ReviewController {
  constructor(
    @InjectModel(ReviewModel) private reviewModel: typeof ReviewModel,
    @InjectModel(UserModel) private userModel: typeof UserModel,
    @InjectModel(LocationModel) private locationModel: typeof LocationModel,
    private sequelize: Sequelize,
  ) {}

  @Post()
  async createReview(@Req() req: any, @Body() body: any) {
    try {
      const { locationId } = body;
      const [user, location] = await Promise.all([
        this.userModel.findByPk(req.user.id, { attributes: ['id', 'name', 'profilePicture'] }),
        locationId ? this.locationModel.findByPk(parseInt(locationId), { attributes: ['id', 'name'] }) : Promise.resolve(null),
      ]);
      const review = await this.reviewModel.create({
        userId: req.user.id,
        ...body,
        userName: (user as any)?.name || null,
        userAvatar: (user as any)?.profilePicture || null,
        locationName: (location as any)?.name || null,
      });
      return { success: true, data: formatReview(review.toJSON()) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get()
  async getReviews(@Query('locationId') locationId: string, @Query('page') page = '1', @Query('limit') limit = '20') {
    try {
      const where: any = {};
      if (locationId) where.locationId = parseInt(locationId);
      const p = parseInt(page); const l = parseInt(limit);
      const { rows: reviews, count: total } = await this.reviewModel.findAndCountAll({
        where, order: [['createdAt', 'DESC']], limit: l, offset: (p - 1) * l, raw: true,
      });
      return { success: true, data: { reviews: reviews.map(formatReview), total, page: p, totalPages: Math.ceil(total / l) } };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('stats')
  async getReviewStats() {
    try {
      const [stats] = await this.sequelize.query(
        `SELECT ROUND(AVG(rating)::numeric, 2)::float AS "averageRating", COUNT(*)::int AS "totalReviews", SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END)::int AS "fiveStars", SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END)::int AS "fourStars", SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END)::int AS "threeStars", SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END)::int AS "twoStars", SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END)::int AS "oneStar" FROM reviews`,
        { type: QueryTypes.SELECT },
      );
      return { success: true, data: stats || { averageRating: 0, totalReviews: 0 } };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
