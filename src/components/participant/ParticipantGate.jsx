import React, { useState } from 'react';
import { recordSessionAttendee } from '../../services/storage';
import { formatDateDisplay } from '../../services/timeUtils';

export default function ParticipantGate({ session, onGatePassed }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('A');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Validation helpers
  const isValidEmail = (str) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
  const isValidPhone = (str) => /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/.test(str.replace(/\s+/g, '')) || str.replace(/\D/g, '').length >= 10;

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    const trimmedName = name.trim();
    const trimmedCategory = category;
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();

    if (!trimmedName || trimmedName.length < 2) {
      setError('Please enter your full name.');
      return;
    }

    if (!trimmedCategory) {
      setError('Please select a Category (A, B, or C).');
      return;
    }

    if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
      setError('Please enter a valid email address (e.g. name@example.com).');
      return;
    }

    if (!trimmedPhone || !isValidPhone(trimmedPhone)) {
      setError('Please enter a valid phone number (e.g. +1 555-019-2834).');
      return;
    }

    setIsSubmitting(true);

    try {
      // Record attendee check-in in the database immediately
      const attendee = recordSessionAttendee(session.id, {
        name: trimmedName,
        category: trimmedCategory,
        email: trimmedEmail,
        phone: trimmedPhone,
        contact: `${trimmedEmail} • ${trimmedPhone}`,
        editCount: 0
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
          id: attendee.id
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
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
        backgroundColor: 'var(--color-background)'
      }}
    >
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
              <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '4px' }}>event</span>
              {formatDateDisplay(session.date)}
            </span>
            <span className="chip chip-neutral">
              <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '4px' }}>schedule</span>
              {session.startTime} – {session.endTime} ({session.timezone})
            </span>
            <span className="chip chip-neutral">
              <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '4px' }}>timer</span>
              {session.slotDuration || 15} min interviews
            </span>
          </div>

          <h1 className="headline-md" style={{ color: 'var(--color-primary)', marginBottom: '8px' }}>
            {session.title}
          </h1>

          <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
            Welcome to the interview self-scheduling portal. Please confirm your details below to view and select your preferred interview time slot.
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
              required
              autoFocus
              disabled={isSubmitting}
            />
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
              <option value="A">Category A</option>
              <option value="B">Category B</option>
              <option value="C">Category C</option>
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
              required
              disabled={isSubmitting}
            />
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
              required
              disabled={isSubmitting}
            />
            <span style={{ fontSize: '11px', color: 'var(--color-secondary)', display: 'block', marginTop: '4px' }}>
              Your email and phone will be used to record attendance and send your interview confirmation.
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

