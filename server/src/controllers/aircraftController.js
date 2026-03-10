const aircraftData = require('../models/aircraftData');

exports.getAllAircraft = (req, res) => {
  const aircraft = Object.entries(aircraftData).map(([code, data]) => ({
    code,
    ...data
  }));

  res.json({
    success: true,
    count: aircraft.length,
    data: aircraft
  });
};

exports.getAircraftByCode = (req, res) => {
  const { iataCode } = req.params;
  const aircraft = aircraftData[iataCode.toUpperCase()];

  if (!aircraft) {
    return res.status(404).json({
      success: false,
      message: 'Aircraft not found'
    });
  }

  res.json({
    success: true,
    data: {
      code: iataCode.toUpperCase(),
      ...aircraft
    }
  });
};

exports.getAircraftByType = (req, res) => {
  const { type } = req.params;
  
  const filtered = Object.entries(aircraftData)
    .filter(([, data]) => data.type === type.toLowerCase())
    .map(([code, data]) => ({
      code,
      ...data
    }));

  res.json({
    success: true,
    count: filtered.length,
    data: filtered
  });
};
