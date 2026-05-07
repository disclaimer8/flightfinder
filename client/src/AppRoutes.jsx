import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import SiteLayout from './components/SiteLayout';
import Home from './pages/Home';
import Search from './pages/Search';
import Map from './pages/Map';

const AircraftLandingPage  = lazy(() => import('./components/AircraftLandingPage'));
const AircraftAirlines     = lazy(() => import('./components/AircraftAirlines'));
const AircraftRoutes       = lazy(() => import('./components/AircraftRoutes'));
const AircraftSafety       = lazy(() => import('./components/AircraftSafety'));
const AircraftSpecs        = lazy(() => import('./components/AircraftSpecs'));
const RouteLandingPage     = lazy(() => import('./components/RouteLandingPage'));
const AircraftRouteLanding = lazy(() => import('./components/AircraftRouteLanding'));
const AircraftIndex       = lazy(() => import('./pages/AircraftIndex'));
const MyTrips = lazy(() => import('./pages/MyTrips'));
const Pricing = lazy(() => import('./pages/Pricing'));
const SubscribeReturn = lazy(() => import('./pages/SubscribeReturn'));
const Terms = lazy(() => import('./pages/legal/Terms'));
const Privacy = lazy(() => import('./pages/legal/Privacy'));
const Attributions = lazy(() => import('./pages/legal/Attributions'));
const SafetyFeed        = lazy(() => import('./pages/safety/SafetyFeed'));
const SafetyEventDetail = lazy(() => import('./pages/safety/SafetyEventDetail'));
const SafetyGlobal      = lazy(() => import('./pages/safety/SafetyGlobal'));
const About             = lazy(() => import('./pages/About'));

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route path="/aircraft/:slug/airlines" element={<Suspense fallback={null}><AircraftAirlines /></Suspense>} />
        <Route path="/aircraft/:slug/routes"   element={<Suspense fallback={null}><AircraftRoutes /></Suspense>} />
        <Route path="/aircraft/:slug/safety"   element={<Suspense fallback={null}><AircraftSafety /></Suspense>} />
        <Route path="/aircraft/:slug/specs"    element={<Suspense fallback={null}><AircraftSpecs /></Suspense>} />
        <Route path="/aircraft/:slug"     element={<Suspense fallback={null}><AircraftLandingPage /></Suspense>} />
        <Route path="/routes/:pair"            element={<Suspense fallback={null}><RouteLandingPage /></Suspense>} />
        <Route path="/routes/:pair/:aircraftSlug" element={<Suspense fallback={null}><AircraftRouteLanding /></Suspense>} />
        <Route path="/by-aircraft"        element={<Suspense fallback={null}><AircraftIndex /></Suspense>} />
        <Route path="/trips"              element={<Suspense fallback={null}><MyTrips /></Suspense>} />
        <Route path="/pricing"            element={<Suspense fallback={null}><Pricing /></Suspense>} />
        <Route path="/subscribe/return"   element={<Suspense fallback={null}><SubscribeReturn /></Suspense>} />
        <Route path="/legal/terms"        element={<Suspense fallback={null}><Terms /></Suspense>} />
        <Route path="/legal/privacy"      element={<Suspense fallback={null}><Privacy /></Suspense>} />
        <Route path="/legal/attributions" element={<Suspense fallback={null}><Attributions /></Suspense>} />
        <Route path="/safety/feed"        element={<Suspense fallback={null}><SafetyFeed /></Suspense>} />
        <Route path="/safety/events/:id"  element={<Suspense fallback={null}><SafetyEventDetail /></Suspense>} />
        <Route path="/safety/global"      element={<Suspense fallback={null}><SafetyGlobal /></Suspense>} />
        <Route path="/about"              element={<Suspense fallback={null}><About /></Suspense>} />
      </Route>
      <Route path="/"       element={<Home />} />
      <Route path="/search" element={<Search />} />
      <Route path="/map"    element={<Map />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
