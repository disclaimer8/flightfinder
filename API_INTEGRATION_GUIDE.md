# API Integration Guide

## Overview
FlightFinder supports integration with two APIs:
1. **Amadeus API** - Real flight search with prices
2. **AirLabs API** - Enhanced aircraft data and specifications

## Setup Instructions

### 1. Amadeus API (Flight Search)

#### Get Your API Keys:
1. Visit https://developers.amadeus.com
2. Click **Register** and create a free account
3. After email verification, go to **My Self-Service Workspace**
4. Click **Create new app**
5. Copy **API Key** (Client ID) and **API Secret** (Client Secret)

#### Free Tier:
- ~2,000 flight search requests/month
- Real airline data (400+ airlines)
- Flight numbers, times, prices, aircraft codes
- Self-serve — no sales call required

#### Update `.env`:
```
AMADEUS_CLIENT_ID=your_client_id_here
AMADEUS_CLIENT_SECRET=your_client_secret_here
```

#### Example Request:
```bash
curl "http://localhost:5001/api/flights?departure=MAD&arrival=BCN&date=2026-03-20"
```

The API will automatically use Amadeus if both keys are configured, otherwise falls back to mock data.

---

### 2. AirLabs API (Aircraft Data)

#### Get Your API Key:
1. Visit https://airlabs.co/
2. Sign up for a free account
3. Check your email for API key
4. Or visit https://airlabs.co/auth/profile

#### Free Plan:
- **1,000 requests/month** (plenty for MVP)
- Access to 4,000+ aircraft
- Detailed specifications (capacity, range, cruise speed)
- Manufacturer info

#### Update `.env`:
```
AIRLABS_API_KEY=your_actual_airlabs_api_key_here
```

---

## API Response Format

### With Real APIs (Amadeus + AirLabs):
```json
{
  "success": true,
  "count": 20,
  "source": "amadeus",
  "data": [
    {
      "id": "amadeus_0",
      "departure": {"code": "MAD", "city": "MAD"},
      "arrival": {"code": "BCN", "city": "BCN"},
      "aircraftCode": "320",
      "aircraftName": "AIRBUS A320",
      "airline": "IBERIA",
      "airlineIata": "IB",
      "flightNumber": "IB3801",
      "departureTime": "2026-03-20T07:00:00",
      "arrivalTime": "2026-03-20T08:15:00",
      "price": "54.43",
      "currency": "EUR",
      "duration": "1h 15m",
      "source": "amadeus"
    }
  ]
}
```

### With Mock Data (Fallback):
```json
{
  "success": true,
  "count": 4,
  "source": "mock",
  "data": [...]
}
```

---

## API Endpoints

### Search Flights
```
GET /api/flights?departure=LIS&arrival=JFK&date=2026-03-20
```

**Query Parameters:**
- `departure` - Departure airport IATA code
- `arrival` - Arrival airport IATA code
- `date` - Departure date (YYYY-MM-DD)
- `passengers` - Number of passengers (default: 1)
- `aircraftType` - Filter by type (turboprop, jet, regional, wide-body)
- `aircraftModel` - Filter by model (320, 738, 789, etc.)
- `useMockData` - Force mock data (`true` to enable)

### Get Filter Options
```
GET /api/flights/filter-options
```

Returns available cities, aircraft types, aircraft models, and API status.

### Debug Amadeus (development only)
```
GET /api/debug/amadeus?departure=MAD&arrival=BCN&date=2026-03-20
```

Returns raw Amadeus API response. Only works when `NODE_ENV=development`.

---

## Fallback Mechanism

1. **If Amadeus keys are configured** → Use real Amadeus API
2. **If Amadeus fails** → Automatically fallback to mock data
3. **If AirLabs key exists** → Enrich results with live aircraft data
4. **If AirLabs fails** → Use local aircraft database

This ensures the app always works, even if APIs are temporarily unavailable.

---

## Testing

### Test with Mock Data:
```bash
curl "http://localhost:5001/api/flights?departure=LIS&arrival=JFK&useMockData=true"
```

### Test with Real APIs:
```bash
# Requires AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET in .env
curl "http://localhost:5001/api/flights?departure=MAD&arrival=BCN&date=2026-03-20"
```

---

## Limits & Pricing

### Amadeus API
- Free tier: ~2,000 search requests/month
- Test environment: cached data (not live inventory)
- Production: real live inventory, pay-as-you-go above free quota

### AirLabs API
- Free tier: 1,000 requests/month
- Paid tiers: €9/month (10k), €29/month (100k), etc.

---

## Troubleshooting

### "Client credentials are invalid"
- Double-check `AMADEUS_CLIENT_ID` and `AMADEUS_CLIENT_SECRET` in `.env`
- Make sure there are no extra spaces or quotes
- Restart the server after updating `.env`

### "Amadeus search failed"
- Verify your app is active in Amadeus Self-Service Workspace
- Amadeus test environment only supports certain routes — try MAD→BCN or LIS→JFK
- The app will fallback to mock data automatically

### "AirLabs rate limit exceeded"
- You've used all 1,000 monthly requests
- Wait for next month or upgrade to paid plan
- Mock aircraft data will still be used as fallback

### Dates in the past
- Amadeus only returns flights for future dates
- Use `date=YYYY-MM-DD` for dates at least 1 day from now

---

## Next Steps

1. ✅ Sign up for Amadeus at https://developers.amadeus.com
2. ✅ Add API keys to `server/.env`
3. ✅ Restart the server
4. ✅ Test: `GET /api/debug/amadeus`
5. 📱 The frontend displays API status automatically
6. 🚀 Deploy with API keys securely stored in production environment variables

---

## Additional Resources

- [Amadeus for Developers Docs](https://developers.amadeus.com/self-service/apis-docs)
- [Amadeus Node.js SDK](https://github.com/amadeus4dev/amadeus-node)
- [AirLabs API Reference](https://airlabs.co/api/documentation)
