const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/authController');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/requireAuth');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.use(authLimiter);

router.post('/register', validate.authBody.register, authController.register);
router.post('/login',    validate.authBody.login,    authController.login);
router.post('/refresh',  authController.refresh);
router.post('/logout',   authController.logout);
router.get('/me',        requireAuth, authController.me);

module.exports = router;
