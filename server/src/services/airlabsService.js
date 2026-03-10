const axios = require('axios');

const AIRLABS_API_URL = 'https://airlabs.co/api/v9'; // Note: AirLabs often uses /fleets or /aircraft_types for specs
const AIRLABS_API_KEY = process.env.AIRLABS_API_KEY;

if (!AIRLABS_API_KEY) {
  console.warn('⚠️  AIRLABS_API_KEY is not configured. Aircraft enrichment will be limited.');
}

const airlabsClient = axios.create({ baseURL: AIRLABS_API_URL });

/**
 * Get detailed aircraft information by IATA code
 * @param {string} iata - Aircraft IATA code (e.g., B737, A320)
 */
exports.getAircraftInfo = async (iata) => {
  try {
    const response = await airlabsClient.get('/aircraft_types', {
      params: {
        iata_code: iata.toUpperCase(),
        api_key: AIRLABS_API_KEY
      }
    });

    if (response.data.response && response.data.response.length > 0) {
      const aircraft = response.data.response[0];
      return {
        iata: aircraft.iata_code,
        icao: aircraft.icao_code,
        name: aircraft.model_name || aircraft.name,
        manufacturer: aircraft.manufacturer,
      type: classifyAircraftType(aircraft.model_name || ''),
        capacity: aircraft.capacity || null,
        range: aircraft.range || null,
        cruiseSpeed: aircraft.cruise_speed || null,
        categories: []
      };
    }
    return null;
  } catch (error) {
    console.error('AirLabs API Error:', error.message);
    return null;
  }
};

/**
 * Get multiple aircraft info
 * @param {Array} iataCodes - Array of IATA codes
 */
exports.getMultipleAircraft = async (iataCodes) => {
  try {
    if (!iataCodes || iataCodes.length === 0) return {};
    
    const uniqueIatas = [...new Set(iataCodes)];
    const promises = uniqueIatas.map(iata => exports.getAircraftInfo(iata));
    const results = await Promise.all(promises);
    
    const aircraftMap = {};
    results.forEach(aircraft => {
      if (aircraft && aircraft.iata) {
        aircraftMap[aircraft.iata] = aircraft;
      }
    });
    
    return aircraftMap;
  } catch (error) {
    console.error('AirLabs Batch Error:', error.message);
    return {};
  }
};

/**
 * Get airline information by IATA code
 * @param {string} iata - Airline IATA code
 */
exports.getAirlineInfo = async (iata) => {
  try {
    const response = await airlabsClient.get('/airlines', {
      params: {
        iata_code: iata.toUpperCase(),
        api_key: AIRLABS_API_KEY
      }
    });

    if (response.data.response && response.data.response.length > 0) {
      const airline = response.data.response[0];
      return {
        iata: airline.iata_code,
        icao: airline.icao_code,
        name: airline.name,
        country: airline.country_name
      };
    }
    return null;
  } catch (error) {
    console.error('AirLabs API Error:', error.message);
    return null;
  }
};

/**
 * Get multiple airline info
 * @param {Array} iataCodes - Array of airline IATA codes
 */
exports.getMultipleAirlines = async (iataCodes) => {
  try {
    if (!iataCodes || iataCodes.length === 0) return {};
    
    const uniqueIatas = [...new Set(iataCodes)];
    const promises = uniqueIatas.map(iata => exports.getAirlineInfo(iata));
    const results = await Promise.all(promises);
    
    const airlineMap = {};
    results.forEach(airline => {
      if (airline && airline.iata) {
        airlineMap[airline.iata] = airline;
      }
    });
    
    return airlineMap;
  } catch (error) {
    console.error('AirLabs Batch Airlines Error:', error.message);
    return {};
  }
};

/**
 * Classify aircraft into a high-level type based on its model/name
 */
function classifyAircraftType(name = '') {
  const nameLower = String(name).toLowerCase();
  
  if (nameLower.includes('dash') || nameLower.includes('atr') || nameLower.includes('prop')) {
    return 'turboprop';
  }
  if (nameLower.includes('crj') || nameLower.includes('e170') || nameLower.includes('e175') || nameLower.includes('e190') || nameLower.includes('erj')) {
    return 'regional';
  }
  if (nameLower.includes('777') || nameLower.includes('787') || nameLower.includes('a350') || nameLower.includes('a380') || nameLower.includes('747') || nameLower.includes('330')) {
    return 'wide-body';
  }
  if (nameLower.includes('737') || nameLower.includes('a320') || nameLower.includes('a319') || nameLower.includes('a321') || nameLower.includes('757')) {
    return 'jet';
  }
  
  return 'jet'; // Default fallback
}
