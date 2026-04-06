import { useState, useEffect, useRef } from 'react';
import { formatTime, formatDate } from '../utils/formatters';
import { MONTHS } from '../utils/constants';
import { API_BASE } from '../utils/api';
import './BookingModal.css';

function daysInMonth(month, year) {
  if (!month || !year) return 31;
  // day=0 rolls back to last day of previous month; month is 1-based here
  return new Date(Number(year), Number(month), 0).getDate();
}

function DateOfBirthPicker({ onChange, onBlur }) {
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

  const notifyBlur = (d, m, y) => {
    if (onBlur) onBlur(d, m, y);
  };

  const handleDay = (e) => {
    const val = e.target.value;
    setDay(val);
    emit(val, month, year);
    notifyBlur(val, month, year);
  };
  const handleMonth = (e) => {
    const newMonth = e.target.value;
    const maxD = daysInMonth(newMonth, year);
    const clampedDay = day && Number(day) > maxD ? String(maxD) : day;
    setMonth(newMonth);
    if (clampedDay !== day) setDay(clampedDay);
    emit(clampedDay, newMonth, year);
    notifyBlur(clampedDay, newMonth, year);
  };
  const handleYear = (e) => {
    const val = e.target.value;
    setYear(val);
    emit(day, month, val);
    notifyBlur(day, month, val);
  };

  const totalDays = daysInMonth(month, year);

  return (
    <div className="dob-picker" role="group" aria-labelledby="bm-dob-label">
      <select id="bm-dob-day" className="dob-select" value={day} onChange={handleDay} aria-label="Day of birth">
        <option value="">Day</option>
        {Array.from({ length: totalDays }, (_, i) => i + 1).map(d => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      <select id="bm-dob-month" className="dob-select dob-month" value={month} onChange={handleMonth} aria-label="Month of birth">
        <option value="">Month</option>
        {MONTHS.map((name, i) => (
          <option key={i} value={i + 1}>{name}</option>
        ))}
      </select>

      <select id="bm-dob-year" className="dob-select" value={year} onChange={handleYear} aria-label="Year of birth">
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
      <div className="confirm-details">
        <span>{flight.airline}</span>
        <span>{flight.flightNumber}</span>
        <span>{formatTime(flight.departureTime)}</span>
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
  if (!form.phone || !PHONE_RE.test(form.phone)) e.phone = 'Enter a valid phone number (required by carrier)';
  return e;
}

function getFocusable(container) {
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
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
  const [touched, setTouched] = useState({});
  const [status, setStatus] = useState('idle');
  const [booking, setBooking] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');

  const modalRef = useRef(null);
  const triggerRef = useRef(document.activeElement); // capture opener for return focus
  const currency = flight.currency || 'EUR';
  const symbol = currency === 'EUR' ? '€' : '$';

  // Lock body scroll, focus first element, trap focus, return focus on close
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const el = modalRef.current;
    if (!el) return;
    const focusable = getFocusable(el);
    if (focusable.length) focusable[0].focus();

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = getFocusable(el);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
      // Return focus to the element that opened the modal
      if (triggerRef.current && typeof triggerRef.current.focus === 'function') {
        triggerRef.current.focus();
      }
    };
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: undefined }));
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));
    const fieldErrors = validate({ ...form });
    setErrors(prev => ({ ...prev, [name]: fieldErrors[name] }));
  };

  const handleDateOfBirthBlur = () => {
    setTouched(prev => ({ ...prev, dateOfBirth: true }));
    const fieldErrors = validate({ ...form });
    setErrors(prev => ({ ...prev, dateOfBirth: fieldErrors.dateOfBirth }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched({ firstName: true, lastName: true, email: true, dateOfBirth: true, phone: true });
    const fieldErrors = validate(form);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setStatus('loading');
    setSubmitError('');

    try {
      const res = await fetch(`${API_BASE}/api/flights/book`, {
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

      let data;
      try { data = await res.json(); } catch (_) { data = {}; }

      if (res.ok && data.success) {
        setBooking(data.data);
        setStatus('success');
      } else {
        setStatus('error');
        setSubmitError(data.message || 'Booking failed. Please try again.');
      }
    } catch (err) {
      setStatus('error');
      setSubmitError(err?.name === 'AbortError' ? 'Request cancelled.' : 'Connection error. Please try again.');
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="none"
    >
      <div
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bm-title"
        ref={modalRef}
        onClick={e => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close booking modal">✕</button>

        {status === 'success' ? (
          <ConfirmationScreen booking={booking} flight={flight} onClose={onClose} />
        ) : (
          <>
            <div className="modal-header">
              <h2 id="bm-title">Book Flight</h2>
              <div className="modal-flight-summary">
                <span className="modal-route">
                  {flight.departure.code} → {flight.arrival.code}
                </span>
                <span className="modal-meta">
                  {formatDate(flight.departureTime)} · {formatTime(flight.departureTime)}
                </span>
                <div className="modal-price-block">
                  <span className="modal-price">{symbol}{flight.price}</span>
                  <span className="modal-price-note">per person · excl. taxes</span>
                </div>
              </div>
            </div>

            <form className="booking-form" onSubmit={handleSubmit} noValidate>
              {/* Row: Title + First + Last */}
              <div className="form-row form-row-name">
                <div className="form-group form-group-title">
                  <label htmlFor="bm-title-select">Title</label>
                  <select id="bm-title-select" name="title" value={form.title} onChange={handleChange}>
                    <option value="mr">Mr</option>
                    <option value="ms">Ms</option>
                    <option value="mrs">Mrs</option>
                    <option value="miss">Miss</option>
                    <option value="dr">Dr</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="bm-firstName">First Name</label>
                  <input
                    id="bm-firstName"
                    name="firstName"
                    value={form.firstName}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="John"
                    autoComplete="given-name"
                    aria-describedby={touched.firstName && errors.firstName ? 'bm-firstName-err' : undefined}
                    aria-invalid={touched.firstName ? !!errors.firstName : undefined}
                    className={touched.firstName && errors.firstName ? 'input-error' : ''}
                  />
                  {touched.firstName && errors.firstName && <span id="bm-firstName-err" className="field-error" role="alert">{errors.firstName}</span>}
                </div>
                <div className="form-group">
                  <label htmlFor="bm-lastName">Last Name</label>
                  <input
                    id="bm-lastName"
                    name="lastName"
                    value={form.lastName}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="Smith"
                    autoComplete="family-name"
                    aria-describedby={touched.lastName && errors.lastName ? 'bm-lastName-err' : undefined}
                    aria-invalid={touched.lastName ? !!errors.lastName : undefined}
                    className={touched.lastName && errors.lastName ? 'input-error' : ''}
                  />
                  {touched.lastName && errors.lastName && <span id="bm-lastName-err" className="field-error" role="alert">{errors.lastName}</span>}
                </div>
              </div>

              {/* Email */}
              <div className="form-group">
                <label htmlFor="bm-email">Email</label>
                <input
                  id="bm-email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="john@example.com"
                  autoComplete="email"
                  aria-describedby={touched.email && errors.email ? 'bm-email-err' : undefined}
                  aria-invalid={touched.email ? !!errors.email : undefined}
                  className={touched.email && errors.email ? 'input-error' : ''}
                />
                {touched.email && errors.email && <span id="bm-email-err" className="field-error" role="alert">{errors.email}</span>}
              </div>

              {/* Date of Birth + Gender */}
              <div className="form-row">
                <div className="form-group form-group-dob">
                  <label id="bm-dob-label">
                    Date of Birth
                    <span className="field-hint"> · 18+</span>
                  </label>
                  <DateOfBirthPicker
                    value={form.dateOfBirth}
                    onChange={(v) => {
                      setForm(prev => ({ ...prev, dateOfBirth: v }));
                      if (errors.dateOfBirth) setErrors(prev => ({ ...prev, dateOfBirth: undefined }));
                    }}
                    onBlur={handleDateOfBirthBlur}
                  />
                  {touched.dateOfBirth && errors.dateOfBirth && <span id="bm-dob-err" className="field-error" role="alert">{errors.dateOfBirth}</span>}
                </div>
                <div className="form-group form-group-gender">
                  <span id="bm-gender-label" className="form-label-text">
                    Gender
                    <span className="field-hint"> · required by carrier</span>
                  </span>
                  <div className="gender-toggle" role="group" aria-labelledby="bm-gender-label">
                    {[['M', 'Male'], ['F', 'Female']].map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        className={`gender-btn${form.gender === val ? ' active' : ''}`}
                        aria-pressed={form.gender === val}
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
                <label htmlFor="bm-phone">
                  Phone <span className="field-hint"> · required by carrier</span>
                </label>
                <input
                  id="bm-phone"
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="+1 555 000 0000"
                  autoComplete="tel"
                  aria-describedby={touched.phone && errors.phone ? 'bm-phone-err' : undefined}
                  aria-invalid={touched.phone ? !!errors.phone : undefined}
                  className={touched.phone && errors.phone ? 'input-error' : ''}
                />
                {touched.phone && errors.phone && <span id="bm-phone-err" className="field-error" role="alert">{errors.phone}</span>}
              </div>

              {submitError && <div className="booking-error" role="alert">{submitError}</div>}

              <div className="form-footer">
                <div className="total-block">
                  <span className="total-label">Total</span>
                  <span className="total-amount"><strong>{symbol}{flight.price} {currency}</strong></span>
                  <span className="total-note">excl. taxes &amp; fees · 1 passenger</span>
                </div>
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
