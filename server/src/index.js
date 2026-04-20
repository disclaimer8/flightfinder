// Load .env with override so PM2-cached env vars are replaced,
// but preserve NODE_ENV if already set (e.g. NODE_ENV=test in Jest).
const _savedNodeEnv = process.env.NODE_ENV;
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
if (_savedNodeEnv) process.env.NODE_ENV = _savedNodeEnv;

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 5000;
const IS_DEV = process.env.NODE_ENV !== 'production';

// Trust nginx reverse proxy (needed for express-rate-limit + X-Forwarded-For)
app.set('trust proxy', 1);

// ─────────────────────────────────────────
//  Security headers
// ─────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", 'https://www.googletagmanager.com', 'https://emrldtp.cc'], // gtag + Travelpayouts Drive loaders
      styleSrc:       ["'self'", "'unsafe-inline'"], // Leaflet sets style= attributes on DOM nodes
      imgSrc:         ["'self'", 'data:', 'https:'], // CartoDB map tiles (loaded as <img> by Leaflet)
      connectSrc:     ["'self'", 'https://www.google-analytics.com', 'https://region1.google-analytics.com', 'https://analytics.google.com'], // GA beacons
      fontSrc:        ["'self'", 'data:'],
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      frameAncestors: ["'none'"],               // disallow embedding in iframes
      upgradeInsecureRequests: [],
    },
  },
}));

// ─────────────────────────────────────────
//  CORS — restrict to own origin in prod
// ─────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : (IS_DEV ? ['http://localhost:3000', 'http://localhost:5173'] : []);

app.use(cors({
  origin: (origin, cb) => {
    // allow server-to-server (no origin) and allowed origins
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─────────────────────────────────────────
//  Body parsing
// ─────────────────────────────────────────
app.use(express.json({ limit: '16kb' }));
// cookieParser is used only for the httpOnly refresh-token cookie.
// CSRF is mitigated by a layered defense:
//   1. sameSite: 'strict' on the refresh cookie (browser blocks cross-site submission)
//   2. Access tokens sent via Authorization header (not cookies), not CSRF-vulnerable
//   3. csrfOriginCheck middleware on the two cookie-reading endpoints
//      (/api/auth/refresh, /api/auth/logout) validates the Origin/Referer header
//      against ALLOWED_ORIGINS — see server/src/middleware/csrf.js
// csurf (deprecated 2023) is intentionally NOT used — it is unsuitable for JWT REST APIs.
app.use(cookieParser());

// ─────────────────────────────────────────
//  Rate limiting
// ─────────────────────────────────────────
// General API limit: 120 req / 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

// Tighter limit for expensive search endpoints
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Search rate limit exceeded, please wait a moment.' },
});

app.use('/api', apiLimiter);
app.use('/api/flights', searchLimiter);

// ─────────────────────────────────────────
//  Routes
// ─────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/flights',  require('./routes/flights'));
app.use('/api/aircraft', require('./routes/aircraft'));
app.use('/api/map',      require('./routes/map'));

// ─────────────────────────────────────────
//  Health check
// ─────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV || 'development' });
});

// ─────────────────────────────────────────
//  Debug endpoints — development only
// ─────────────────────────────────────────
if (IS_DEV) {
  const cacheService   = require('./services/cacheService');
  const amadeusService = require('./services/amadeusService');

  app.get('/api/debug/cache', (_req, res) => res.json(cacheService.stats()));
  app.delete('/api/debug/cache', (_req, res) => {
    cacheService.flush();
    res.json({ ok: true });
  });

  app.get('/api/debug/amadeus', async (req, res) => {
    if (!process.env.AMADEUS_CLIENT_ID || !process.env.AMADEUS_CLIENT_SECRET) {
      return res.status(400).json({ ok: false, message: 'Amadeus credentials not configured' });
    }
    try {
      const raw = await amadeusService.searchFlights({
        departure_airport: 'LIS',
        arrival_airport:   'JFK',
        departure_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        passengers: 1,
      });
      res.json({ ok: true, offerCount: raw?.data?.length ?? 0 });
    } catch (err) {
      // Never forward raw API errors outside dev
      res.status(500).json({ ok: false, message: 'Amadeus test failed', hint: err.message });
    }
  });
}

// ─────────────────────────────────────────
//  Serve React build in production
// ─────────────────────────────────────────
if (!IS_DEV) {
  const clientBuild = path.join(__dirname, '../../client/dist');
  const spaFallbackLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 120, // limit each IP to 120 requests per window
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(express.static(clientBuild, {
    etag: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get('*path', spaFallbackLimiter, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

// ─────────────────────────────────────────
//  Global error handler
// ─────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  // Never leak stack traces to client
  const message = IS_DEV ? err.message : 'Internal server error';
  res.status(status).json({ success: false, message });
});

// ─────────────────────────────────────────
//  Start
// ─────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });

  // Background poller: adsb.lol observed-routes write-through (opt-in via ADSBLOL_ENABLED=1).
  const { startAdsbLolWorker } = require('./workers/adsblolWorker');
  const stopAdsbLolWorker = startAdsbLolWorker();
  const shutdown = () => { try { stopAdsbLolWorker(); } catch { /* noop */ } };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  // Fire-and-forget: populate local aircraft_db (hex → ICAO type) for AeroDataBox
  // enrichment. First boot downloads ~28MB; subsequent boots are no-ops.
  require('./services/aircraftDbService')
    .bootstrap()
    .catch((err) => console.warn('[aircraftdb] bootstrap failed:', err.message));
}

module.exports = app; // export for tests
