import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function SubscribeReturn() {
  const [params] = useSearchParams();
  const outcome = params.get('subscribe');
  const { refreshUser } = useAuth();

  useEffect(() => {
    if (outcome === 'success' && typeof refreshUser === 'function') {
      // Webhook has already run server-side; a single /auth/me fetch pulls the
      // new tier into the client state.
      refreshUser();
    }
  }, [outcome, refreshUser]);

  const wrap = { textAlign: 'center', padding: '96px 16px', maxWidth: 560, margin: '0 auto' };

  if (outcome === 'success') {
    return (
      <div style={wrap}>
        <h1>Welcome to Pro ✈️</h1>
        <p>Your subscription is active. Enriched card, delay predictions, and My Trips are now unlocked.</p>
        <p><Link to="/">Start searching flights →</Link></p>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <h1>Checkout cancelled</h1>
      <p>No charges were made. You can pick a plan anytime.</p>
      <p><Link to="/pricing">Back to pricing</Link></p>
    </div>
  );
}
