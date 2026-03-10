# Flight Search Application

A modern web application for searching flights with the ability to filter by aircraft type and model. Integrates with real flight data APIs for live pricing and booking information.

## 🌟 Features

- ✈️ Real-time flight search across 700+ airlines (Duffel API)
- 🔍 Filter by aircraft type (turboprop, jet, regional, wide-body)
- 🛩️ Filter by specific aircraft model (B737, A320, CRJ1000, Q400, etc.)
- 📊 Detailed aircraft specifications from AirLabs (capacity, range, cruise speed)
- 💰 Live flight pricing and availability
- 📅 Search by date and passenger count
- 🔄 Automatic fallback to demo data if APIs are unavailable
- 📱 Responsive design for mobile and desktop

## Tech Stack

**Backend:**
- Node.js + Express.js
- Duffel API for flight data
- AirLabs API for aircraft information
- CORS enabled for frontend communication

**Frontend:**
- React 18
- Axios for API calls
- Modern CSS3 with gradients and animations

## Project Structure

```
FLIGHT/
├── server/                      # Backend application
│   ├── src/
│   │   ├── index.js            # Express app entry point
│   │   ├── routes/             # API endpoints
│   │   ├── controllers/        # Request handlers
│   │   ├── services/           # External API integrations
│   │   │   ├── duffelService.js
│   │   │   └── airlabsService.js
│   │   └── models/             # Data models & databases
│   ├── package.json
│   └── .env
│
├── client/                      # Frontend application
│   ├── src/
│   │   ├── App.js
│   │   ├── components/         # React components
│   │   ├── pages/              # Page layouts
│   │   │   ├── SearchForm.js
│   │   │   ├── FlightResults.js
│   │   │   ├── FlightCard.js
│   │   │   └── APIStatus.js
│   │   ├── services/           # API client
│   │   └── styles/             # Global styles
│   ├── package.json
│   └── public/
│
├── API_INTEGRATION_GUIDE.md     # Setup instructions for APIs
└── README.md
```

## Getting Started

### Prerequisites
- Node.js 14+
- npm or yarn
- API keys (free tier available):
  - [Duffel API](https://duffel.com) - Free (commission-based)
  - [AirLabs API](https://airlabs.co) - 1,000 requests/month free

### Backend Setup

```bash
cd server
npm install

# Configure your API keys
# Edit .env and add your API keys:
# DUFFEL_API_KEY=your_key_here
# AIRLABS_API_KEY=your_key_here

npm run dev
```

The API will run on `http://localhost:5001`

### Frontend Setup

```bash
cd client
npm install
npm start
```

The app will open at `http://localhost:3000`

## API Endpoints

### Search Flights
```
GET /api/flights
Query Parameters:
  - departure     (string): Departure airport code (e.g., LIS)
  - arrival       (string): Arrival airport code (e.g., NYC)
  - date          (string): Departure date (YYYY-MM-DD)
  - passengers    (number): Number of passengers (1-9)
  - aircraftType  (string): turboprop, jet, regional, or wide-body
  - aircraftModel (string): Aircraft IATA code (e.g., B737)
  - useMockData   (boolean): Force demo data
```

### Get Filter Options
```
GET /api/flights/filter-options
```

Returns available cities, aircraft types, aircraft models, and API connection status.

## Configuration

### Environment Variables (.env)

```env
PORT=5001
NODE_ENV=development

# Duffel API - Get from https://duffel.com/dashboard
DUFFEL_API_KEY=your_api_key_here

# AirLabs API - Get from https://airlabs.co/auth/profile
AIRLABS_API_KEY=your_api_key_here
```

## API Integration Details

### Duffel API
- **Purpose**: Real flight search and booking
- **Features**: 700+ airlines, 1M+ daily flights, live pricing
- **Pricing**: Free searches, commission on bookings
- **Coverage**: Global routes

### AirLabs API
- **Purpose**: Aircraft data enrichment
- **Features**: 4,000+ aircraft, detailed specs, manufacturer info
- **Pricing**: 1,000 req/month free
- **Data**: Capacity, range, cruise speed, type classification

## Features Breakdown

### Search Capabilities
- Multi-city route searches
- Flexible date selection
- Passenger count (1-9)
- Real-time availability

### Aircraft Filtering
- By type: Turboprop, Jet, Regional, Wide-body
- By specific model: B737, A320, CRJ1000, Q400, etc.
- Live aircraft specifications
- Aircraft manufacturer and capacity info

### Data Sources
1. Primary: Duffel API for live pricing
2. Secondary: AirLabs API for aircraft enrichment
3. Fallback: Local mock database if APIs unavailable

## Smart Fallback System

```
Request Flow:
1. Check if Duffel API is configured
   ✓ Use live data
   ✗ Use mock data
2. Enrich with AirLabs aircraft data
   ✓ Use live specs
   ✗ Use local database
3. Apply user filters
4. Return results
```

## Example Requests

### Search all flights from Lisbon to NYC
```bash
curl "http://localhost:5001/api/flights?departure=LIS&arrival=NYC"
```

### Search turboprop flights only
```bash
curl "http://localhost:5001/api/flights?departure=LIS&arrival=NYC&aircraftType=turboprop"
```

### Search CRJ1000 specifically
```bash
curl "http://localhost:5001/api/flights?departure=LIS&arrival=NYC&aircraftModel=CR1"
```

### Force demo data regardless of API keys
```bash
curl "http://localhost:5001/api/flights?departure=LIS&arrival=NYC&useMockData=true"
```

## Response Format

```json
{
  "success": true,
  "count": 4,
  "source": "duffel",
  "data": [
    {
      "id": "duffel_0",
      "departure": {"code": "LIS", "city": "Lisbon"},
      "arrival": {"code": "NYC", "city": "New York"},
      "aircraftCode": "B737",
      "airline": "TAP Air Portugal",
      "price": 450,
      "currency": "USD",
      "duration": "7h 30m",
      "aircraft": {
        "name": "Boeing 737",
        "manufacturer": "Boeing",
        "type": "jet",
        "capacity": 189,
        "range": 5570,
        "cruiseSpeed": 903
      }
    }
  ]
}
```

## Future Enhancements

- [ ] User authentication and saved preferences
- [ ] Booking system with payment integration
- [ ] Flight alerts and price tracking
- [ ] Seat selection interface
- [ ] Multi-leg journey planning
- [ ] Loyalty program integration
- [ ] Mobile app (React Native)
- [ ] Admin dashboard for analytics
- [ ] Hotel and car rental integration

## Troubleshooting

### "API keys not found"
- Ensure `.env` is in `/server/` directory
- Verify keys have no extra spaces or quotes
- Restart the server after updating

### "Duffel API error"
- Check API key is valid at https://duffel.com/dashboard
- Verify dates are at least 2 days in the future
- App will fallback to mock data automatically

### "CORS errors"
- Ensure backend is running on port 5001
- Check frontend is requesting from `http://localhost:5001`

### "No flights found"
- Try changing the date (must be future date)
- Check if airports are served by major airlines
- Try with `useMockData=true` to test with demo data

## Support & Documentation

- [API Integration Guide](./API_INTEGRATION_GUIDE.md) - Detailed setup instructions
- [Duffel API Docs](https://duffel.com/docs)
- [AirLabs API Docs](https://airlabs.co/api/documentation)

## License

MIT

## Author

Built with ❤️ for aviation enthusiasts

