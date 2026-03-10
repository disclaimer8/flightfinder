# FlightFinder - Flight Search with Aircraft Type Filtering

## Project Overview
A full-stack web application for searching flights filtered by aircraft type and specific aircraft models. Integrates with Duffel API for real flight data and AirLabs API for aircraft specifications.

## Architecture

### Backend (Node.js + Express)
- REST API with CORS support
- Integration with Duffel API for real-time flight data
- Integration with AirLabs API for aircraft specifications
- Smart fallback to mock data if APIs unavailable
- Services: duffelService.js, airlabsService.js

### Frontend (React 18)
- Component-based architecture
- Axios for API communication
- Real-time API status display
- Responsive design

## Key Features Implemented

1. **Real Flight Search** - Duffel API integration
   - 700+ airlines coverage
   - Live pricing and availability
   - Flexible date and passenger selection

2. **Aircraft Data Enrichment** - AirLabs API integration  
   - 4,000+ aircraft database
   - Capacity, range, cruise speed specs
   - Aircraft type classification

3. **Intelligent Filtering**
   - By aircraft type (turboprop, jet, regional, wide-body)
   - By specific aircraft model (B737, A320, CRJ1000, etc.)

4. **Smart Fallback System**
   - Uses real data when APIs available
   - Falls back to mock data gracefully
   - Hybrid approach for maximum reliability

## API Configuration

Both APIs use free tiers:

**Duffel API**
- Free searches, commission on bookings
- Get key: https://duffel.com/dashboard
- Set in .env: `DUFFEL_API_KEY=your_key`

**AirLabs API**
- 1,000 requests/month free
- Get key: https://airlabs.co/auth/profile
- Set in .env: `AIRLABS_API_KEY=your_key`

## Development Guidelines

1. Always check API keys are configured before using real data
2. Implement fallback to mock data for reliability
3. Cache aircraft data to minimize API calls
4. Log API errors but ensure app remains functional
5. Test with both real and mock data

## Testing Local Setup

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2  
cd client && npm start

# Test with mock data
curl "http://localhost:5001/api/flights?departure=LIS&arrival=NYC&useMockData=true"
```

## Performance Notes

- AirLabs: 1,000 req/month = ~33 requests/day
- Cache aircraft data to stay within limits
- Batch aircraft lookups when possible
- Use mock data for demos and testing

## Known Limitations

- AirLabs free tier: 1,000 requests/month
- Duffel only returns future flights (2+ days)
- Mock data supports LIS, NYC, LON, LAX airports

## File Structure
```
/server/src/
  /controllers/flightController.js   - Request handlers
  /services/duffelService.js        - Duffel API integration
  /services/airlabsService.js       - AirLabs API integration
  /models/aircraftData.js           - Local aircraft database
  /routes/flights.js                - Flight endpoints

/client/src/
  /components/SearchForm.js         - Search UI
  /components/FlightResults.js      - Results display
  /components/FlightCard.js         - Individual flight card
  /components/APIStatus.js          - API connection status
  App.js                            - Main app component
```

## Resources
- [API Integration Guide](./API_INTEGRATION_GUIDE.md)
- [Duffel Docs](https://duffel.com/docs)
- [AirLabs Docs](https://airlabs.co/api/documentation)
