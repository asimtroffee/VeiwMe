import React, { useState, useEffect, useMemo } from 'react';
import { getSessionDetails, bookSlot, cancelBooking, subscribeToSync } from '../../services/storage';
import { formatDateDisplay } from '../../services/timeUtils';
import ConfirmModal from '../common/ConfirmModal';

export default function ParticipantBoard({ session: initialSession, participantProfile, onSwitchProfile, onShowToast }) {
  const [session, setSession] = useState(initialSession);
  const [filterPeriod, setFilterPeriod] = useState('all'); // all | morning | afternoon | evening | open
  const [selectedSlotForBooking, setSelectedSlotForBooking] = useState(null);
  const [bookingConflictError, setBookingConflictError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slotToCancel, setSlotToCancel] = useState(null);
  const [alreadyBookedWarning, setAlreadyBookedWarning] = useState(null);

  const duration = session.slotDuration || 15;

  const loadData = () => {
    const fresh = getSessionDetails(session.id);
    if (fresh) {
      setSession(fresh);
    }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = subscribeToSync(() => {
      loadData();
    });
    return () => unsubscribe();
  }, [session.id]);

  // Check if current participant already has an active booking in this session
  const myBooking = useMemo(() => {
    if (!session || !session.slots || !participantProfile) return null;
    return session.slots.find(
      (slot) =>
        slot.isBooked &&
        (slot.booking.candidateContact.toLowerCase() === participantProfile.contact.toLowerCase() ||
          slot.booking.candidateName.toLowerCase() === participantProfile.name.toLowerCase())
    );
  }, [session, participantProfile]);

  const filteredSlots = useMemo(() => {
    if (!session || !session.slots) return [];
    return session.slots.filter((slot) => {
      if (filterPeriod === 'open') return !slot.isBooked;
      if (filterPeriod === 'morning') return slot.period === 'morning';
      if (filterPeriod === 'afternoon') return slot.period === 'afternoon';
      if (filterPeriod === 'evening') return slot.period === 'evening';
      return true;
    });
  }, [session, filterPeriod]);

  const handleOpenBookingModal = (slot) => {
    if (myBooking) {
      setAlreadyBookedWarning(slot);
      return;
    }
    setBookingConflictError('');
    setSelectedSlotForBooking(slot);
  };

  const handleConfirmBooking = (e) => {
    e.preventDefault();
    if (!selectedSlotForBooking || isSubmitting) return;

    setIsSubmitting(true);
    setBookingConflictError('');

    const res = bookSlot(session.id, selectedSlotForBooking.id, {
      candidateName: participantProfile.name,
      candidateContact: participantProfile.contact
    });

    setIsSubmitting(false);

    if (res.success) {
      onShowToast(`Slot booked successfully for ${selectedSlotForBooking.timeLabel}!`);
      setSelectedSlotForBooking(null);
      loadData();
    } else {
      // Conflict or already reserved
      setBookingConflictError(res.error || 'This slot is no longer available.');
      loadData();
    }
  };

  const handleConfirmCancelMyBooking = () => {
    if (!slotToCancel) return;
    const res = cancelBooking(session.id, slotToCancel.id);
    if (res.success) {
      onShowToast('Your interview slot booking has been cancelled.');
      loadData();
    }
    setSlotToCancel(null);
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-background)', display: 'flex', flexDirection: 'column' }}>
      {/* Top App Bar matching Design System */}
      <header
        style={{
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-outline-variant)',
          padding: '14px 24px',
          position: 'sticky',
          top: 0,
          zIndex: 100
        }}
      >
        <div
          style={{
            maxWidth: 'var(--max-width)',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          {/* Logo & Session Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined fill" style={{ fontSize: '24px', color: 'var(--color-primary)' }}>
                calendar_month
              </span>
              <span className="font-headline headline-md" style={{ color: 'var(--color-primary)', fontWeight: '800' }}>
                ViewMe
              </span>
            </div>
            <span style={{ color: 'var(--color-outline)', fontSize: '18px' }}>/</span>
            <span className="headline-sm" style={{ color: 'var(--color-secondary)' }}>
              {session.title}
            </span>
          </div>

          {/* Participant Profile Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 14px',
                backgroundColor: 'var(--color-surface-container-high)',
                borderRadius: 'var(--radius-full)',
                fontSize: '13px',
                color: 'var(--color-primary)'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                person
              </span>
              <span>
                Booking as <strong>{participantProfile.name}</strong>
              </span>
              <button
                onClick={onSwitchProfile}
                style={{
                  marginLeft: '4px',
                  color: 'var(--color-secondary)',
                  textDecoration: 'underline',
                  fontSize: '12px'
                }}
              >
                Switch
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout Area */}
      <main
        style={{
          maxWidth: 'var(--max-width)',
          margin: '0 auto',
          padding: '32px 24px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '28px',
          flex: 1
        }}
      >
        {/* Active Booking Banner (if participant has booked a slot) */}
        {myBooking && (
          <div
            className="card"
            style={{
              backgroundColor: '#edf7f1',
              border: '2px solid var(--color-success)',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '16px',
              padding: '20px 24px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--color-success)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>
                  check
                </span>
              </div>
              <div>
                <div className="label-sm" style={{ color: 'var(--color-success)' }}>
                  YOUR INTERVIEW IS CONFIRMED (1 SLOT PER PERSON)
                </div>
                <h2 className="headline-md" style={{ color: 'var(--color-primary)', marginTop: '2px' }}>
                  {myBooking.timeLabel} • {formatDateDisplay(session.date)}
                </h2>
                <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
                  Candidate: {myBooking.booking.candidateName} ({myBooking.booking.candidateContact})
                </p>
              </div>
            </div>

            <button
              className="btn btn-danger"
              onClick={() => setSlotToCancel(myBooking)}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                cancel
              </span>
              <span>Cancel / Change My Slot</span>
            </button>
          </div>
        )}

        {/* Layout: Left Sidebar + Center Grid */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '28px', alignItems: 'flex-start' }}>
          {/* Left Sidebar: Session Info */}
          <aside style={{ width: '280px', flexShrink: 0 }}>
            <div className="card" style={{ padding: '24px' }}>
              <h2 className="headline-md" style={{ color: 'var(--color-primary)', marginBottom: '16px' }}>
                Interview Details
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', marginTop: '2px' }}>
                    calendar_month
                  </span>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: 'var(--color-primary)' }}>
                      {formatDateDisplay(session.date)}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-secondary)' }}>Date of Session</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', marginTop: '2px' }}>
                    schedule
                  </span>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: 'var(--color-primary)' }}>
                      {duration} Minutes
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-secondary)' }}>
                      {session.startTime} – {session.endTime} ({session.timezone})
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', marginTop: '2px' }}>
                    videocam
                  </span>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: 'var(--color-primary)' }}>
                      Video Meeting
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-secondary)' }}>Link sent upon booking</div>
                  </div>
                </div>
              </div>

              {session.description && (
                <div style={{ borderTop: '1px solid var(--color-outline-variant)', paddingTop: '16px' }}>
                  <div className="label-sm" style={{ color: 'var(--color-secondary)', marginBottom: '6px' }}>
                    Instructions
                  </div>
                  <p className="body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                    {session.description}
                  </p>
                </div>
              )}
            </div>
          </aside>

          {/* Center Content: Slot Grid */}
          <section style={{ flex: 1, minWidth: '300px' }}>
            {/* Header & Filter Controls */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '16px',
                marginBottom: '20px'
              }}
            >
              <div>
                <h2 className="headline-lg" style={{ color: 'var(--color-primary)' }}>
                  Select an Interview Time
                </h2>
                <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
                  {myBooking
                    ? 'You have already booked a slot. Cancel your slot above if you wish to change times.'
                    : `Each candidate can reserve one ${duration}-minute slot.`}
                </p>
              </div>

              {/* Time Period Filter Tabs */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { key: 'all', label: 'All Slots' },
                  { key: 'open', label: 'Open Only' },
                  { key: 'morning', label: 'Morning' },
                  { key: 'afternoon', label: 'Afternoon' },
                  { key: 'evening', label: 'Evening' }
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setFilterPeriod(tab.key)}
                    className={`btn btn-sm ${filterPeriod === tab.key ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Slots Grid */}
            <div className="slots-grid">
              {filteredSlots.map((slot) => {
                const isMine =
                  slot.isBooked &&
                  (slot.booking.candidateContact.toLowerCase() === participantProfile.contact.toLowerCase() ||
                    slot.booking.candidateName.toLowerCase() === participantProfile.name.toLowerCase());

                if (slot.isBooked) {
                  return (
                    <div
                      key={slot.id}
                      className={`slot-card booked ${isMine ? 'my-booking' : ''}`}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <span className="label-md" style={{ color: 'var(--color-primary)', fontWeight: '700' }}>
                            {slot.timeLabel}
                          </span>
                          <span className={`chip ${isMine ? 'chip-success' : 'chip-neutral'}`}>
                            {isMine ? 'Your Slot' : 'Booked'}
                          </span>
                        </div>

                        <div style={{ marginTop: '8px' }}>
                          <div style={{ fontWeight: '600', color: 'var(--color-primary)', fontSize: '13px' }}>
                            {isMine ? `Reserved for you (${slot.booking.candidateName})` : slot.booking.candidateName}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--color-secondary)', marginTop: '2px' }}>
                            {duration} min interview block
                          </div>
                        </div>
                      </div>

                      {isMine && (
                        <div style={{ marginTop: '12px', textAlign: 'right' }}>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => setSlotToCancel(slot)}
                          >
                            Cancel Slot
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }

                // Available Slot
                return (
                  <div
                    key={slot.id}
                    className="slot-card available"
                    onClick={() => handleOpenBookingModal(slot)}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span className="label-md" style={{ color: 'var(--color-primary)', fontWeight: '700' }}>
                          {slot.timeLabel}
                        </span>
                        <span className="chip chip-success">Available</span>
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--color-secondary)', marginTop: '4px' }}>
                        {duration} mins • Video Call
                      </div>
                    </div>

                    <div style={{ marginTop: '14px', textAlign: 'right' }}>
                      <button className="btn btn-sm btn-primary" type="button">
                        <span>Book Slot</span>
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                          arrow_forward
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredSlots.length === 0 && (
              <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--color-secondary)' }}>
                No time slots match the selected period.
              </div>
            )}
          </section>
        </div>
      </main>

      {/* 1-Click Booking Confirmation Modal */}
      {selectedSlotForBooking && (
        <div className="modal-overlay" onClick={() => setSelectedSlotForBooking(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 className="headline-md" style={{ color: 'var(--color-primary)' }}>
                Confirm Interview Booking
              </h3>
              <button onClick={() => setSelectedSlotForBooking(null)} style={{ color: 'var(--color-secondary)' }}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div
              style={{
                padding: '16px',
                borderRadius: 'var(--radius-lg)',
                backgroundColor: 'var(--color-surface-container)',
                marginBottom: '20px'
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--color-secondary)', textTransform: 'uppercase' }}>
                Selected Time Slot
              </div>
              <div className="headline-md" style={{ color: 'var(--color-primary)', margin: '4px 0' }}>
                {selectedSlotForBooking.timeLabel}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-secondary)' }}>
                {formatDateDisplay(session.date)} ({session.timezone}) • {duration} Minutes
              </div>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <div className="label-sm" style={{ color: 'var(--color-secondary)', marginBottom: '6px' }}>
                Candidate Information
              </div>
              <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--color-primary)' }}>
                {participantProfile.name}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-secondary)' }}>
                {participantProfile.contact}
              </div>
            </div>

            {bookingConflictError && (
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-error-container)',
                  color: 'var(--color-on-error-container)',
                  fontSize: '13px',
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  error
                </span>
                <span>{bookingConflictError}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedSlotForBooking(null)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmBooking}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Booking...' : 'Confirm & Reserve Slot'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warning Modal when attempting to book a second slot */}
      {alreadyBookedWarning && (
        <div className="modal-overlay" onClick={() => setAlreadyBookedWarning(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--color-secondary-container)',
                  color: 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <span className="material-symbols-outlined">info</span>
              </div>
              <div>
                <h3 className="headline-md" style={{ color: 'var(--color-primary)' }}>
                  1 Slot Limit Per Candidate
                </h3>
              </div>
            </div>

            <p className="body-md" style={{ color: 'var(--color-on-surface-variant)', marginBottom: '16px' }}>
              You already have a confirmed interview slot for <strong>{myBooking?.timeLabel}</strong>.
            </p>
            <p className="body-sm" style={{ color: 'var(--color-secondary)', marginBottom: '24px' }}>
              Each candidate may only reserve one time slot per interview session. If you would like to switch to <strong>{alreadyBookedWarning.timeLabel}</strong>, please cancel your existing slot first.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setAlreadyBookedWarning(null)}
              >
                Got It
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  setAlreadyBookedWarning(null);
                  setSlotToCancel(myBooking);
                }}
              >
                Cancel My Existing Slot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Self-Cancellation */}
      <ConfirmModal
        isOpen={Boolean(slotToCancel)}
        title="Cancel Your Interview Booking?"
        message={`Are you sure you want to cancel your ${slotToCancel?.timeLabel} interview slot? The slot will immediately become available for other participants.`}
        confirmText="Yes, Cancel Booking"
        cancelText="Keep My Booking"
        isDanger={true}
        onConfirm={handleConfirmCancelMyBooking}
        onCancel={() => setSlotToCancel(null)}
      />
    </div>
  );
}
