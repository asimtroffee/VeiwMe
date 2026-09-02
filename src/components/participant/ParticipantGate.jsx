import React, { useState } from 'react';
import { recordSessionAttendee, isTesterAccount } from '../../services/storage';
import { formatDateDisplay, formatEventDateRange, formatCategoryName, resolveCategoryInSession } from '../../services/timeUtils';

export default function ParticipantGate({ session, onGatePassed }) {
  const sessionCategories = session?.categories && session.categories.length > 0
    ? session.categories
    : ['Category A', 'Category B', 'Category C'];

  const [name, setName] = useState('');
  const [category, setCategory] = useState(sessionCategories[0] || 'Category A');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState({});

  // --- Validation helpers ---

  // Full name: at least 2 words, each word ≥ 2 letters, only letters/hyphens/apostrophes/spaces
  const validateFullName = (str) => {
    const trimmed = (str || '').trim();
    if (!trimmed) return 'Please enter your full name.';
    // Only allow letters (including accented), hyphens, apostrophes, and spaces
    if (/[^a-zA-Z\u00C0-\u024F\u1E00-\u1EFF'\-\s]/.test(trimmed)) {
      return 'Name can only contain letters, hyphens, and apostrophes.';
    }
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    if (words.length < 2) {
      return 'Please enter your first and last name (e.g. "Sara Connor").';
    }
    const shortWord = words.find(w => w.replace(/['\-]/g, '').length < 2);
    if (shortWord) {
      return `Each part of your name must be at least 2 letters. "${shortWord}" is too short.`;
    }
    return null; // valid
  };

  // Email
  const validateEmail = (str) => {
    const trimmed = (str || '').trim();
    if (!trimmed) return 'Please enter your email address.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      return 'Please enter a valid email (e.g. name@example.com).';
    }
    return null;
  };

  // Phone: must contain at least 10 digits after stripping formatting
  const validatePhone = (str) => {
    const trimmed = (str || '').trim();
    if (!trimmed) return 'Please enter your phone number.';
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      return 'Phone number must have at least 10 digits (e.g. +1 555 019 2834).';
    }
    if (digitsOnly.length > 15) {
      return 'Phone number is too long. Please check and re-enter.';
    }
    // Must start with optional + then digits
    if (!/^[+]?[\d\s()\-\.]+$/.test(trimmed)) {
      return 'Phone number can only contain digits, spaces, +, -, (, and ).';
    }
    return null;
  };

  const nameError = touched.name ? validateFullName(name) : null;
  const emailError = touched.email ? validateEmail(email) : null;
  const phoneError = touched.phone ? validatePhone(phone) : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Mark all as touched to show inline errors
    setTouched({ name: true, email: true, phone: true });

    const trimmedName = name.trim();
    const trimmedCategory = resolveCategoryInSession(sessionCategories, category);
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();

    // Run all validations
    const nameErr = validateFullName(trimmedName);
    if (nameErr) { setError(nameErr); return; }

    if (!trimmedCategory) {
      setError('Please select a Category.');
      return;
    }

    const emailErr = validateEmail(trimmedEmail);
    if (emailErr) { setError(emailErr); return; }

    const phoneErr = validatePhone(trimmedPhone);
    if (phoneErr) { setError(phoneErr); return; }

    const isTester = isTesterAccount({ email: trimmedEmail, contact: `${trimmedEmail} • ${trimmedPhone}`, name: trimmedName });

    setIsSubmitting(true);

    try {
      // Record attendee check-in in the database immediately
      const attendee = await recordSessionAttendee(session.id, {
        name: trimmedName,
        category: trimmedCategory,
        email: trimmedEmail,
        phone: trimmedPhone,
        contact: `${trimmedEmail} • ${trimmedPhone}`,
        editCount: 0,
        isTester
      });

      setTimeout(() => {
        setIsSubmitting(false);
        onGatePassed({
          name: attendee.name,
          category: attendee.category || trimmedCategory,
          email: attendee.email || trimmedEmail,
          phone: attendee.phone || trimmedPhone,
          contact: attendee.contact || `${trimmedEmail} • ${trimmedPhone}`,
          editCount: 0,
          id: attendee.id,
          isTester
        });
      }, 200);
    } catch (err) {
      setIsSubmitting(false);
      setError('Failed to record your check-in. Please try again.');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
        backgroundColor: 'var(--color-background)',
        position: 'relative'
      }}
    >
      {/* Quick Navigation Back to Admin */}
      <div style={{ maxWidth: '540px', width: '100%', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a
          href="#/admin"
          className="btn btn-ghost btn-sm"
          style={{ paddingLeft: '4px', fontSize: '13px', color: 'var(--color-secondary)' }}
          title="Return to Admin Sessions Dashboard"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_back</span>
          <span>Back to Admin Console</span>
        </a>
      </div>

      <div className="card" style={{ maxWidth: '540px', width: '100%', padding: '36px 32px' }}>
        {/* Header / Session Info */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--color-secondary-container)',
              color: 'var(--color-primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px'
            }}
          >
            <span className="material-symbols-outlined fill" style={{ fontSize: '28px' }}>
              calendar_month
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <span className="chip chip-accent">
              <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '4px' }}>
                {session.eventType === 'multi' || session.days?.length > 1 ? 'date_range' : 'event'}
              </span>
              {formatEventDateRange(session)}
            </span>
            {(!session.days || session.days.length <= 1) && (
              <span className="chip chip-neutral">
                <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '4px' }}>schedule</span>
                {session.startTime} – {session.endTime} ({session.timezone})
              </span>
            )}
            <span className="chip chip-neutral">
              <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '4px' }}>timer</span>
              {session.slotDuration || 15} min slots
            </span>
            {session.days?.length > 1 && (
              <span className="chip chip-neutral">
                {session.timezone} Timezone
              </span>
            )}
          </div>

          <h1 className="headline-md" style={{ color: 'var(--color-primary)', marginBottom: '8px' }}>
            {session.title}
          </h1>

          <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
            Welcome to the self-scheduling portal. Please confirm your details below to view and select your preferred time slot.
          </p>
        </div>

        {/* Eye-catching Candidate Instructions / Description Banner */}
        {session.description && (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, rgba(254, 243, 199, 0.5) 0%, rgba(255, 251, 235, 0.95) 100%)',
              border: '1.5px solid #f59e0b',
              borderLeft: '5px solid #d97706',
              marginBottom: '20px',
              textAlign: 'left',
              boxShadow: '0 3px 10px rgba(217, 119, 6, 0.08)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span className="material-symbols-outlined fill" style={{ fontSize: '18px', color: '#d97706' }}>
                tips_and_updates
              </span>
              <span style={{ fontWeight: '800', fontSize: '12px', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Important Candidate Instructions
              </span>
            </div>
            <p style={{ color: '#78350f', fontSize: '13px', lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>
              {session.description}
            </p>
          </div>
        )}

        {/* Identity Check-in Prompt */}
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-surface-container)',
            border: '1px solid var(--color-outline-variant)',
            color: 'var(--color-on-surface-variant)',
            fontSize: '13px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--color-primary)' }}>
            badge
          </span>
          <div>
            <strong>Step 1: Check In</strong> — Enter your details to record your attendance and unlock live slot booking.
          </div>
        </div>

        {/* Gate Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label className="input-label" htmlFor="cand-name">
              Your Full Name *
            </label>
            <input
              id="cand-name"
              type="text"
              className="input-field"
              placeholder="e.g. Eleanor Vance"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(p => ({ ...p, name: true }))}
              required
              autoFocus
              disabled={isSubmitting}
              style={nameError ? { borderColor: 'var(--color-error)', boxShadow: '0 0 0 1px var(--color-error)' } : {}}
            />
            {nameError && (
              <span style={{ fontSize: '12px', color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '5px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>warning</span>
                {nameError}
              </span>
            )}
            {!nameError && touched.name && name.trim() && (
              <span style={{ fontSize: '12px', color: 'var(--color-success, #16a34a)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '5px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check_circle</span>
                Looks good!
              </span>
            )}
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label className="input-label" htmlFor="cand-category">
              Category *
            </label>
            <select
              id="cand-category"
              className="input-field"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
              disabled={isSubmitting}
              style={{ backgroundColor: 'var(--color-surface)' }}
            >
              {sessionCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {formatCategoryName(cat)}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label className="input-label" htmlFor="cand-email">
              Email Address *
            </label>
            <input
              id="cand-email"
              type="email"
              className="input-field"
              placeholder="e.g. eleanor@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(p => ({ ...p, email: true }))}
              required
              disabled={isSubmitting}
              style={emailError ? { borderColor: 'var(--color-error)', boxShadow: '0 0 0 1px var(--color-error)' } : {}}
            />
            {emailError && (
              <span style={{ fontSize: '12px', color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '5px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>warning</span>
                {emailError}
              </span>
            )}
            {!emailError && touched.email && email.trim() && (
              <span style={{ fontSize: '12px', color: 'var(--color-success, #16a34a)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '5px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check_circle</span>
                Valid email
              </span>
            )}
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label className="input-label" htmlFor="cand-phone">
              Phone Number *
            </label>
            <input
              id="cand-phone"
              type="tel"
              className="input-field"
              placeholder="e.g. +1 (555) 019-2834"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => setTouched(p => ({ ...p, phone: true }))}
              required
              disabled={isSubmitting}
              style={phoneError ? { borderColor: 'var(--color-error)', boxShadow: '0 0 0 1px var(--color-error)' } : {}}
            />
            {phoneError && (
              <span style={{ fontSize: '12px', color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '5px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>warning</span>
                {phoneError}
              </span>
            )}
            {!phoneError && touched.phone && phone.trim() && (
              <span style={{ fontSize: '12px', color: 'var(--color-success, #16a34a)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '5px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check_circle</span>
                Valid phone number
              </span>
            )}
            <span style={{ fontSize: '11px', color: 'var(--color-secondary)', display: 'block', marginTop: '4px' }}>
              Your email and phone will be used to record attendance and send your booking confirmation.
            </span>
          </div>

          {error && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-error-container)',
                color: 'var(--color-on-error-container)',
                fontSize: '13px',
                marginBottom: '18px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                error
              </span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%' }}
            disabled={isSubmitting}
          >
            <span>{isSubmitting ? 'Recording Check-in...' : 'Check In & View Slots'}</span>
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
        </form>
      </div>
    </div>
  );
}

