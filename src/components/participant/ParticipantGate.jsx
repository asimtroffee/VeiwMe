import React, { useState } from 'react';
import { recordSessionAttendee } from '../../services/storage';
import { formatDateDisplay } from '../../services/timeUtils';

export default function ParticipantGate({ session, onGatePassed }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Validation helpers
  const isValidEmail = (str) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
  const isValidPhone = (str) => /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/.test(str.replace(/\s+/g, '')) || str.replace(/\D/g, '').length >= 10;

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    const trimmedName = name.trim();
    const trimmedContact = contact.trim();

    if (!trimmedName || trimmedName.length < 2) {
      setError('Please enter your full name.');
      return;
    }

    if (!trimmedContact) {
      setError('Please provide your email address or phone number.');
      return;
    }

    // Check if valid email or valid phone
    const isEmail = isValidEmail(trimmedContact);
    const isPhone = isValidPhone(trimmedContact);

    if (!isEmail && !isPhone) {
      setError('Please enter a valid email address (e.g. name@example.com) or phone number.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Record attendee check-in in the database immediately
      const attendee = recordSessionAttendee(session.id, {
        name: trimmedName,
        contact: trimmedContact
      });

      setTimeout(() => {
        setIsSubmitting(false);
        onGatePassed({
          name: attendee.name,
          contact: attendee.contact,
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
        padding: '24px',
        backgroundColor: 'var(--color-background)'
      }}
    >
      <div className="card" style={{ maxWidth: '480px', width: '100%', padding: '36px 32px' }}>
        {/* Header Branding */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
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
              badge
            </span>
          </div>

          <span className="chip chip-neutral" style={{ marginBottom: '12px' }}>
            {session.timezone} Timezone • {session.slotDuration || 15} min slots
          </span>

          <h1 className="headline-md" style={{ color: 'var(--color-primary)', marginBottom: '8px' }}>
            {session.title}
          </h1>

          <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
            Scheduled for <strong>{formatDateDisplay(session.date)}</strong> ({session.startTime} – {session.endTime})
          </p>
        </div>

        {/* Informational Prompt */}
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-surface-container)',
            color: 'var(--color-on-surface-variant)',
            fontSize: '13px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--color-primary)' }}>
            lock
          </span>
          <div>
            <strong>Identity Check-in:</strong> Please enter your details below to record your attendance and view available slots.
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

          <div style={{ marginBottom: '24px' }}>
            <label className="input-label" htmlFor="cand-contact">
              Email Address or Phone Number *
            </label>
            <input
              id="cand-contact"
              type="text"
              className="input-field"
              placeholder="e.g. eleanor@example.com or +1 (555) 019-2834"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              required
              disabled={isSubmitting}
            />
            <span style={{ fontSize: '11px', color: 'var(--color-secondary)', display: 'block', marginTop: '4px' }}>
              Your contact info will be used to record your attendance and confirm your interview slot.
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
