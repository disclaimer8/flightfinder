import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import UpgradeModal from './UpgradeModal';
import { addTrip } from '../hooks/useTrips';
import { enablePushNotifications } from '../utils/push';

export default function AddToTripsButton({ flight }) {
  const { user, getToken } = useAuth();
  const [upgrade, setUpgrade] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [added, setAdded]     = useState(false);

  const isPro = user?.subscription_tier?.startsWith('pro_');

  async function onClick() {
    if (!user) { window.location.href = '/login'; return; }
    if (!isPro) { setUpgrade(true); return; }
    setSaving(true);
    try {
      const token = getToken?.();
      const { success } = await addTrip({
        airline_iata:  (flight.airlineIata || flight.airline || '').toUpperCase(),
        flight_number: String(flight.flightNumber || flight.number || '')
                         .replace(/^[A-Z]+/i, '').replace(/\D/g, ''),
        dep_iata:      flight.departure?.code,
        arr_iata:      flight.arrival?.code,
        scheduled_dep: new Date(flight.departureTime).getTime(),
        scheduled_arr: new Date(flight.arrivalTime).getTime(),
      }, token);
      if (success) {
        setAdded(true);
        // Fire and forget — permission may be denied or already-enrolled.
        enablePushNotifications(token).catch((err) => console.warn('[push] enrollment skipped:', err.message));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-add-trip"
        onClick={onClick}
        disabled={saving || added}
      >
        {added ? '✓ Added to My Trips' : saving ? 'Adding…' : '+ Add to My Trips'}
      </button>
      <UpgradeModal
        open={upgrade}
        reason="Track this flight live, get push alerts on delays, and see gate/terminal in My Trips."
        onClose={() => setUpgrade(false)}
      />
    </>
  );
}
