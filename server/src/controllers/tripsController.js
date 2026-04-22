'use strict';

const tripsModel = require('../models/trips');

function list(req, res) {
  const rows = tripsModel.listByUser(req.user.id);
  res.json({ success: true, data: rows });
}

function get(req, res) {
  const row = tripsModel.getOwned(Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: row });
}

async function getStatus(req, res) {
  const row = tripsModel.getOwned(Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ success: false, message: 'Not found' });
  try {
    // Lazy require so this controller loads even when tripStatusService
    // hasn't been landed yet (used by the ownership test).
    const tripStatus = require('../services/tripStatusService');
    const status = await tripStatus.compute(row);
    res.json({ success: true, data: status });
  } catch (err) {
    console.error('[trips] status failed:', err);
    res.status(500).json({ success: false, message: 'Status failed' });
  }
}

function create(req, res) {
  const b = req.body || {};
  const required = ['airline_iata','flight_number','dep_iata','arr_iata','scheduled_dep','scheduled_arr'];
  for (const f of required) {
    if (!b[f]) return res.status(400).json({ success: false, message: `Missing ${f}` });
  }
  const id = tripsModel.create({
    user_id: req.user.id,
    airline_iata: b.airline_iata,
    flight_number: String(b.flight_number).replace(/[^0-9]/g, ''),
    dep_iata: b.dep_iata.toUpperCase(),
    arr_iata: b.arr_iata.toUpperCase(),
    scheduled_dep: Number(b.scheduled_dep),
    scheduled_arr: Number(b.scheduled_arr),
    note: b.note || null,
    alerts_enabled: b.alerts_enabled === false ? 0 : 1,
  });
  res.json({ success: true, id });
}

function remove(req, res) {
  const ok = tripsModel.deleteOwned(Number(req.params.id), req.user.id);
  if (!ok) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true });
}

module.exports = { list, get, getStatus, create, remove };
