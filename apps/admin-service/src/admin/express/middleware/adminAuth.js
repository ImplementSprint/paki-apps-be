/**
 * Role-based route protection
 * Must be used after the `protect` middleware
 */
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.',
    });
  }
};

/**
 * Allow both admin and teller roles
 * Tellers can view bookings and perform check-ins
 */
const adminOrTeller = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'teller' || req.user.role === 'business_partner')) {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin or Teller privileges required.',
    });
  }
};

module.exports = { adminOnly, adminOrTeller };