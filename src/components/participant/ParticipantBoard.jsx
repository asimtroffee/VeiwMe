import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getSessionDetails, bookSlot, cancelBooking, updateParticipantProfile, subscribeToSync } from '../../services/storage';
import { formatDateDisplay } from '../../services/timeUtils';
import ConfirmModal from '../common/ConfirmModal';

export default function ParticipantBoard({ session: initialSession, participantProfile, onUpdateProfile, onShowToast }) {
  const [session, setSession] = useState(initialSession);
  const [filterPeriod, setFilterPeriod] = useState('all'); // all | morning | afternoon | evening | open
  const [layoutMode, setLayoutMode] = useState('stream'); // 'stream' (vertical timeline scroll) | 'grid'
  const [selectedSlotForBooking, setSelectedSlotForBooking] = useState(null);
  const [bookingConflictError, setBookingConflictError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slotToCancel, setSlotToCancel] = useState(null);
  const [alreadyBookedWarning, setAlreadyBookedWarning] = useState(null);

  const scrollContainerRef = useRef(null);

  // Edit Info Modal State
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editName, setEditName] = useState(participantProfile?.name || '');
  const [editCategory, setEditCategory] = useState(participantProfile?.category || 'A');
  const [editEmail, setEditEmail] = useState(participantProfile?.email || '');
  const [editPhone, setEditPhone] = useState(participantProfile?.phone || '');
  const [editError, setEditError] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const editCount = Number(participantProfile?.editCount) || 0;
  const editsRemaining = Math.max(0, 2 - editCount);
  const canEdit = editCount < 2;

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
    const pEmail = (participantProfile.email || '').toLowerCase();
    const pContact = (participantProfile.contact || '').toLowerCase();
    const pName = (participantProfile.name || '').toLowerCase();

    return session.slots.find((slot) => {
      if (!slot.isBooked || !slot.booking) return false;
      const bEmail = (slot.booking.candidateEmail || '').toLowerCase();
      const bContact = (slot.booking.candidateContact || '').toLowerCase();
      const bName = (slot.booking.candidateName || '').toLowerCase();

      return (
        (pEmail && bEmail && pEmail === bEmail) ||
        (pContact && bContact && pContact === bContact) ||
        (pName && bName && pName === bName)
      );
    });
  }, [session, participantProfile]);

  const filteredSlots = useMemo(() => {
    if (!session || !session.slots) return [];
    return session.slots.filter((slot) => {
      if (filterPeriod === 'open') return !slot.isBooked && !slot.isBlocked;
      if (filterPeriod === 'morning') return slot.period === 'morning';
      if (filterPeriod === 'afternoon') return slot.period === 'afternoon';
      if (filterPeriod === 'evening') return slot.period === 'evening';
      return true;
    });
  }, [session, filterPeriod]);

  // Grouped periods for smooth scroll and timeline sections
  const morningSlots = useMemo(() => {
    return (filteredSlots || []).filter((s) => s.period === 'morning');
  }, [filteredSlots]);

  const afternoonSlots = useMemo(() => {
    return (filteredSlots || []).filter((s) => s.period === 'afternoon');
  }, [filteredSlots]);

  const eveningSlots = useMemo(() => {
    return (filteredSlots || []).filter((s) => s.period === 'evening');
  }, [filteredSlots]);

  const handleScrollStream = (direction) => {
    if (scrollContainerRef.current) {
      const offset = direction === 'up' ? -260 : 260;
      scrollContainerRef.current.scrollBy({ top: offset, behavior: 'smooth' });
    }
  };

  const scrollToPeriodSection = (periodKey) => {
    if (filterPeriod !== 'all' && filterPeriod !== 'open') {
      setFilterPeriod('all');
    }
    setTimeout(() => {
      const target = document.getElementById(`timeline-period-${periodKey}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 40);
  };

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
      candidateCategory: participantProfile.category || 'A',
      candidateEmail: participantProfile.email || '',
      candidatePhone: participantProfile.phone || '',
      candidateContact: participantProfile.contact || (participantProfile.email && participantProfile.phone ? `${participantProfile.email} • ${participantProfile.phone}` : participantProfile.email || participantProfile.phone || participantProfile.name)
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

  // Validation helpers
  const isValidEmail = (str) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
  const isValidPhone = (str) => /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/.test(str.replace(/\s+/g, '')) || str.replace(/\D/g, '').length >= 10;

  const handleOpenEditInfo = () => {
    if (!canEdit) {
      onShowToast('You have reached the maximum limit of 2 edits.', 'error');
      return;
    }
    setEditName(participantProfile?.name || '');
    setEditCategory(participantProfile?.category || 'A');
    setEditEmail(participantProfile?.email || '');
    setEditPhone(participantProfile?.phone || '');
    setEditError('');
    setIsEditingInfo(true);
  };

  const handleSaveEditInfo = (e) => {
    e.preventDefault();
    setEditError('');

    if (!canEdit) {
      setEditError('You cannot edit your information more than two times.');
      return;
    }

    const trimmedName = editName.trim();
    const trimmedCategory = editCategory;
    const trimmedEmail = editEmail.trim();
    const trimmedPhone = editPhone.trim();

    if (!trimmedName || trimmedName.length < 2) {
      setEditError('Please enter your full name.');
      return;
    }

    if (!trimmedCategory) {
      setEditError('Please select a Category (A, B, or C).');
      return;
    }

    if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
      setEditError('Please enter a valid email address (e.g. name@example.com).');
      return;
    }

    if (!trimmedPhone || !isValidPhone(trimmedPhone)) {
      setEditError('Please enter a valid phone number (e.g. +1 555-019-2834).');
      return;
    }

    setIsSavingEdit(true);

    try {
      const updated = updateParticipantProfile(session.id, participantProfile, {
        name: trimmedName,
        category: trimmedCategory,
        email: trimmedEmail,
        phone: trimmedPhone,
        contact: `${trimmedEmail} • ${trimmedPhone}`
      });

      if (onUpdateProfile) {
        onUpdateProfile(updated);
      }

      onShowToast(`Your information was updated successfully! (${updated.editCount}/2 edits used)`);
      setIsSavingEdit(false);
      setIsEditingInfo(false);
      loadData();
    } catch (err) {
      setIsSavingEdit(false);
      setEditError(err.message || 'Failed to update information. Please try again.');
    }
  };

  const renderStreamSlotRow = (slot) => {
    const isMine =
      slot.isBooked &&
      (
        (participantProfile.email && slot.booking.candidateEmail && slot.booking.candidateEmail.toLowerCase() === participantProfile.email.toLowerCase()) ||
        slot.booking.candidateContact.toLowerCase() === (participantProfile.contact || '').toLowerCase() ||
        slot.booking.candidateName.toLowerCase() === participantProfile.name.toLowerCase()
      );

    if (slot.isBooked) {
      return (
        <div
          key={slot.id}
          className={`timeline-slot-row booked ${isMine ? 'my-booking' : ''}`}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div className={`timeline-slot-dot ${isMine ? 'mine' : 'booked'}`} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="font-headline" style={{ fontWeight: '800', fontSize: '15px', color: 'var(--color-primary)' }}>
                  {slot.timeLabel}
                </span>
                <span className={`chip ${isMine ? 'chip-success' : 'chip-neutral'}`} style={{ fontSize: '11px', padding: '2px 8px' }}>
                  {isMine ? 'Your Slot' : 'Booked'}
                </span>
                {isMine && (
                  <span className="chip chip-accent" style={{ fontSize: '10px', padding: '1px 6px' }}>
                    Cat {participantProfile.category || slot.booking?.candidateCategory || 'A'}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-secondary)', marginTop: '4px' }}>
                {isMine
                  ? `Reserved for you (${participantProfile.name}) • ${duration} min`
                  : `Unavailable • Reserved by another candidate`}
              </div>
            </div>
          </div>

          <div>
            {isMine ? (
              <button
                className="btn btn-sm btn-danger"
                onClick={() => setSlotToCancel(slot)}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>cancel</span>
                <span>Cancel Slot</span>
              </button>
            ) : (
              <span className="chip chip-neutral" style={{ fontSize: '12px', opacity: 0.75 }}>
                Booked
              </span>
            )}
          </div>
        </div>
      );
    }

    if (slot.isBlocked) {
      return (
        <div key={slot.id} className="timeline-slot-row blocked">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div className="timeline-slot-dot blocked" />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="font-headline" style={{ fontWeight: '700', fontSize: '15px', color: 'var(--color-secondary)' }}>
                  {slot.timeLabel}
                </span>
                <span
                  className="chip"
                  style={{
                    backgroundColor: 'var(--color-error-container)',
                    color: 'var(--color-on-error-container)',
                    fontSize: '11px',
                    padding: '2px 8px'
                  }}
                >
                  Unavailable
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-secondary)', marginTop: '4px' }}>
                Marked unavailable by administrator
              </div>
            </div>
          </div>

          <span className="chip chip-neutral" style={{ fontSize: '12px', opacity: 0.6 }}>
            Locked
          </span>
        </div>
      );
    }

    // Available Slot
    return (
      <div
        key={slot.id}
        className="timeline-slot-row available"
        onClick={() => handleOpenBookingModal(slot)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div className="timeline-slot-dot open" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="font-headline" style={{ fontWeight: '800', fontSize: '16px', color: 'var(--color-primary)' }}>
                {slot.timeLabel}
              </span>
              <span className="chip chip-success" style={{ fontSize: '11px', padding: '2px 8px' }}>
                Available
              </span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-secondary)', marginTop: '4px' }}>
              {duration} min video interview • Instant reserve
            </div>
          </div>
        </div>

        <button className="btn btn-sm btn-primary slot-book-action-btn" type="button">
          <span>Book Slot</span>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_forward</span>
        </button>
      </div>
    );
  };

  const renderGridSlotCard = (slot) => {
    const isMine =
      slot.isBooked &&
      (
        (participantProfile.email && slot.booking.candidateEmail && slot.booking.candidateEmail.toLowerCase() === participantProfile.email.toLowerCase()) ||
        slot.booking.candidateContact.toLowerCase() === (participantProfile.contact || '').toLowerCase() ||
        slot.booking.candidateName.toLowerCase() === participantProfile.name.toLowerCase()
      );

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
              {isMine ? (
                <>
                  <div style={{ fontWeight: '600', color: 'var(--color-primary)', fontSize: '13px' }}>
                    Reserved for you ({participantProfile.name})
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-secondary)', marginTop: '2px' }}>
                    Category {participantProfile.category || slot.booking?.candidateCategory || 'A'} • {duration} min interview
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--color-secondary)', marginTop: '4px' }}>
                  Reserved by another participant
                </div>
              )}
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

    if (slot.isBlocked) {
      return (
        <div
          key={slot.id}
          className="slot-card"
          style={{
            backgroundColor: 'var(--color-surface-container)',
            borderColor: 'var(--color-outline-variant)',
            opacity: 0.75,
            cursor: 'not-allowed'
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span className="label-md" style={{ color: 'var(--color-secondary)', fontWeight: '700' }}>
                {slot.timeLabel}
              </span>
              <span className="chip chip-neutral" style={{ fontSize: '11px' }}>
                Unavailable
              </span>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--color-secondary)', marginTop: '8px' }}>
              This time slot is unavailable
            </div>
          </div>
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
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px'
          }}
        >
          {/* Logo & Session Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
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

          {/* Participant Profile & Edit Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
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
                <strong>{participantProfile.name}</strong>
              </span>
              <span className="chip chip-accent" style={{ fontSize: '10px', padding: '1px 6px', marginLeft: '2px' }}>
                Cat {participantProfile.category || 'A'}
              </span>
            </div>

            {canEdit ? (
              <button
                onClick={handleOpenEditInfo}
                className="btn btn-secondary btn-sm"
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title={`Edit your info (${editsRemaining} edit${editsRemaining === 1 ? '' : 's'} remaining)`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                  edit
                </span>
                <span>Edit Info</span>
                <span
                  style={{
                    backgroundColor: 'var(--color-surface-container)',
                    borderRadius: 'var(--radius-full)',
                    padding: '1px 6px',
                    fontSize: '10px',
                    fontWeight: '700'
                  }}
                >
                  {editsRemaining} left
                </span>
              </button>
            ) : (
              <div
                className="chip chip-neutral"
                style={{
                  fontSize: '12px',
                  padding: '6px 10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  opacity: 0.8
                }}
                title="You have reached the maximum 2 edits limit for this session."
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                  lock
                </span>
                <span>Edits Locked (2/2)</span>
              </div>
            )}
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
                <div className="label-sm" style={{ color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>YOUR INTERVIEW IS CONFIRMED (1 SLOT PER PERSON)</span>
                  <span className="chip chip-accent" style={{ fontSize: '10px', padding: '1px 6px' }}>
                    Category {myBooking.booking.candidateCategory || participantProfile.category || 'A'}
                  </span>
                </div>
                <h2 className="headline-md" style={{ color: 'var(--color-primary)', marginTop: '2px' }}>
                  {myBooking.timeLabel} • {formatDateDisplay(session.date)}
                </h2>
                <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
                  Candidate: <strong>{myBooking.booking.candidateName}</strong> ({myBooking.booking.candidateEmail || myBooking.booking.candidateContact} {myBooking.booking.candidatePhone ? `• ${myBooking.booking.candidatePhone}` : ''})
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

          {/* Center Content: Interactive Time Stream & Slot Selection */}
          <section style={{ flex: 1, minWidth: '300px' }}>
            {/* Header & Filter Controls */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '16px',
                marginBottom: '16px'
              }}
            >
              <div>
                <h2 className="headline-lg" style={{ color: 'var(--color-primary)' }}>
                  Select an Interview Time
                </h2>
                <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
                  {myBooking
                    ? 'You have already booked a slot. Cancel your slot above if you wish to change times.'
                    : `Scroll through the schedule and pick your preferred ${duration}-minute slot.`}
                </p>
              </div>

              {/* View Switcher: Interactive Stream vs Grid */}
              <div className="view-switcher-pill">
                <button
                  className={`view-switcher-btn ${layoutMode === 'stream' ? 'active' : ''}`}
                  onClick={() => setLayoutMode('stream')}
                  title="Interactive timeline scroll stream"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>view_stream</span>
                  <span>Timeline Stream</span>
                </button>
                <button
                  className={`view-switcher-btn ${layoutMode === 'grid' ? 'active' : ''}`}
                  onClick={() => setLayoutMode('grid')}
                  title="Compact card grid"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>grid_view</span>
                  <span>Grid</span>
                </button>
              </div>
            </div>

            {/* Time Stream Layout with Scroll Controls */}
            {layoutMode === 'stream' ? (
              <div className="time-stream-wrapper">
                {/* Time Stream Toolbar with Period Jump & Scroll Up/Down */}
                <div className="time-stream-toolbar">
                  {/* Left: Quick Period Jump Pills */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      className={`btn btn-sm ${filterPeriod === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setFilterPeriod('all')}
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      All ({filteredSlots.length})
                    </button>
                    <button
                      className={`btn btn-sm ${filterPeriod === 'open' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setFilterPeriod('open')}
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      Open Only
                    </button>
                    {morningSlots.length > 0 && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => scrollToPeriodSection('morning')}
                        style={{ fontSize: '12px', padding: '6px 10px', color: 'var(--color-secondary)' }}
                      >
                        🌅 Morning ({morningSlots.length})
                      </button>
                    )}
                    {afternoonSlots.length > 0 && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => scrollToPeriodSection('afternoon')}
                        style={{ fontSize: '12px', padding: '6px 10px', color: 'var(--color-secondary)' }}
                      >
                        ☀️ Afternoon ({afternoonSlots.length})
                      </button>
                    )}
                    {eveningSlots.length > 0 && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => scrollToPeriodSection('evening')}
                        style={{ fontSize: '12px', padding: '6px 10px', color: 'var(--color-secondary)' }}
                      >
                        🌙 Evening ({eveningSlots.length})
                      </button>
                    )}
                  </div>

                  {/* Right: Scroll Up / Scroll Down Controls */}
                  <div className="scroll-nav-group">
                    <span style={{ fontSize: '12px', color: 'var(--color-secondary)', marginRight: '4px' }}>
                      Scroll:
                    </span>
                    <button
                      className="scroll-btn"
                      onClick={() => handleScrollStream('up')}
                      title="Scroll up"
                      aria-label="Scroll Up"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>keyboard_arrow_up</span>
                    </button>
                    <button
                      className="scroll-btn"
                      onClick={() => handleScrollStream('down')}
                      title="Scroll down"
                      aria-label="Scroll Down"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>keyboard_arrow_down</span>
                    </button>
                  </div>
                </div>

                {/* Scrollable Viewport */}
                <div className="time-stream-scroll-viewport" ref={scrollContainerRef}>
                  {/* Morning Section */}
                  {morningSlots.length > 0 && (
                    <div id="timeline-period-morning" className="time-period-section">
                      <div className="time-period-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '16px' }}>🌅</span>
                          <span style={{ fontWeight: '700', fontSize: '13px', color: 'var(--color-primary)' }}>
                            Morning Slots (09:00 AM – 12:00 PM)
                          </span>
                        </div>
                        <span className="chip chip-neutral" style={{ fontSize: '11px', padding: '1px 6px' }}>
                          {morningSlots.filter((s) => !s.isBooked && !s.isBlocked).length} Open
                        </span>
                      </div>
                      <div className="timeline-track">
                        {morningSlots.map(renderStreamSlotRow)}
                      </div>
                    </div>
                  )}

                  {/* Afternoon Section */}
                  {afternoonSlots.length > 0 && (
                    <div id="timeline-period-afternoon" className="time-period-section">
                      <div className="time-period-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '16px' }}>☀️</span>
                          <span style={{ fontWeight: '700', fontSize: '13px', color: 'var(--color-primary)' }}>
                            Afternoon Slots (12:00 PM – 05:00 PM)
                          </span>
                        </div>
                        <span className="chip chip-neutral" style={{ fontSize: '11px', padding: '1px 6px' }}>
                          {afternoonSlots.filter((s) => !s.isBooked && !s.isBlocked).length} Open
                        </span>
                      </div>
                      <div className="timeline-track">
                        {afternoonSlots.map(renderStreamSlotRow)}
                      </div>
                    </div>
                  )}

                  {/* Evening Section */}
                  {eveningSlots.length > 0 && (
                    <div id="timeline-period-evening" className="time-period-section">
                      <div className="time-period-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '16px' }}>🌙</span>
                          <span style={{ fontWeight: '700', fontSize: '13px', color: 'var(--color-primary)' }}>
                            Evening Slots (05:00 PM+)
                          </span>
                        </div>
                        <span className="chip chip-neutral" style={{ fontSize: '11px', padding: '1px 6px' }}>
                          {eveningSlots.filter((s) => !s.isBooked && !s.isBlocked).length} Open
                        </span>
                      </div>
                      <div className="timeline-track">
                        {eveningSlots.map(renderStreamSlotRow)}
                      </div>
                    </div>
                  )}

                  {filteredSlots.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--color-secondary)' }}>
                      No interview slots available for this period filter.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Grid Layout Mode */
              <div>
                {/* Filter Tabs for Grid */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {[
                    { key: 'all', label: `All Slots (${session.totalSlots})` },
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

                <div className="slots-grid">
                  {filteredSlots.map(renderGridSlotCard)}
                </div>

                {filteredSlots.length === 0 && (
                  <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--color-secondary)' }}>
                    No time slots match the selected period.
                  </div>
                )}
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
              <div className="label-sm" style={{ color: 'var(--color-secondary)', marginBottom: '8px' }}>
                Candidate Information
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--color-primary)' }}>
                  {participantProfile.name}
                </span>
                <span className="chip chip-accent" style={{ fontSize: '11px', padding: '1px 8px' }}>
                  Category {participantProfile.category || 'A'}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-secondary)' }}>
                {participantProfile.email && <div>Email: {participantProfile.email}</div>}
                {participantProfile.phone && <div>Phone: {participantProfile.phone}</div>}
                {!participantProfile.email && !participantProfile.phone && <div>{participantProfile.contact}</div>}
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

      {/* Edit Info Modal */}
      {isEditingInfo && (
        <div className="modal-overlay" onClick={() => !isSavingEdit && setIsEditingInfo(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: 'var(--color-secondary-container)',
                    color: 'var(--color-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    edit
                  </span>
                </div>
                <h3 className="headline-md" style={{ color: 'var(--color-primary)' }}>
                  Edit Your Information
                </h3>
              </div>
              <button
                onClick={() => !isSavingEdit && setIsEditingInfo(false)}
                style={{ color: 'var(--color-secondary)' }}
                disabled={isSavingEdit}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Edit Count Notice */}
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-surface-container)',
                fontSize: '12px',
                color: 'var(--color-on-surface-variant)',
                marginBottom: '18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>
                  info
                </span>
                <span>
                  <strong>Edit Attempt:</strong> {editCount + 1} of 2
                </span>
              </div>
              <span className="chip chip-accent" style={{ fontSize: '11px', padding: '2px 8px' }}>
                {editsRemaining} edit{editsRemaining === 1 ? '' : 's'} remaining
              </span>
            </div>

            <form onSubmit={handleSaveEditInfo}>
              <div style={{ marginBottom: '16px' }}>
                <label className="input-label" htmlFor="edit-cand-name">
                  Full Name *
                </label>
                <input
                  id="edit-cand-name"
                  type="text"
                  className="input-field"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  autoFocus
                  disabled={isSavingEdit}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label className="input-label" htmlFor="edit-cand-category">
                  Category *
                </label>
                <select
                  id="edit-cand-category"
                  className="input-field"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  required
                  disabled={isSavingEdit}
                  style={{ backgroundColor: 'var(--color-surface)' }}
                >
                  <option value="A">Category A</option>
                  <option value="B">Category B</option>
                  <option value="C">Category C</option>
                </select>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label className="input-label" htmlFor="edit-cand-email">
                  Email Address *
                </label>
                <input
                  id="edit-cand-email"
                  type="email"
                  className="input-field"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                  disabled={isSavingEdit}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label className="input-label" htmlFor="edit-cand-phone">
                  Phone Number *
                </label>
                <input
                  id="edit-cand-phone"
                  type="tel"
                  className="input-field"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  required
                  disabled={isSavingEdit}
                />
                <span style={{ fontSize: '11px', color: 'var(--color-secondary)', display: 'block', marginTop: '4px' }}>
                  Updating your contact info will automatically update your attendance and active booking.
                </span>
              </div>

              {editError && (
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
                  <span>{editError}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsEditingInfo(false)}
                  disabled={isSavingEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSavingEdit}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                    check
                  </span>
                  <span>{isSavingEdit ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

