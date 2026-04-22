// Sentry must be required first so OpenTelemetry can auto-instrument
// http/express when those modules load below. instrument.js also loads
// .env internally.
require('./instrument');

// Load .env with override so PM2-cached env vars are replaced,
// but preserve NODE_ENV if already set (e.g. NODE_ENV=test in Jest).
const _savedNodeEnv = process.env.NODE_ENV;
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
if (_savedNodeEnv) process.env.NODE_ENV = _savedNodeEnv;

const Sentry  = require('@sentry/node');
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
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], // Leaflet inline style= + TP Drive Google Fonts
      imgSrc:         ["'self'", 'data:', 'https:'], // CartoDB map tiles (loaded as <img> by Leaflet)
      connectSrc:     [
        "'self'",
        'https://www.google-analytics.com', 'https://region1.google-analytics.com', 'https://analytics.google.com', // GA beacons
        'https://emrldtp.cc', 'https://www.travelpayouts.com', 'https://sentry.avs.io', // Travelpayouts Drive fetches
        'https://*.ingest.de.sentry.io', // Our own Sentry (EU region) error + trace ingest
      ],
      fontSrc:        ["'self'", 'data:', 'https://fonts.gstatic.com'], // TP Drive Google Fonts
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

// Native Capacitor WebView origins — iOS uses `capacitor://localhost`,
// Android uses `https://localhost` (Capacitor 7+ default androidScheme).
// Always allowed so the mobile apps reach the API regardless of prod ALLOWED_ORIGINS.
const NATIVE_ORIGINS = new Set(['capacitor://localhost', 'https://localhost']);

