const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { createReview, getReviews, getReviewStats } = require('../controllers/reviewController');

router.post('/', protect, createReview);
router.get('/', protect, getReviews);
router.get('/stats', protect, getReviewStats);

module.exports = router;
