import React, { useState } from 'react';
import './BookingModal.css';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysInMonth(month, year) {
  if (!month || !year) return 31;
  return new Date(Number(year), Number(month), 0).getDate();
}

function DateOfBirthPicker({ onChange }) {
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');

  const maxYear = new Date().getFullYear() - 18;
  const minYear = maxYear - 82;
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i);

  const emit = (d, m, y) => {
    if (d && m && y) {
      onChange(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    } else {
      onChange('');
    }
  };

  const handleDay = (e) => { setDay(e.target.value); emit(e.target.value, month, year); };
  const handleMonth = (e) => {
    const newMonth = e.target.value;
    const maxD = daysInMonth(newMonth, year);
    const clampedDay = day && Number(day) > maxD ? String(maxD) : day;
    setMonth(newMonth);
    if (clampedDay !== day) setDay(clampedDay);
    emit(clampedDay, newMonth, year);
  };
  const handleYear = (e) => { setYear(e.target.value); emit(day, month, e.target.value); };

  const totalDays = daysInMonth(month, year);

  return (
    <div className="dob-picker">
      <select className="dob-select" value={day} onChange={handleDay}>
        <option value="">Day</option>
        {Array.from({ length: totalDays }, (_, i) => i + 1).map(d => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      <select className="dob-select dob-month" value={month} onChange={handleMonth}>
        <option value="">Month</option>
        {MONTHS.map((name, i) => (
          <option key={i} value={i + 1}>{name}</option>
        ))}
      </select>

      <select className="dob-select" value={year} onChange={handleYear}>
        <option value="">Year</option>
        {years.map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}

function ConfirmationScreen({ booking, flight, onClose }) {
  return (
    <div className="booking-confirmation">
      <div className="confirm-icon">✓</div>
      <h2>Booking Confirmed!</h2>
      <div className="booking-ref">
        <span className="ref-label">Booking Reference</span>
        <span className="ref-code">{booking.bookingReference}</span>
      </div>
      <div className="confirm-route">
        {flight.departure.code} → {flight.arrival.code}
        <span className="confirm-date">{formatDate(flight.departureTime)}</span>
      </div>
      <p className="confirm-note">
        A confirmation will be sent to your email. Check spam if you don't see it.
      </p>
      <button className="btn-close-confirm" onClick={onClose}>Done</button>
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;
const NAME_RE = /^[a-zA-ZÀ-ÿ\s'\-]{2,}$/;

function validate(form) {
  const e = {};
  if (!NAME_RE.test(form.firstName.trim())) e.firstName = 'Enter a valid first name (letters only, min 2)';
  if (!NAME_RE.test(form.lastName.trim())) e.lastName = 'Enter a valid last name (letters only, min 2)';
  if (!EMAIL_RE.test(form.email)) e.email = 'Enter a valid email address';
  if (!form.dateOfBirth) {
    e.dateOfBirth = 'Select your date of birth';
  } else {
    const age = (Date.now() - new Date(form.dateOfBirth)) / (1000 * 60 * 60 * 24 * 365.25);
    if (age < 18) e.dateOfBirth = 'Must be 18 or older for an adult ticket';
  }
  if (form.phone && !PHONE_RE.test(form.phone)) e.phone = 'Enter a valid phone number';
  return e;
}

function BookingModal({ flight, onClose }) {
  const [form, setForm] = useState({
    title: 'mr',
    firstName: '',
    lastName: '',
    email: '',
    dateOfBirth: '',
    gender: 'M',
    phone: '',
  });
  const [status, setStatus] = useState('idle');
  const [booking, setBooking] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');

  const currency = flight.currency || 'EUR';
  const symbol = currency === 'EUR' ? '€' : '$';

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    // Clear field error on change
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const fieldErrors = validate(form);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setStatus('loading');
    setSubmitError('');

    try {
      const res = await fetch('/api/flights/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerId: flight.offerId,
          passengerIds: flight.passengerIds || [],
          passengerInfo: [form],
          currency,
          totalAmount: flight.price,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setBooking(data.data);
        setStatus('success');
      } else {
        setStatus('error');
        setSubmitError(data.message || 'Booking failed. Please try again.');
      }
    } catch (err) {
      setStatus('error');
      setSubmitError('Network error. Please check your connection.');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        {status === 'success' ? (
          <ConfirmationScreen booking={booking} flight={flight} onClose={onClose} />
        ) : (
          <>
            <div className="modal-header">
              <h2>Book Flight</h2>
              <div className="modal-flight-summary">
                <span className="modal-route">
                  {flight.departure.code} → {flight.arrival.code}
                </span>
                <span className="modal-meta">
                  {formatDate(flight.departureTime)} · {formatTime(flight.departureTime)}
                </span>
                <span className="modal-price">{symbol}{flight.price}</span>
              </div>
            </div>

            <form className="booking-form" onSubmit={handleSubmit}>
              {/* Row: Title + First + Last */}
              <div className="form-row form-row-name">
                <div className="form-group form-group-title">
                  <label>Title</label>
                  <select name="title" value={form.title} onChange={handleChange}>
                    <option value="mr">Mr</option>
                    <option value="ms">Ms</option>
                    <option value="mrs">Mrs</option>
                    <option value="miss">Miss</option>
                    <option value="dr">Dr</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>First Name</label>
                  <input
                    name="firstName"
                    value={form.firstName}
                    onChange={handleChange}
                    placeholder="John"
                    className={errors.firstName ? 'input-error' : ''}
                  />
                  {errors.firstName && <span className="field-error">{errors.firstName}</span>}
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input
                    name="lastName"
                    value={form.lastName}
                    onChange={handleChange}
                    placeholder="Smith"
                    className={errors.lastName ? 'input-error' : ''}
                  />
                  {errors.lastName && <span className="field-error">{errors.lastName}</span>}
                </div>
              </div>

              {/* Email */}
              <div className="form-group">
                <label>Email</label>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="john@example.com"
                  className={errors.email ? 'input-error' : ''}
                />
                {errors.email && <span className="field-error">{errors.email}</span>}
              </div>

              {/* Date of Birth + Gender */}
              <div className="form-row">
                <div className="form-group form-group-dob">
                  <label>
                    Date of Birth
                    <span className="field-hint"> · 18+</span>
                  </label>
                  <DateOfBirthPicker
                    value={form.dateOfBirth}
                    onChange={(v) => {
                      setForm(prev => ({ ...prev, dateOfBirth: v }));
                      if (errors.dateOfBirth) setErrors(prev => ({ ...prev, dateOfBirth: undefined }));
                    }}
                  />
                  {errors.dateOfBirth && <span className="field-error">{errors.dateOfBirth}</span>}
                </div>
                <div className="form-group form-group-gender">
                  <label>Gender</label>
                  <div className="gender-toggle">
                    {[['M', 'Male'], ['F', 'Female']].map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        className={`gender-btn${form.gender === val ? ' active' : ''}`}
                        onClick={() => setForm(prev => ({ ...prev, gender: val }))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Phone */}
              <div className="form-group">
                <label>Phone <span className="field-hint">(optional)</span></label>
                <input
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="+1 555 000 0000"
                  className={errors.phone ? 'input-error' : ''}
                />
                {errors.phone && <span className="field-error">{errors.phone}</span>}
              </div>

              {submitError && <div className="booking-error">{submitError}</div>}

              <div className="form-footer">
                <span className="total-label">Total: <strong>{symbol}{flight.price} {currency}</strong></span>
                <button
                  type="submit"
                  className="btn-confirm"
                  disabled={status === 'loading'}
                >
                  {status === 'loading' ? 'Processing…' : `Pay ${symbol}${flight.price}`}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default BookingModal;