app.use(cors({
  origin: (origin, cb) => {
    // allow server-to-server (no origin), native WebViews, and allowed origins
    if (!origin || NATIVE_ORIGINS.has(origin) || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
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
// Stripe webhook needs the raw body to verify the signature — must be mounted
// BEFORE express.json() which would consume and JSON-parse the body.
app.post(
  '/api/subscriptions/webhook',
  express.raw({ type: 'application/json' }),
  require('./controllers/subscriptionController').handleWebhook,
);

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
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/flights',       require('./routes/flights'));
app.use('/api/flights',       require('./routes/enrichment'));
app.use('/api/aircraft',      require('./routes/aircraft'));
app.use('/api/map',           require('./routes/map'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/config',        require('./routes/config'));
if (process.env.TRIPS_ENABLED !== '0') {
  app.use('/api/trips',       require('./routes/trips'));
  app.use('/api/push',        require('./routes/push'));
}
app.use('/',                  require('./routes/seo'));            // /sitemap.xml

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
  const fs = require('fs');
  const clientBuild = path.join(__dirname, '../../client/dist');
  const spaFallbackLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 120, // limit each IP to 120 requests per window
    standardHeaders: true,
    legacyHeaders: false,
  });
  // Disable static's automatic index.html so that GET '/' falls through to our
  // SPA handler below, which injects a canonical tag and noindex for query-
  // parameter variants (SearchAction URLs like ?from=LHR&to=JFK would otherwise
  // register as duplicate-content URLs in Google's index).
  app.use(express.static(clientBuild, {
    etag: false,
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));

  // Cache index.html in memory — deploy rebuilds the file and pm2 restarts the
  // process, so a single read per boot is safe and avoids per-request fs calls.
  const indexHtmlPath = path.join(clientBuild, 'index.html');
  let indexHtmlCached = null;
  const readIndexHtml = () => {
    if (indexHtmlCached == null) indexHtmlCached = fs.readFileSync(indexHtmlPath, 'utf8');
    return indexHtmlCached;
  };

  // Per-route SEO metadata injector — rewrites <title>, <meta description>,
  // canonical, OG/Twitter cards, and the static H1/subtitle fallback so each
  // known URL (/, /by-aircraft, /map, /aircraft/:slug, /routes/:from-:to) is
  // indexable with correct content even without JS rendering.
  const seoMeta = require('./services/seoMetaService');

  const spaFallback = (req, res) => {
    const meta = seoMeta.resolve(req.path);
    let html = seoMeta.inject(readIndexHtml(), meta);
    const q = req.query || {};
    // Query-string variants collapse to the route's canonical — otherwise
    // ?utm=… and SearchAction links would create duplicate-content copies
    // for every landing page.
    if (Object.keys(q).length > 0) {
      // HTML-escape the canonical URL even though meta.canonical is derived
      // from a whitelist (known slugs / validated IATA pairs) and cannot
      // currently carry user input — static analyzers (CodeQL js/reflected-xss)
      // follow req.path all the way here and can't prove the runtime
      // whitelist, and this defends against any future kind/resolver that
      // forgets to sanitize.
      html = html.replace(
        /<link rel="canonical" href="[^"]*"\s*\/?>/i,
        `<link rel="canonical" href="${seoMeta.esc(meta.canonical)}" />`
      );
    }
    // Email verification link (/ ?action=verify&token=…) should never be indexed.
    if (q.action === 'verify') {
      html = html.replace(
        /<meta name="robots" content="[^"]*"\s*\/?>/i,
        '<meta name="robots" content="noindex, nofollow" />'
      );
    }
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Return a real 404 for unknown /aircraft/:slug and /routes/:pair URLs
    // so crawlers stop wasting budget on typos and bot-fuzz. The HTML body
    // still ships the React app so a human visitor sees the in-app
    // "not found" screen instead of a raw error.
    const status = meta.kind === 'not-found' ? 404 : 200;
    res.status(status).send(html);
  };

  app.get('/',      spaFallbackLimiter, spaFallback);
  app.get('*path',  spaFallbackLimiter, spaFallback);
}

// ─────────────────────────────────────────
//  Sentry Express error capture — must come BEFORE our handler so Sentry
//  sees the error but AFTER all routes. No-op if DSN isn't set.
// ─────────────────────────────────────────
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
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

  // Background workers.
  //   adsblol         — observed-routes write-through (opt-in via ADSBLOL_ENABLED=1)
  //   delayIngestion  — AeroDataBox departures → flight_observations (INGEST_ENABLED=1)
  //   fleetBootstrap  — one-shot Mictronics → aircraft_fleet (FLEET_BOOTSTRAP=1)
  const { startAdsbLolWorker }        = require('./workers/adsblolWorker');
  const { startDelayIngestionWorker } = require('./workers/delayIngestionWorker');
  const { startFleetBootstrapWorker } = require('./workers/fleetBootstrapWorker');
  const { startTripAlertWorker }      = require('./workers/tripAlertWorker');
  const stopAdsbLolWorker   = startAdsbLolWorker();
  const stopDelayIngest     = startDelayIngestionWorker();
  const stopFleetBootstrap  = startFleetBootstrapWorker();
  const stopTripAlertWorker = startTripAlertWorker();

  // Load airline amenities seed on boot (cheap, idempotent).
  try {
    require('./services/amenitiesService').loadSeedIntoDb();
  } catch (err) {
    console.warn('[amenities] seed failed:', err.message);
  }

  const shutdown = () => {
    try { stopAdsbLolWorker();    } catch { /* noop */ }
    try { stopDelayIngest();      } catch { /* noop */ }
    try { stopFleetBootstrap();   } catch { /* noop */ }
    try { stopTripAlertWorker();  } catch { /* noop */ }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  // Fire-and-forget: populate local aircraft_db (hex → ICAO type) for AeroDataBox
  // enrichment. First boot downloads ~28MB; subsequent boots are no-ops.
  require('./services/aircraftDbService')
    .bootstrap()
    .catch((err) => console.warn('[aircraftdb] bootstrap failed:', err.message));
}

module.exports = app; // export for tests
