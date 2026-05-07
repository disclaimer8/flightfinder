import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Family slug map — extend as new families are added. Keep in sync with
// /aircraft/:slug canonical slugs on backend.
const FAMILY_SLUGS = {
  '787': 'boeing-787',
  '777': 'boeing-777',
  '737': 'boeing-737',
  '747': 'boeing-747',
  '767': 'boeing-767',
  '757': 'boeing-757',
  'a380': 'airbus-a380',
  'a350': 'airbus-a350',
  'a330': 'airbus-a330',
  'a320': 'airbus-a320',
  'a319': 'airbus-a319',
  'a321': 'airbus-a321',
  'a340': 'airbus-a340',
  'a220': 'airbus-a220',
  'embraer': 'embraer-e-jet',
  'crj': 'bombardier-crj',
  'atr': 'atr-72',
};

function familyToSlug(familyParam) {
  if (!familyParam) return null;
  return FAMILY_SLUGS[familyParam.toLowerCase()] || null;
}

export default function LegacyRedirect() {
  const navigate = useNavigate();
  const { search } = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(search);

    // /?mode=by-aircraft[&family=…] → /aircraft/:slug or /by-aircraft fallback
    if (params.get('mode') === 'by-aircraft') {
      const slug = familyToSlug(params.get('family'));
      navigate(slug ? `/aircraft/${slug}` : '/by-aircraft', { replace: true });
      return;
    }

    // /?mode=map → /map
    if (params.get('mode') === 'map') {
      navigate('/map', { replace: true });
      return;
    }

    // /?from=…&to=… (route search style) → /search?…
    if (params.get('from') && params.get('to')) {
      navigate(`/search?${params.toString()}`, { replace: true });
      return;
    }
  }, [search, navigate]);

  return null;
}
