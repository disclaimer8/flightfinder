const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const amadeusService = require('./services/amadeusService');
const airlabsService = require('./services/airlabsService');
const cacheService = require('./services/cacheService');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/flights', require('./routes/flights'));
app.use('/api/aircraft', require('./routes/aircraft'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Debug: test Amadeus integration with safe sample params
app.get('/api/debug/amadeus', async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ ok: false, message: 'Not found' });
  }

  try {
    if (!process.env.AMADEUS_CLIENT_ID || !process.env.AMADEUS_CLIENT_SECRET) {
      return res.status(400).json({
        ok: false,
        message: 'AMADEUS_CLIENT_ID or AMADEUS_CLIENT_SECRET is not configured',
      });
    }

    const {
      departure = 'LIS',
      arrival = 'JFK',
      date,
      passengers = 1,
    } = req.query;

    const searchParams = {
      departure_airport: String(departure).toUpperCase(),
      arrival_airport: String(arrival).toUpperCase(),
      departure_date: date || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      passengers: parseInt(passengers, 10) || 1,
    };

    const raw = await amadeusService.searchFlights(searchParams);
    res.json({ ok: true, params: searchParams, raw });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: 'Amadeus debug request failed',
      error: error.message,
      details: error.description || error.response?.result || null,
    });
  }
});

// Debug: test AirLabs integration for aircraft and airlines
app.get('/api/debug/airlabs', async (req, res) => {
  try {
    if (!process.env.AIRLABS_API_KEY || process.env.AIRLABS_API_KEY === 'your_airlabs_api_key_here') {
      return res.status(400).json({
        ok: false,
        message: 'AIRLABS_API_KEY is not configured',
      });
    }

    const { aircraft = 'B737', airline = 'BA' } = req.query;

    const [aircraftInfo, airlineInfo] = await Promise.all([
      airlabsService.getAircraftInfo(aircraft),
      airlabsService.getAirlineInfo(airline),
    ]);

    res.json({
      ok: true,
      params: { aircraft, airline },
      aircraft: aircraftInfo,
      airline: airlineInfo,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: 'AirLabs debug request failed',
      error: error.message,
    });
  }
});

// Cache stats (dev only)
if (process.env.NODE_ENV === 'development') {
  app.get('/api/debug/cache', (req, res) => res.json(cacheService.stats()));
  app.delete('/api/debug/cache', (req, res) => { cacheService.flush(); res.json({ ok: true }); });
}

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
