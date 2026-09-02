import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  getSessionDetails,
  normalizeSessionDays,
  bookSlot,
  rescheduleBooking,
  cancelBooking,
  checkSlotChangeEligibility,
  updateParticipantProfile,
  isTesterAccount,
  resetTesterSessionState,
  resetTesterSlotChangeLimit,
  clearParticipantProfile,
  subscribeToSessionSync
} from '../../services/storage';
import {
  formatDateDisplay,
  formatEventDateRange,
  formatTimeUntilMeeting,
  getHoursUntilSlot,
  isSlotWithinCutoff,
  generateGoogleCalendarUrl,
  openGoogleCalendarDirectly,
  downloadIcsFile,
  formatCategoryName,
  matchCategory
} from '../../services/timeUtils';
import ConfirmModal from '../common/ConfirmModal';

export default function ParticipantBoard({ session: initialSession, participantProfile, onUpdateProfile, onResetProfile, onShowToast }) {
  const [session, setSession] = useState(initialSession);
  const [filterPeriod, setFilterPeriod] = useState('all'); // all | morning | afternoon | evening | open
  const [layoutMode, setLayoutMode] = useState('stream'); // 'stream' (vertical timeline scroll) | 'grid'
  const [selectedSlotForBooking, setSelectedSlotForBooking] = useState(null);
  const [bookingConflictError, setBookingConflictError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slotToCancel, setSlotToCancel] = useState(null);
  const [slotToSwitch, setSlotToSwitch] = useState(null);
  const [switchStep, setSwitchStep] = useState(1); // 1 = Review, 2 = Final Warning & Verification
  const [hasAcceptedFinalWarning, setHasAcceptedFinalWarning] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const [ineligibilityModal, setIneligibilityModal] = useState(null);
  const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState(false);
  const [isTesterHudOpen, setIsTesterHudOpen] = useState(true);

  const isTester = isTesterAccount(participantProfile);

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
  const currentCategory = participantProfile?.category || session?.categories?.[0] || 'Category A';

  // Multi-day state management
  const sessionDays = useMemo(() => {
    return normalizeSessionDays(session);
  }, [session]);
  const isMultiDay = sessionDays.length > 1;

  const [selectedDayId, setSelectedDayId] = useState(
    () => sessionDays[0]?.id || 'day_1'
  );

  useEffect(() => {
    if (sessionDays.length > 0) {
      if (!sessionDays.some((d) => d.id === selectedDayId)) {
        setSelectedDayId(sessionDays[0].id);
      }
    }
  }, [sessionDays, selectedDayId]);

  const selectedDay = useMemo(() => {
    return sessionDays.find((d) => d.id === selectedDayId) || sessionDays[0] || { id: 'day_1', label: 'Day 1', date: session?.date };
  }, [sessionDays, selectedDayId, session?.date]);

  const loadData = () => {
    const fresh = getSessionDetails(session.id, participantProfile?.category);
    if (fresh) {
      setSession(fresh);
    }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = subscribeToSessionSync(session.id, () => {
      loadData();
    });
    return () => unsubscribe();
  }, [session.id, participantProfile?.category]);

  // Check if current participant already has an active booking in this session
  const myBooking = useMemo(() => {
    const candidateSlots = session?.allSlots || session?.slots;
    if (!session || !candidateSlots || !participantProfile) return null;
    const pEmail = (participantProfile.email || '').toLowerCase().trim();
    const pPhone = (participantProfile.phone || '').replace(/\D/g, '');
    const pContact = (participantProfile.contact || '').toLowerCase().trim();
    const pName = (participantProfile.name || '').toLowerCase().trim();

    return candidateSlots.find((slot) => {
      if (!slot.isBooked || !slot.booking) return false;
      const bEmail = (slot.booking.candidateEmail || '').toLowerCase().trim();
      const bPhone = (slot.booking.candidatePhone || '').replace(/\D/g, '');
      const bContact = (slot.booking.candidateContact || '').toLowerCase().trim();
      const bName = (slot.booking.candidateName || '').toLowerCase().trim();

      const isSameEmail = pEmail && bEmail && pEmail === bEmail;
      const isSamePhone = pPhone && pPhone.length >= 10 && bPhone && bPhone.length >= 10 && pPhone === bPhone;
      const isSameContact = pContact && bContact && pContact === bContact;
      const isSameName = pName && bName && pName === bName;

      return isSameEmail || isSamePhone || isSameContact || (isSameName && (pEmail || pPhone));
    });
  }, [session, participantProfile]);

  // Sync selected day to active booking day on initial discovery
  useEffect(() => {
    if (myBooking?.dayId) {
      setSelectedDayId(myBooking.dayId);
    }
  }, [myBooking?.dayId]);

  // Slot Change Eligibility evaluation for active booking
  const slotChangeEligibility = useMemo(() => {
    if (!myBooking || !session) return null;
    return checkSlotChangeEligibility(session.id, myBooking.id, participantProfile);
  }, [myBooking, session, participantProfile]);

  // Day-scoped slots
  const dayFilteredSlots = useMemo(() => {
    if (!session) return [];
    const baseSlots = session.slots || [];
    if (!isMultiDay) return baseSlots;
    return baseSlots.filter((slot) => !slot.dayId || slot.dayId === selectedDay.id);
  }, [session, isMultiDay, selectedDay.id]);

  const filteredSlots = useMemo(() => {
    return dayFilteredSlots.filter((slot) => {
      if (filterPeriod === 'open') return !slot.isBooked && !slot.isBlocked;
      if (filterPeriod === 'morning') return slot.period === 'morning';
      if (filterPeriod === 'afternoon') return slot.period === 'afternoon';
      if (filterPeriod === 'evening') return slot.period === 'evening';
      return true;
    });
  }, [dayFilteredSlots, filterPeriod]);

  // Grouped periods for smooth stream timeline
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
    if (slot.isBooked || slot.isBlocked) return;

    if (myBooking) {
      if (myBooking.id === slot.id) return;

      const eligibility = checkSlotChangeEligibility(session.id, myBooking.id, participantProfile);
      if (!eligibility.canChange) {
        setIneligibilityModal({
          title: eligibility.reason === 'within_cutoff' || eligibility.reason === 'meeting_started'
            ? 'Slot Change Window Closed'
            : 'Slot Change Limit Reached',
          message: eligibility.message
        });
        return;
      }

      setSwitchError('');
      setSwitchStep(1);
      setHasAcceptedFinalWarning(false);
      setSlotToSwitch(slot);
      return;
    }

    setBookingConflictError('');
    setSelectedSlotForBooking(slot);
  };

  const handleConfirmBooking = async () => {
    if (!selectedSlotForBooking || isSubmitting) return;

    setIsSubmitting(true);
    setBookingConflictError('');

    const res = await bookSlot(session.id, selectedSlotForBooking.id, {
      candidateName: participantProfile.name,
      candidateCategory: participantProfile.category || 'Category A',
      candidateEmail: participantProfile.email || '',
      candidatePhone: participantProfile.phone || '',
      candidateContact: participantProfile.contact || (participantProfile.email && participantProfile.phone ? `${participantProfile.email} • ${participantProfile.phone}` : participantProfile.email || participantProfile.phone || participantProfile.name)
    });

    setIsSubmitting(false);

    if (res.success) {
      onShowToast(`Slot reserved for ${selectedSlotForBooking.timeLabel}! Opening Google Calendar...`);
      openGoogleCalendarDirectly({
        session,
        slot: selectedSlotForBooking,
        candidateProfile: participantProfile,
        booking: res.booking
      });
      setSelectedSlotForBooking(null);
      loadData();
    } else {
      setBookingConflictError(res.error || 'This slot is no longer available.');
      loadData();
    }
  };

  const handleConfirmSlotSwitch = async () => {
    if (!slotToSwitch || !myBooking || isSubmitting) return;

    setIsSubmitting(true);
    setSwitchError('');

    const res = await rescheduleBooking(session.id, myBooking.id, slotToSwitch.id, participantProfile);
    setIsSubmitting(false);

    if (res.success) {
      if (onUpdateProfile && res.updatedProfile) {
        onUpdateProfile(res.updatedProfile);
      }
      onShowToast(`Booking time changed to ${slotToSwitch.timeLabel}! Opening Google Calendar...`);
      openGoogleCalendarDirectly({
        session,
        slot: slotToSwitch,
        candidateProfile: participantProfile,
        booking: res.booking
      });
      setSlotToSwitch(null);
      loadData();
    } else {
      setSwitchError(res.error || 'Failed to switch time slot.');
      loadData();
    }
  };

  const handleConfirmCancelMyBooking = async () => {
    if (!slotToCancel) return;
    const targetSlotId = myBooking?.id || slotToCancel.booking?.slotId || slotToCancel.id;
    const res = await cancelBooking(session.id, targetSlotId, participantProfile, true);
    if (res.success) {
      onShowToast('Your slot booking has been cancelled.');
      loadData();
    } else {
      onShowToast(res.error || 'Could not cancel booking.', 'error');
    }
    setSlotToCancel(null);
  };

  const handleResetMyTestBooking = async () => {
    const res = await resetTesterSessionState(session.id, participantProfile.email || participantProfile.contact);
    if (res.success) {
      onShowToast('🧪 Test booking wiped! You can book any slot again from scratch.');
      loadData();
    }
  };

  const handleResetChangeLimit = () => {
    const res = resetTesterSlotChangeLimit(session.id, participantProfile.email || participantProfile.contact);
    if (res.success) {
      onShowToast('🧪 Slot change limit reset to 0/1.');
      loadData();
    }
  };

  const handleQuickSwitchCategory = (newCat) => {
    const updated = {
      ...participantProfile,
      category: newCat
    };
    if (onUpdateProfile) {
      onUpdateProfile(updated);
    }
    onShowToast(`🧪 Switched to ${newCat} track!`);
    loadData();
  };

  const handleResetAccountAndGoToGate = async () => {
    await resetTesterSessionState(session.id, participantProfile.email || participantProfile.contact);
    clearParticipantProfile(session.id);
    if (onResetProfile) {
      onResetProfile();
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const handleExitTesterMode = () => {
    clearParticipantProfile(session.id);
    if (onResetProfile) {
      onResetProfile();
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  // Validation helpers
  const isValidEmail = (str) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
  const isValidPhone = (str) => /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/.test(str.replace(/\s+/g, '')) || str.replace(/\D/g, '').length >= 10;

  const handleOpenEditInfo = () => {
    setEditName(participantProfile.name || '');
    setEditCategory(participantProfile.category || 'Category A');
    setEditEmail(participantProfile.email || '');
    setEditPhone(participantProfile.phone || '');
    setEditError('');
    setIsEditingInfo(true);
  };

  const handleSaveEditInfo = async (e) => {
    e.preventDefault();
    setEditError('');

    if (editCount >= 2) {
      setEditError('You have already used your 2 information edits.');
      return;
    }

    const trimmedName = editName.trim();
    const trimmedCategory = editCategory.trim();
    const trimmedEmail = editEmail.trim();
    const trimmedPhone = editPhone.trim();

    if (!trimmedName || !trimmedEmail || !trimmedPhone) {
      setEditError('Please fill in all required fields.');
      return;
    }

    // Full-name validation (same rules as ParticipantGate)
    const nameWords = trimmedName.split(/\s+/).filter(w => w.length >= 2);
    const nameRegex = /^[A-Za-z\u00C0-\u024F'-]+$/;
    if (nameWords.length < 2) {
      setEditError('Please enter your full name (first and last name, each at least 2 characters).');
      return;
    }
    for (const word of nameWords) {
      if (!nameRegex.test(word)) {
        setEditError('Name can only contain letters, hyphens, and apostrophes.');
        return;
      }
    }

    if (!isValidEmail(trimmedEmail)) {
      setEditError('Please enter a valid email address.');
      return;
    }

    // Strict phone validation (must have 10+ digits)
    const phoneDigits = trimmedPhone.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      setEditError('Please enter a valid phone number with at least 10 digits.');
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
    const pEmail = (participantProfile.email || '').toLowerCase().trim();
    const pPhone = (participantProfile.phone || '').replace(/\D/g, '');
    const pContact = (participantProfile.contact || '').toLowerCase().trim();
    const pName = (participantProfile.name || '').toLowerCase().trim();

    const bEmail = (slot.booking?.candidateEmail || '').toLowerCase().trim();
    const bPhone = (slot.booking?.candidatePhone || '').replace(/\D/g, '');
    const bContact = (slot.booking?.candidateContact || '').toLowerCase().trim();
    const bName = (slot.booking?.candidateName || '').toLowerCase().trim();

    const isMine =
      slot.isBooked &&
      (
        (pEmail && bEmail && pEmail === bEmail) ||
        (pPhone && pPhone.length >= 10 && bPhone && bPhone.length >= 10 && pPhone === bPhone) ||
        (pContact && bContact && pContact === bContact) ||
        (pName && bName && pName === bName && (pEmail || pPhone))
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span className="font-headline" style={{ fontWeight: '800', fontSize: '15px', color: 'var(--color-primary)' }}>
                  {slot.timeLabel}
                </span>
                {isMultiDay && (
                  <span className="chip" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline-variant)', color: 'var(--color-primary)', fontSize: '10px', padding: '1px 6px', fontWeight: '700' }}>
                    {slot.dayLabel || selectedDay.label}
                  </span>
                )}
                <span className={`chip ${isMine ? 'chip-success' : 'chip-neutral'}`} style={{ fontSize: '11px', padding: '2px 8px' }}>
                  {isMine ? 'Your Slot' : 'Booked'}
                </span>
                {isMine && (
                  <span className="chip chip-accent" style={{ fontSize: '10px', padding: '1px 6px' }}>
                    {formatCategoryName(participantProfile.category || slot.booking?.candidateCategory || 'Category A')}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span className="font-headline" style={{ fontWeight: '700', fontSize: '15px', color: 'var(--color-secondary)' }}>
                  {slot.timeLabel}
                </span>
                {isMultiDay && (
                  <span className="chip" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline-variant)', color: 'var(--color-secondary)', fontSize: '10px', padding: '1px 6px', fontWeight: '700' }}>
                    {slot.dayLabel || selectedDay.label}
                  </span>
                )}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span className="font-headline" style={{ fontWeight: '800', fontSize: '16px', color: 'var(--color-primary)' }}>
                {slot.timeLabel}
              </span>
              {isMultiDay && (
                <span className="chip" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline-variant)', color: 'var(--color-primary)', fontSize: '10px', padding: '1px 6px', fontWeight: '700' }}>
                  {slot.dayLabel || selectedDay.label}
                </span>
              )}
              <span className="chip chip-success" style={{ fontSize: '11px', padding: '2px 8px' }}>
                Available
              </span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-secondary)', marginTop: '4px' }}>
              {duration} min session • Instant reserve
            </div>
          </div>
        </div>

        <button className="btn btn-sm btn-primary slot-book-action-btn" type="button">
          <span>{myBooking ? 'Switch to this Slot' : 'Book Slot'}</span>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '4px' }}>
              <span className="label-md" style={{ color: 'var(--color-primary)', fontWeight: '700' }}>
                {slot.timeLabel}
              </span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {isMultiDay && (
                  <span className="chip chip-neutral" style={{ fontSize: '10px', padding: '1px 6px', fontWeight: '700' }}>
                    {slot.dayLabel || selectedDay.label}
                  </span>
                )}
                <span className={`chip ${isMine ? 'chip-success' : 'chip-neutral'}`}>
                  {isMine ? 'Your Slot' : 'Booked'}
                </span>
              </div>
            </div>

            <div style={{ marginTop: '8px' }}>
              {isMine ? (
                <>
                  <div style={{ fontWeight: '600', color: 'var(--color-primary)', fontSize: '13px' }}>
                    Reserved for you ({participantProfile.name})
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-secondary)', marginTop: '2px' }}>
                    Category {participantProfile.category || slot.booking?.candidateCategory || 'A'} • {duration} min slot
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '4px' }}>
              <span className="label-md" style={{ color: 'var(--color-secondary)', fontWeight: '700' }}>
                {slot.timeLabel}
              </span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {isMultiDay && (
                  <span className="chip chip-neutral" style={{ fontSize: '10px', padding: '1px 6px', fontWeight: '700' }}>
                    {slot.dayLabel || selectedDay.label}
                  </span>
                )}
                <span className="chip chip-neutral" style={{ fontSize: '11px' }}>
                  Unavailable
                </span>
              </div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '4px' }}>
            <span className="label-md" style={{ color: 'var(--color-primary)', fontWeight: '700' }}>
              {slot.timeLabel}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {isMultiDay && (
                <span className="chip chip-neutral" style={{ fontSize: '10px', padding: '1px 6px', fontWeight: '700' }}>
                  {slot.dayLabel || selectedDay.label}
                </span>
              )}
              <span className="chip chip-success">Available</span>
            </div>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--color-secondary)', marginTop: '4px' }}>
            {duration} mins • Video Call
          </div>
        </div>

        <div style={{ marginTop: '14px', textAlign: 'right' }}>
          <button className="btn btn-sm btn-primary" type="button">
            <span>{myBooking ? 'Switch' : 'Book Slot'}</span>
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
      {/* Top App Bar */}
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
            {isMultiDay && (
              <span className="chip" style={{ backgroundColor: 'var(--color-primary)', color: '#ffffff', fontSize: '11px', fontWeight: '700' }}>
                🗓️ {sessionDays.length} Days Event
              </span>
            )}
          </div>

          {/* Participant Profile & Edit Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {isTester && (
              <a
                href="#/admin"
                className="btn btn-secondary btn-sm"
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  borderColor: '#3b82f6',
                  color: '#1d4ed8',
                  backgroundColor: 'rgba(59, 130, 246, 0.08)'
                }}
                title="Return to Admin Dashboard"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#3b82f6' }}>arrow_back</span>
                <span>Back to Admin</span>
              </a>
            )}
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
          gap: '24px',
          flex: 1
        }}
      >
        {/* Active Booking Banner */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--color-success)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>
                  check
                </span>
              </div>
              <div>
                <div className="label-sm" style={{ color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span>YOUR BOOKING IS CONFIRMED</span>
                  <span className="chip chip-accent" style={{ fontSize: '10px', padding: '1px 6px' }}>
                    Category {myBooking.booking.candidateCategory || participantProfile.category || 'A'}
                  </span>
                  {slotChangeEligibility?.canChange ? (
                    <span className="chip chip-success" style={{ fontSize: '10px', padding: '1px 8px' }}>
                      1 Slot Change Available
                    </span>
                  ) : (
                    <span className="chip chip-neutral" style={{ fontSize: '10px', padding: '1px 8px', opacity: 0.85 }}>
                      {slotChangeEligibility?.reason === 'max_changes_reached' ? 'Slot Locked (1/1 Change Used)' : 'Slot Locked (< 3h to Meeting)'}
                    </span>
                  )}
                </div>
                <h2 className="headline-md" style={{ color: 'var(--color-primary)', marginTop: '2px' }}>
                  {myBooking.timeLabel} • {myBooking.dayLabel ? `${myBooking.dayLabel} (${formatDateDisplay(myBooking.slotDate || session.date)})` : formatDateDisplay(session.date)}
                </h2>
                <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
                  Candidate: <strong>{myBooking.booking.candidateName}</strong> ({myBooking.booking.candidateEmail || myBooking.booking.candidateContact} {myBooking.booking.candidatePhone ? `• ${myBooking.booking.candidatePhone}` : ''})
                </p>
                <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                  {slotChangeEligibility?.canChange
                    ? `ℹ️ You may change this booking once (including switching to another day). Changes must be made at least 3 hours before start time (${formatTimeUntilMeeting(myBooking.slotDate || session.date, myBooking)}).`
                    : `🔒 ${slotChangeEligibility?.message || 'Slot change is no longer available for this booking.'}`}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {session.meetingLink && (
                <a
                  href={session.meetingLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-sm"
                  style={{ backgroundColor: '#2D8CFF', borderColor: '#2D8CFF', color: '#ffffff', fontWeight: '700', boxShadow: '0 2px 6px rgba(45, 140, 255, 0.35)' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                    videocam
                  </span>
                  <span>Join Zoom Call</span>
                </a>
              )}

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => openGoogleCalendarDirectly({ session, slot: myBooking, candidateProfile: participantProfile, booking: myBooking.booking })}
                title="Open Google Calendar to add this event"
                style={{ backgroundColor: '#ffffff', borderColor: '#4285F4', color: '#1a73e8' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '17px', color: '#4285F4' }}>
                  calendar_add_on
                </span>
                <span>Google Calendar</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => downloadIcsFile({ session, slot: myBooking, candidateProfile: participantProfile, booking: myBooking.booking })}
                title="Download .ics calendar invite for Apple Calendar / Outlook"
                style={{ backgroundColor: '#ffffff' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>
                  download
                </span>
                <span>.ics Invite</span>
              </button>

              {slotChangeEligibility?.canChange ? (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setSlotToCancel(myBooking)}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>
                    cancel
                  </span>
                  <span>Cancel Slot</span>
                </button>
              ) : (
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ opacity: 0.85 }}
                  onClick={() => {
                    setIneligibilityModal({
                      title: slotChangeEligibility?.reason === 'within_cutoff' || slotChangeEligibility?.reason === 'meeting_started'
                        ? 'Slot Change Window Closed'
                        : 'Slot Change Limit Reached',
                      message: slotChangeEligibility?.message || 'You cannot change this booking.'
                    });
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>
                    lock
                  </span>
                  <span>Locked</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Layout: Left Sidebar + Center Grid */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '28px', alignItems: 'flex-start' }}>
          {/* Left Sidebar / Mobile Collapsible Info */}
          <aside className="session-info-sidebar" style={{ width: '100%', maxWidth: '280px', flexShrink: 0 }}>
            <div className="card" style={{ padding: '20px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  marginBottom: isMobileDetailsOpen ? '16px' : '0'
                }}
                onClick={() => setIsMobileDetailsOpen(!isMobileDetailsOpen)}
                className="mobile-details-header"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)' }}>
                    calendar_month
                  </span>
                  <h2 className="headline-md" style={{ color: 'var(--color-primary)', fontSize: '16px' }}>
                    Session Details
                  </h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="chip chip-accent" style={{ fontSize: '11px', padding: '2px 8px' }}>
                    {duration}m • {session.timezone}
                  </span>
                  <span className="material-symbols-outlined mobile-toggle-icon" style={{ fontSize: '20px', color: 'var(--color-secondary)' }}>
                    {isMobileDetailsOpen ? 'expand_less' : 'expand_more'}
                  </span>
                </div>
              </div>

              {/* Collapsible content (expanded on desktop, toggled on mobile) */}
              <div className={`session-details-content ${isMobileDetailsOpen ? 'open' : ''}`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '16px', marginTop: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', marginTop: '2px', fontSize: '20px' }}>
                      {isMultiDay ? 'date_range' : 'event'}
                    </span>
                    <div>
                      <div style={{ fontWeight: '700', fontSize: '14px', color: 'var(--color-primary)' }}>
                        {formatEventDateRange(session)}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--color-secondary)' }}>
                        {isMultiDay ? `${sessionDays.length} Days Schedule` : 'Date of Session'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', marginTop: '2px', fontSize: '20px' }}>
                      schedule
                    </span>
                    <div>
                      <div style={{ fontWeight: '700', fontSize: '14px', color: 'var(--color-primary)' }}>
                        {duration} Minutes
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--color-secondary)' }}>
                        {selectedDay.startTime} – {selectedDay.endTime} ({session.timezone})
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span className="material-symbols-outlined" style={{ color: '#2D8CFF', marginTop: '2px', fontSize: '20px' }}>
                      videocam
                    </span>
                    <div>
                      <div style={{ fontWeight: '700', fontSize: '14px', color: 'var(--color-primary)' }}>
                        Video Meeting
                      </div>
                      {session.meetingLink ? (
                        <div style={{ marginTop: '3px' }}>
                          <a
                            href={session.meetingLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: '#1a73e8',
                              fontSize: '12px',
                              textDecoration: 'underline',
                              fontWeight: '600',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <span>Open Zoom Link</span>
                            <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>open_in_new</span>
                          </a>
                        </div>
                      ) : (
                        <div style={{ fontSize: '12px', color: 'var(--color-secondary)' }}>Link sent upon booking</div>
                      )}
                    </div>
                  </div>
                </div>

                {session.description && (
                  <div
                    style={{
                      borderTop: '1px solid var(--color-outline-variant)',
                      paddingTop: '14px',
                      marginTop: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <span className="material-symbols-outlined fill" style={{ fontSize: '16px', color: '#d97706' }}>
                        tips_and_updates
                      </span>
                      <span className="label-sm" style={{ color: '#92400e', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.4px', fontSize: '11px' }}>
                        Candidate Instructions
                      </span>
                    </div>
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: '#fffbeb',
                        border: '1px solid #fef3c7',
                        color: '#78350f',
                        fontSize: '12px',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap'
                      }}
                    >
                      {session.description}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>

          {/* Center Content: Interactive Time Stream & Slot Selection */}
          <section style={{ flex: 1, minWidth: '300px' }}>
            {/* Multi-Day Selector Component */}
            {isMultiDay && (
              <div
                style={{
                  marginBottom: '20px',
                  backgroundColor: 'var(--color-surface)',
                  border: '1.5px solid var(--color-outline-variant)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '18px 20px',
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--color-primary)' }}>
                      calendar_month
                    </span>
                    <span style={{ fontWeight: '800', fontSize: '14px', color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      Step 1: Choose a Day ({sessionDays.length} Available Days)
                    </span>
                  </div>
                  <span className="chip chip-neutral" style={{ fontSize: '11px' }}>
                    Pick a day to view its available time slots
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(auto-fit, minmax(${sessionDays.length <= 3 ? '180px' : '150px'}, 1fr))`,
                    gap: '12px'
                  }}
                >
                  {sessionDays.map((d, index) => {
                    const isSelected = d.id === selectedDay.id;
                    const dayAllSlots = session.daySlots?.[d.id]?.[currentCategory] || session.slots?.filter((s) => s.dayId === d.id) || [];
                    const openCount = dayAllSlots.filter((s) => !s.isBooked && !s.isBlocked).length;
                    const isMyBookingDay = myBooking && (myBooking.dayId === d.id || myBooking.slotDate === d.date);

                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setSelectedDayId(d.id)}
                        style={{
                          padding: '14px 16px',
                          borderRadius: 'var(--radius-md)',
                          border: isSelected
                            ? '2px solid var(--color-primary)'
                            : isMyBookingDay
                            ? '2px solid var(--color-success)'
                            : '1px solid var(--color-outline-variant)',
                          backgroundColor: isSelected
                            ? 'var(--color-surface-container)'
                            : isMyBookingDay
                            ? '#f0fdf4'
                            : 'var(--color-surface)',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          position: 'relative',
                          boxShadow: isSelected ? '0 4px 14px rgba(99, 102, 241, 0.15)' : 'none',
                          transition: 'all var(--transition-fast)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: '800',
                              color: isSelected ? 'var(--color-primary)' : 'var(--color-secondary)',
                              textTransform: 'uppercase'
                            }}
                          >
                            {d.label || `Day ${index + 1}`}
                          </span>
                          {isMyBookingDay && (
                            <span className="chip chip-success" style={{ fontSize: '10px', padding: '1px 6px' }}>
                              ★ Your Day
                            </span>
                          )}
                        </div>

                        <div style={{ fontWeight: '700', fontSize: '14px', color: 'var(--color-primary)' }}>
                          {formatDateDisplay(d.date)}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--color-secondary)', marginTop: '2px' }}>
                          <span>{d.startTime} – {d.endTime}</span>
                          <span
                            style={{
                              fontWeight: '700',
                              color: openCount > 0 ? 'var(--color-success)' : 'var(--color-secondary)'
                            }}
                          >
                            {openCount > 0 ? `${openCount} open` : 'Fully booked'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <h2 className="headline-lg" style={{ color: 'var(--color-primary)' }}>
                    {isMultiDay ? `${selectedDay.label} Time Slots` : 'Select a Time Slot'}
                  </h2>
                  <span className="chip chip-accent" style={{ fontSize: '11px', fontWeight: '700' }}>
                    {participantProfile.category?.startsWith('Category') ? participantProfile.category : `Category ${participantProfile.category || 'A'}`} Track
                  </span>
                </div>
                <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
                  {myBooking
                    ? `You currently have a reserved slot. Click any available time slot below to reschedule.`
                    : `Showing open ${selectedDay.startTime} – ${selectedDay.endTime} slots for ${selectedDay.label || 'the day'} (${formatDateDisplay(selectedDay.date)}).`}
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
                            Evening Slots (05:00 PM onwards)
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
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-secondary)' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '36px', marginBottom: '8px', opacity: 0.5 }}>
                        event_busy
                      </span>
                      <p className="body-md">No time slots found matching your filter criteria.</p>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setFilterPeriod('all')}
                        style={{ marginTop: '12px' }}
                      >
                        Reset Filters
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Grid Layout */
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: '12px'
                }}
              >
                {filteredSlots.map(renderGridSlotCard)}

                {filteredSlots.length === 0 && (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 20px', color: 'var(--color-secondary)' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '36px', marginBottom: '8px', opacity: 0.5 }}>
                      event_busy
                    </span>
                    <p className="body-md">No time slots found matching your filter criteria.</p>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setFilterPeriod('all')}
                      style={{ marginTop: '12px' }}
                    >
                      Reset Filters
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Slot Booking Confirmation Modal */}
      {selectedSlotForBooking && (
        <div className="modal-overlay" onClick={() => !isSubmitting && setSelectedSlotForBooking(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-drag-handle" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 className="headline-md" style={{ color: 'var(--color-primary)' }}>
                Confirm Slot Reservation
              </h3>
              <button
                onClick={() => !isSubmitting && setSelectedSlotForBooking(null)}
                style={{ color: 'var(--color-secondary)' }}
                disabled={isSubmitting}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div
              style={{
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-surface-container)',
                marginBottom: '20px'
              }}
            >
              {isMultiDay && (
                <div style={{ marginBottom: '8px' }}>
                  <span className="chip chip-accent" style={{ fontSize: '11px', fontWeight: '700' }}>
                    🗓️ {selectedSlotForBooking.dayLabel || selectedDay.label || 'Day 1'} • {formatDateDisplay(selectedSlotForBooking.date || selectedDay.date)}
                  </span>
                </div>
              )}
              <div className="label-sm" style={{ color: 'var(--color-secondary)', marginBottom: '4px' }}>
                Requested Time Slot
              </div>
              <div className="headline-md" style={{ color: 'var(--color-primary)', marginBottom: '4px' }}>
                {selectedSlotForBooking.timeLabel}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-secondary)' }}>
                {formatDateDisplay(selectedSlotForBooking.date || selectedDay.date || session.date)} ({session.timezone}) • {duration} Minutes
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

      {/* 2-Step Slot Switch Verification Modal */}
      {slotToSwitch && (
        <div className="modal-overlay" onClick={() => !isSubmitting && setSlotToSwitch(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-drag-handle" />

            {/* Header & Step Indicator */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: switchStep === 2 ? '#ffebee' : 'var(--color-secondary-container)',
                    color: switchStep === 2 ? '#d32f2f' : 'var(--color-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  <span className="material-symbols-outlined">
                    {switchStep === 2 ? 'warning' : 'swap_horiz'}
                  </span>
                </div>
                <div>
                  <h3 className="headline-md" style={{ color: 'var(--color-primary)' }}>
                    {switchStep === 1 ? 'Step 1 of 2: Review New Time' : 'Step 2 of 2: Final Confirmation & Lock'}
                  </h3>
                  <span className={`chip ${switchStep === 2 ? 'chip-neutral' : 'chip-accent'}`} style={{ fontSize: '11px', marginTop: '3px' }}>
                    {switchStep === 1 ? '1-Time Slot Change Policy' : '⚠️ Permanent & Irreversible Action'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => !isSubmitting && setSlotToSwitch(null)}
                style={{ color: 'var(--color-secondary)', padding: '4px' }}
                disabled={isSubmitting}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Visual Step Progress Bar */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '18px' }}>
              <div
                style={{
                  flex: 1,
                  height: '4px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--color-primary)',
                  transition: 'all 0.3s ease'
                }}
              />
              <div
                style={{
                  flex: 1,
                  height: '4px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: switchStep === 2 ? '#d32f2f' : 'var(--color-outline-variant)',
                  transition: 'all 0.3s ease'
                }}
              />
            </div>

            {/* STEP 1: TIME COMPARISON & SELECTION REVIEW */}
            {switchStep === 1 && (
              <div>
                <p className="body-sm" style={{ color: 'var(--color-secondary)', marginBottom: '16px' }}>
                  You are switching your booking time. Please review your new selected slot:
                </p>

                <div
                  style={{
                    backgroundColor: 'var(--color-surface-container)',
                    border: '1px solid var(--color-outline-variant)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  <div>
                    <div className="label-sm" style={{ color: 'var(--color-secondary)' }}>Current Slot</div>
                    <div style={{ fontWeight: '700', color: 'var(--color-primary)', textDecoration: 'line-through', fontSize: '15px' }}>
                      {myBooking?.timeLabel}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-secondary)', marginTop: '2px' }}>
                      {myBooking?.dayLabel ? `${myBooking.dayLabel} • ` : ''}{formatDateDisplay(myBooking?.slotDate || session.date)}
                    </div>
                  </div>
                  <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '24px' }}>
                    arrow_forward
                  </span>
                  <div>
                    <div className="label-sm" style={{ color: 'var(--color-success)' }}>New Requested Slot</div>
                    <div style={{ fontWeight: '800', color: 'var(--color-success)', fontSize: '16px' }}>
                      {slotToSwitch.timeLabel}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-success)', marginTop: '2px', fontWeight: '700' }}>
                      {slotToSwitch.dayLabel ? `${slotToSwitch.dayLabel} • ` : ''}{formatDateDisplay(slotToSwitch.date || selectedDay.date)}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: '#fff8e6',
                    border: '1px solid #f2c744',
                    color: '#7a5200',
                    fontSize: '12px',
                    lineHeight: 1.5,
                    marginBottom: '20px',
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'flex-start'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#b58105', marginTop: '2px' }}>
                    info
                  </span>
                  <div>
                    <strong>Notice:</strong> Each candidate is permitted <strong>only 1 slot change</strong> per session. On the next step, you will be asked to verify and finalize this change.
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setSlotToSwitch(null)}
                  >
                    Keep Current Booking
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setSwitchStep(2)}
                  >
                    <span>Proceed to Verification</span>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_forward</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: FINAL WARNING, LOCK CONFIRMATION & ACKNOWLEDGMENT CHECKBOX */}
            {switchStep === 2 && (
              <div>
                <div
                  style={{
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: '#fff5f5',
                    border: '2px solid #ef5350',
                    marginBottom: '18px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c62828', fontWeight: '800', fontSize: '14px', marginBottom: '8px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>error</span>
                    <span>FINAL WARNING: THIS CHANGE IS PERMANENT</span>
                  </div>
                  <ul style={{ paddingLeft: '20px', color: '#b71c1c', fontSize: '13px', lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <li>
                      Your booking will be moved to <strong>{slotToSwitch.dayLabel ? `${slotToSwitch.dayLabel} (` : ''}{formatDateDisplay(slotToSwitch.date || selectedDay.date)}{slotToSwitch.dayLabel ? ')' : ''} at {slotToSwitch.timeLabel}</strong>.
                    </li>
                    <li>
                      <strong>You will have 0 slot changes remaining.</strong>
                    </li>
                    <li>
                      You will <strong>NOT</strong> be able to change, reschedule, or cancel this slot again.
                    </li>
                  </ul>
                </div>

                {/* Mandatory Acknowledgment Checkbox */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--color-surface-container)',
                    border: hasAcceptedFinalWarning ? '1.5px solid var(--color-primary)' : '1px solid var(--color-outline-variant)',
                    marginBottom: '20px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    cursor: 'pointer'
                  }}
                  onClick={() => setHasAcceptedFinalWarning(!hasAcceptedFinalWarning)}
                >
                  <input
                    type="checkbox"
                    id="ack-final-lock"
                    checked={hasAcceptedFinalWarning}
                    onChange={(e) => setHasAcceptedFinalWarning(e.target.checked)}
                    style={{ width: '18px', height: '18px', marginTop: '2px', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <label htmlFor="ack-final-lock" style={{ fontSize: '13px', color: 'var(--color-primary)', cursor: 'pointer', lineHeight: 1.45 }}>
                    <strong>I understand and acknowledge</strong> that this is my <strong>only allowed change</strong>. After confirming, my scheduled time will be permanently locked and cannot be changed again.
                  </label>
                </div>

                {switchError && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--color-error-container)',
                      color: 'var(--color-on-error-container)',
                      fontSize: '13px',
                      marginBottom: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>error</span>
                    <span>{switchError}</span>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setSwitchStep(1)}
                    disabled={isSubmitting}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_back</span>
                    <span>Back</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleConfirmSlotSwitch}
                    disabled={!hasAcceptedFinalWarning || isSubmitting}
                    style={{
                      backgroundColor: hasAcceptedFinalWarning ? 'var(--color-primary)' : 'var(--color-outline)',
                      borderColor: hasAcceptedFinalWarning ? 'var(--color-primary)' : 'var(--color-outline)',
                      opacity: hasAcceptedFinalWarning ? 1 : 0.6
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>lock</span>
                    <span>{isSubmitting ? 'Finalizing...' : `Confirm & Lock ${slotToSwitch.timeLabel}`}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ineligibility Reason Modal */}
      {ineligibilityModal && (
        <div className="modal-overlay" onClick={() => setIneligibilityModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--color-error-container)',
                  color: 'var(--color-on-error-container)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <span className="material-symbols-outlined">lock</span>
              </div>
              <h3 className="headline-md" style={{ color: 'var(--color-primary)' }}>
                {ineligibilityModal.title}
              </h3>
            </div>

            <p className="body-md" style={{ color: 'var(--color-on-surface-variant)', marginBottom: '20px', lineHeight: 1.5 }}>
              {ineligibilityModal.message}
            </p>

            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-surface-container)',
                border: '1px solid var(--color-outline-variant)',
                fontSize: '12px',
                color: 'var(--color-secondary)',
                marginBottom: '20px'
              }}
            >
              <strong>Policy Guidelines:</strong>
              <ul style={{ marginTop: '6px', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <li>Maximum of 1 slot change per candidate.</li>
                <li>Changes and cancellations must be made &gt; 3 hours before start time.</li>
              </ul>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIneligibilityModal(null)}
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Self-Cancellation */}
      <ConfirmModal
        isOpen={Boolean(slotToCancel)}
        title="Cancel Your Booking?"
        message={`Are you sure you want to cancel your ${slotToCancel?.timeLabel} slot? Note that cancelling will count as your 1 permitted slot change. You will be able to book another open slot if available.`}
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
            <div className="modal-drag-handle" />
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
              <span className="chip chip-accent" style={{ fontSize: '10px', padding: '1px 6px' }}>
                {editsRemaining} remaining
              </span>
            </div>

            <form onSubmit={handleSaveEditInfo}>
              <div style={{ marginBottom: '14px' }}>
                <label className="input-label" htmlFor="edit-name">
                  Full Name *
                </label>
                <input
                  id="edit-name"
                  type="text"
                  className="input-field"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Enter your full name"
                  required
                  autoFocus
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label className="input-label" htmlFor="edit-cat">
                  Category Track *
                </label>
                <select
                  id="edit-cat"
                  className="input-field"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  required
                >
                  {(session.categories || ['Category A', 'Category B', 'Category C']).map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label className="input-label" htmlFor="edit-email">
                  Email Address *
                </label>
                <input
                  id="edit-email"
                  type="email"
                  className="input-field"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label className="input-label" htmlFor="edit-phone">
                  Phone / WhatsApp Number *
                </label>
                <input
                  id="edit-phone"
                  type="tel"
                  className="input-field"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  required
                />
              </div>

              {editError && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--color-error-container)',
                    color: 'var(--color-on-error-container)',
                    fontSize: '13px',
                    marginBottom: '16px'
                  }}
                >
                  {editError}
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
                  {isSavingEdit ? 'Saving...' : 'Save & Update Details'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QA Tester Floating HUD */}
      {isTester && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: 9999,
            backgroundColor: '#1e293b',
            color: '#f8fafc',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
            border: '1px solid #334155',
            overflow: 'hidden',
            width: isTesterHudOpen ? '320px' : 'auto',
            transition: 'all 0.2s ease'
          }}
        >
          {/* HUD Header */}
          <div
            style={{
              padding: '10px 14px',
              backgroundColor: '#0f172a',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer'
            }}
            onClick={() => setIsTesterHudOpen(!isTesterHudOpen)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#38bdf8' }}>
                science
              </span>
              <span style={{ fontWeight: '700', fontSize: '13px', letterSpacing: '0.5px' }}>
                ADMIN QA TESTER TOOLBOX
              </span>
            </div>
            <button
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
              title={isTesterHudOpen ? 'Collapse HUD' : 'Expand HUD'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                {isTesterHudOpen ? 'expand_more' : 'expand_less'}
              </span>
            </button>
          </div>

          {/* HUD Body */}
          {isTesterHudOpen && (
            <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                <span>Identity:</span>
                <strong style={{ color: '#38bdf8' }}>{participantProfile.name}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                <span>Category Track:</span>
                <strong>{participantProfile.category || 'A'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                <span>Slot Change Used:</span>
                <strong style={{ color: slotChangeEligibility?.changeCount >= 1 ? '#f87171' : '#4ade80' }}>
                  {slotChangeEligibility?.changeCount || 0} / 1
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                <span>Info Edits Used:</span>
                <strong style={{ color: editCount >= 2 ? '#f87171' : '#4ade80' }}>
                  {editCount} / 2
                </strong>
              </div>

              {/* Category Quick Switcher for Testers */}
              <div style={{ borderTop: '1px solid #334155', paddingTop: '8px', marginTop: '4px' }}>
                <div style={{ color: '#94a3b8', marginBottom: '6px', fontSize: '11px', fontWeight: '600' }}>
                  SWITCH CANDIDATE TRACK:
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {(session.categories || ['Category A', 'Category B', 'Category C']).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => handleQuickSwitchCategory(cat)}
                      style={{
                        padding: '3px 8px',
                        fontSize: '10px',
                        borderRadius: '4px',
                        border: '1px solid #475569',
                        backgroundColor: (participantProfile.category === cat) ? '#38bdf8' : '#1e293b',
                        color: (participantProfile.category === cat) ? '#0f172a' : '#f8fafc',
                        fontWeight: '700',
                        cursor: 'pointer'
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ borderTop: '1px solid #334155', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <button
                  onClick={handleResetMyTestBooking}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '4px',
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>refresh</span>
                  <span>Wipe My Test Booking</span>
                </button>

                <button
                  onClick={handleResetChangeLimit}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '4px',
                    backgroundColor: '#475569',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>restart_alt</span>
                  <span>Reset Slot Change Limit (0/1)</span>
                </button>

                <button
                  onClick={handleResetAccountAndGoToGate}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '4px',
                    backgroundColor: '#dc2626',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>logout</span>
                  <span>Wipe Tester & Return to Info Form</span>
                </button>

                <button
                  onClick={handleExitTesterMode}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    backgroundColor: 'transparent',
                    color: '#94a3b8',
                    border: '1px solid #475569',
                    fontWeight: '500',
                    cursor: 'pointer',
                    marginTop: '2px'
                  }}
                >
                  Exit Tester Mode (Clear Profile)
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
