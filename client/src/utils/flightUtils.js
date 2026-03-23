/** Parse "2h 35m" → total minutes. Returns Infinity for missing values. */
export function parseDurationMins(str) {
  if (!str) return Infinity;
  const h = str.match(/(\d+)h/);
  const m = str.match(/(\d+)m/);
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
}

/** Classify an ISO timestamp into a time-of-day slot. */
export function getTimeSlot(isoString) {
  const h = new Date(isoString).getHours();
  if (h < 6)  return 'night';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

/** Build URLSearchParams from a search-form filters object. */
export function buildFlightParams(filters) {
  const params = new URLSearchParams();
  if (filters.departure)    params.append('departure',    filters.departure);
  if (filters.arrival)      params.append('arrival',      filters.arrival);
  if (filters.date)         params.append('date',         filters.date);
  if (filters.passengers)   params.append('passengers',   filters.passengers);
  if (filters.aircraftType)  params.append('aircraftType',  filters.aircraftType);
  if (filters.aircraftModel) params.append('aircraftModel', filters.aircraftModel);
  if (filters.returnDate)   params.append('returnDate',   filters.returnDate);
  return params;
}
