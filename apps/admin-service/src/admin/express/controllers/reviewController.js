'use strict';
/**
 * reviewController.js
 * ===================
 * Reads use snapshot columns (userName, userAvatar, locationName).
 * No JOIN on User or Location.
 */

const { QueryTypes } = require('sequelize');
const { sequelize }  = require('../config/db');
const { Review, User, Location } = require('../models/index');
const { formatReview } = require('../utils/formatters');

// POST /api/reviews
const createReview = async (req, res) => {
  try {
    const { locationId } = req.body;

    // Fetch snapshots (2 PK lookups — no JOIN on reads later)
    const [user, location] = await Promise.all([
      User.findByPk(req.user.id, { attributes: ['id', 'name', 'profilePicture'] }),
      locationId
        ? Location.findByPk(parseInt(locationId), { attributes: ['id', 'name'] })
        : Promise.resolve(null),
    ]);

    const review = await Review.create({
      userId: req.user.id,
      ...req.body,
      // Snapshots
      userName:     user?.name           || null,
      userAvatar:   user?.profilePicture || null,
      locationName: location?.name       || null,
    });

    res.status(201).json({ success: true, data: formatReview(review.toJSON()) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/reviews
const getReviews = async (req, res) => {
  try {
    const { locationId, page = 1, limit = 20 } = req.query;
    const where = {};
    if (locationId) where.locationId = parseInt(locationId);

    const { rows: reviews, count: total } = await Review.findAndCountAll({
      where,
      order:    [['createdAt', 'DESC']],
      limit:    parseInt(limit),
      offset:   (parseInt(page) - 1) * parseInt(limit),
      raw:      true,   // snapshot columns only — no JOIN
    });

    res.json({
      success: true,
      data: {
        reviews:    reviews.map(formatReview),
        total,
        page:       parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/reviews/stats
const getReviewStats = async (req, res) => {
  try {
    const [stats] = await sequelize.query(
      `SELECT
         ROUND(AVG(rating)::numeric, 2)::float            AS "averageRating",
         COUNT(*)::int                                     AS "totalReviews",
         SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END)::int AS "fiveStars",
         SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END)::int AS "fourStars",
         SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END)::int AS "threeStars",
         SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END)::int AS "twoStars",
         SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END)::int AS "oneStar"
       FROM reviews`,
      { type: QueryTypes.SELECT }
    );
    res.json({ success: true, data: stats || { averageRating: 0, totalReviews: 0 } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { createReview, getReviews, getReviewStats };
