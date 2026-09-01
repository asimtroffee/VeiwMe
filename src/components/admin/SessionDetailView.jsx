import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  getSessionDetails,
  getSessionAttendees,
  cancelBooking,
  toggleSlotBlocked,
  updateSessionMeetingLink,
  updateSessionDescription,
  updateSessionCategories,
  resetTesterSessionState,
  clearParticipantProfile,
  subscribeToSync
} from '../../services/storage';
import { formatDateDisplay } from '../../services/timeUtils';
import ConfirmModal from '../common/ConfirmModal';
import EditSessionModal from './EditSessionModal';

export default function SessionDetailView({ sessionId, onBack, onShowToast }) {
  const [session, setSession] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [activeTab, setActiveTab] = useState('slots'); // 'slots' | 'attendees'
  const [selectedCategoryTab, setSelectedCategoryTab] = useState('all'); // 'all' | category name
  const [isManagingCategories, setIsManagingCategories] = useState(false);
  const [isEditingSessionModal, setIsEditingSessionModal] = useState(false);
  const [categoryEditList, setCategoryEditList] = useState([]);
  const [newCatInput, setNewCatInput] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('all'); // all | available | booked | blocked | morning | afternoon | evening
  const [layoutMode, setLayoutMode] = useState('stream'); // 'stream' | 'grid'
  const [slotToCancel, setSlotToCancel] = useState(null);
  const [isEditingMeetingLink, setIsEditingMeetingLink] = useState(false);
  const [meetingLinkInput, setMeetingLinkInput] = useState('');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionInput, setDescriptionInput] = useState('');

  const scrollContainerRef = useRef(null);

  const loadData = () => {
    const details = getSessionDetails(sessionId);
    setSession(details);
    const atts = getSessionAttendees(sessionId);
    setAttendees(atts);
  };

  useEffect(() => {
    loadData();
    const unsubscribe = subscribeToSync(() => {
      loadData();
    });
    return () => unsubscribe();
  }, [sessionId]);

  const copySessionLink = () => {
    const url = `${window.location.origin}${window.location.pathname}#/session/${sessionId}`;
    navigator.clipboard.writeText(url);
    onShowToast('Unique session link copied to clipboard!');
  };

  const handleConfirmCancelSlot = async () => {
    if (!slotToCancel) return;
    const res = await cancelBooking(sessionId, slotToCancel.id);
    if (res.success) {
      onShowToast(`Cancelled booking for ${slotToCancel.booking?.candidateName || 'slot'}`);
      loadData();
    } else {
      onShowToast(res.error || 'Failed to cancel booking.', 'error');
    }
    setSlotToCancel(null);
  };

  const handleToggleBlockSlot = (slot) => {
    const res = toggleSlotBlocked(sessionId, slot.id);
    if (res.success) {
      onShowToast(res.isBlocked ? `Slot ${slot.timeLabel} marked unavailable.` : `Slot ${slot.timeLabel} is now open and available.`);
      loadData();
    }
  };

  const handleLaunchTester = () => {
    if (!session) return;
    const testerProfile = {
      name: 'Admin QA Tester',
      category: session.categories?.[0] || 'Category A',
      email: 'tester@viewme.internal',
      phone: '+1 555-000-TEST',
      contact: 'tester@viewme.internal • +1 555-000-TEST',
      editCount: 0,
      isTester: true,
      id: `att_tester_${session.id}`
    };
    if (typeof window !== 'undefined') {
      localStorage.setItem(`viewme_participant_${session.id}`, JSON.stringify(testerProfile));
      window.location.hash = `#/session/${session.id}`;
    }
  };

  const handleLaunchTesterFresh = async () => {
    if (!session) return;
    await resetTesterSessionState(session.id, 'tester@viewme.internal');
    clearParticipantProfile(session.id);
    window.location.hash = `#/session/${session.id}`;
  };

  const handleSaveMeetingLink = (e) => {
    e.preventDefault();
    const res = updateSessionMeetingLink(sessionId, meetingLinkInput);
    if (res.success) {
      onShowToast(meetingLinkInput.trim() ? 'Zoom meeting link updated!' : 'Meeting link cleared.');
      setIsEditingMeetingLink(false);
      loadData();
    } else {
      onShowToast(res.error || 'Failed to update meeting link.', 'error');
    }
  };

  const handleSaveDescription = (e) => {
    e.preventDefault();
    const res = updateSessionDescription(sessionId, descriptionInput);
    if (res.success) {
      onShowToast(descriptionInput.trim() ? 'Candidate instructions saved!' : 'Instructions cleared.');
      setIsEditingDescription(false);
      loadData();
    } else {
      onShowToast(res.error || 'Failed to update instructions.', 'error');
    }
  };

  const handleOpenManageCategories = () => {
    setCategoryEditList(session?.categories || ['Category A', 'Category B', 'Category C']);
    setNewCatInput('');
    setIsManagingCategories(true);
  };

  const handleAddCategoryToEditList = (e) => {
    if (e) e.preventDefault();
    const clean = newCatInput.trim();
    if (!clean) return;
    if (categoryEditList.some((c) => c.toLowerCase() === clean.toLowerCase())) {
      onShowToast(`Category "${clean}" already exists.`, 'error');
      return;
    }
    setCategoryEditList([...categoryEditList, clean]);
    setNewCatInput('');
  };

  const handleRemoveCategoryFromEditList = (catToRemove) => {
    if (categoryEditList.length <= 1) {
      onShowToast('A session must have at least 1 category.', 'error');
      return;
    }
    setCategoryEditList(categoryEditList.filter((c) => c !== catToRemove));
  };

  const handleSaveCategories = () => {
    if (categoryEditList.length === 0) {
      onShowToast('Please add at least 1 category.', 'error');
      return;
    }
    const res = updateSessionCategories(sessionId, categoryEditList);
    if (res.success) {
      onShowToast(`Updated session categories (${categoryEditList.length} total)`);
      setIsManagingCategories(false);
      loadData();
    } else {
      onShowToast(res.error || 'Failed to update categories.', 'error');
    }
  };

  const handleScrollStream = (direction) => {
    if (scrollContainerRef.current) {
      const offset = direction === 'up' ? -260 : 260;
      scrollContainerRef.current.scrollBy({ top: offset, behavior: 'smooth' });
    }
  };

  const scrollToPeriodSection = (periodKey) => {
    if (filterPeriod !== 'all' && filterPeriod !== 'available') {
      setFilterPeriod('all');
    }
    setTimeout(() => {
      const target = document.getElementById(`admin-timeline-period-${periodKey}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 40);
  };

  const exportCSV = () => {
    if (!session) return;

    if (activeTab === 'attendees') {
      const headers = ['Session Title', 'Session Date', 'Candidate Name', 'Category', 'Email', 'Phone', 'Contact Info', 'Status', 'Booked Slot', 'First Checked In', 'Last Seen', 'Device', 'Client Timezone'];
      const rows = attendees.map((att) => [
        `"${(session.title || '').replace(/"/g, '""')}"`,
        `"${session.date}"`,
        `"${(att.name || '').replace(/"/g, '""')}"`,
        `"${att.category || 'A'}"`,
        `"${(att.email || '').replace(/"/g, '""')}"`,
        `"${(att.phone || '').replace(/"/g, '""')}"`,
        `"${(att.contact || '').replace(/"/g, '""')}"`,
        `"${att.isBooked ? 'Booked' : 'Checked In'}"`,
        `"${att.bookedSlot ? att.bookedSlot.timeLabel : 'None'}"`,
        `"${att.firstCheckedInAt ? new Date(att.firstCheckedInAt).toLocaleString() : ''}"`,
        `"${att.lastSeenAt ? new Date(att.lastSeenAt).toLocaleString() : ''}"`,
        `"${att.device || 'Desktop'}"`,
        `"${att.clientTimezone || session.timezone}"`
      ]);

      const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `${session.title.replace(/\s+/g, '_')}_attendees.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      onShowToast('Attendees CSV exported successfully!');
      return;
    }

    if (!session.slots) return;
    const headers = ['Session Title', 'Session Date', 'Slot Time', 'Category', 'Status', 'Candidate Name', 'Email', 'Phone', 'Contact Info', 'Booked At'];
    const rows = (session.allSlots || session.slots).map((slot) => [
      `"${(session.title || '').replace(/"/g, '""')}"`,
      `"${session.date}"`,
      `"${slot.timeLabel}"`,
      `"${slot.category || slot.booking?.candidateCategory || 'A'}"`,
      slot.isBooked ? '"Booked"' : slot.isBlocked ? '"Unavailable (Blocked)"' : '"Available"',
      slot.isBooked ? `"${(slot.booking.candidateName || '').replace(/"/g, '""')}"` : '""',
      slot.isBooked ? `"${(slot.booking.candidateEmail || '').replace(/"/g, '""')}"` : '""',
      slot.isBooked ? `"${(slot.booking.candidatePhone || '').replace(/"/g, '""')}"` : '""',
      slot.isBooked ? `"${(slot.booking.candidateContact || '').replace(/"/g, '""')}"` : '""',
      slot.isBooked ? `"${new Date(slot.booking.bookedAt).toLocaleString()}"` : '""'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${session.title.replace(/\s+/g, '_')}_schedule.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onShowToast('CSV Schedule exported successfully!');
  };

  const filteredSlots = useMemo(() => {
    if (!session) return [];
    const sourceSlots = session.allSlots || session.slots || [];
    return sourceSlots.filter((slot) => {
      if (selectedCategoryTab !== 'all' && slot.category && slot.category !== selectedCategoryTab) {
        return false;
      }
      if (filterPeriod === 'available') return !slot.isBooked && !slot.isBlocked;
      if (filterPeriod === 'booked') return slot.isBooked;
      if (filterPeriod === 'blocked') return slot.isBlocked;
      if (filterPeriod === 'morning') return slot.period === 'morning';
      if (filterPeriod === 'afternoon') return slot.period === 'afternoon';
      if (filterPeriod === 'evening') return slot.period === 'evening';
      return true;
    });
  }, [session, filterPeriod, selectedCategoryTab]);

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

  const renderAdminStreamSlotRow = (slot) => {
    if (slot.isBooked) {
      return (
        <div key={slot.id} className="timeline-slot-row booked">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div className="timeline-slot-dot booked" />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="font-headline" style={{ fontWeight: '800', fontSize: '15px', color: 'var(--color-primary)' }}>
                  {slot.timeLabel}
                </span>
                <span className="chip chip-neutral" style={{ fontSize: '11px', padding: '2px 8px' }}>
                  Booked
                </span>
                <span className="chip chip-accent" style={{ fontSize: '10px', padding: '1px 6px' }}>
                  Category {slot.booking.candidateCategory || 'A'}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-secondary)', marginTop: '4px' }}>
                {slot.booking.candidateName} • {slot.booking.candidateEmail ? `${slot.booking.candidateEmail} ${slot.booking.candidatePhone ? `• ${slot.booking.candidatePhone}` : ''}` : slot.booking.candidateContact}
              </div>
            </div>
          </div>

          <button
            className="btn btn-sm btn-danger"
            onClick={() => setSlotToCancel(slot)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>cancel</span>
            <span>Cancel Booking</span>
          </button>
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
                Marked unavailable (participants cannot book)
              </div>
            </div>
          </div>

          <button
            className="btn btn-sm btn-secondary"
            onClick={() => handleToggleBlockSlot(slot)}
            title="Make this slot available for participants"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span>
            <span>Make Available</span>
          </button>
        </div>
      );
    }

    // Available Slot
    return (
      <div key={slot.id} className="timeline-slot-row available">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div className="timeline-slot-dot open" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="font-headline" style={{ fontWeight: '800', fontSize: '15px', color: 'var(--color-primary)' }}>
                {slot.timeLabel}
              </span>
              <span className="chip chip-success" style={{ fontSize: '11px', padding: '2px 8px' }}>
                Open
              </span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-secondary)', marginTop: '4px' }}>
              Available for candidate booking
            </div>
          </div>
        </div>

        <button
          className="btn btn-sm btn-secondary"
          onClick={() => handleToggleBlockSlot(slot)}
          style={{ color: 'var(--color-secondary)', border: '1px solid var(--color-outline-variant)' }}
          title="Mark unavailable so candidates cannot book"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>block</span>
          <span>Make Unavailable</span>
        </button>
      </div>
    );
  };

  const renderAdminGridSlotCard = (slot) => {
    if (slot.isBooked) {
      return (
        <div
          key={slot.id}
          className="slot-card booked"
          style={{ minHeight: '140px' }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span className="label-md" style={{ color: 'var(--color-primary)', fontWeight: '700' }}>
                {slot.timeLabel}
              </span>
              <span className="chip chip-neutral">Booked</span>
            </div>

            <div style={{ marginTop: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: '600', color: 'var(--color-primary)', fontSize: '14px' }}>
                  {slot.booking.candidateName}
                </span>
                <span className="chip chip-accent" style={{ fontSize: '10px', padding: '1px 6px' }}>
                  Category {slot.booking.candidateCategory || 'A'}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-secondary)', marginTop: '2px' }}>
                {slot.booking.candidateEmail ? `${slot.booking.candidateEmail} ${slot.booking.candidatePhone ? `• ${slot.booking.candidatePhone}` : ''}` : slot.booking.candidateContact}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                Booked {new Date(slot.booking.bookedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>

          <div style={{ marginTop: '14px', borderTop: '1px solid var(--color-outline-variant)', paddingTop: '10px', textAlign: 'right' }}>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => setSlotToCancel(slot)}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>cancel</span>
              Cancel Booking
            </button>
          </div>
        </div>
      );
    }

    if (slot.isBlocked) {
      return (
        <div
          key={slot.id}
          className="slot-card"
          style={{
            minHeight: '140px',
            backgroundColor: 'var(--color-surface-container)',
            borderColor: 'var(--color-outline-variant)',
            opacity: 0.95
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span className="label-md" style={{ color: 'var(--color-secondary)', fontWeight: '700' }}>
                {slot.timeLabel}
              </span>
              <span
                className="chip"
                style={{
                  backgroundColor: 'var(--color-error-container)',
                  color: 'var(--color-on-error-container)',
                  fontSize: '11px',
                  fontWeight: '600'
                }}
              >
                Unavailable
              </span>
            </div>

            <div style={{ fontSize: '13px', color: 'var(--color-secondary)', marginTop: '10px' }}>
              Marked unavailable by admin (not bookable by participants)
            </div>
          </div>

          <div style={{ marginTop: '14px', borderTop: '1px solid var(--color-outline-variant)', paddingTop: '10px', textAlign: 'right' }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => handleToggleBlockSlot(slot)}
              title="Make this slot open and available for participants"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span>
              <span>Make Available</span>
            </button>
          </div>
        </div>
      );
    }

    // Available Slot
    return (
      <div
        key={slot.id}
        className="slot-card available"
        style={{ minHeight: '140px' }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span className="label-md" style={{ color: 'var(--color-primary)', fontWeight: '700' }}>
              {slot.timeLabel}
            </span>
            <span className="chip chip-success">Open</span>
          </div>

          <div style={{ fontSize: '13px', color: 'var(--color-secondary)', marginTop: '10px' }}>
            Available for candidate booking
          </div>
        </div>

        <div style={{ marginTop: '14px', borderTop: '1px solid var(--color-outline-variant)', paddingTop: '10px', textAlign: 'right' }}>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => handleToggleBlockSlot(slot)}
            style={{ color: 'var(--color-secondary)', border: '1px solid var(--color-outline-variant)' }}
            title="Mark this slot unavailable so candidates cannot book it"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>block</span>
            <span>Make Unavailable</span>
          </button>
        </div>
      </div>
    );
  };

  if (!session) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
        <p className="body-lg" style={{ color: 'var(--color-secondary)' }}>
          Session not found or has been deleted.
        </p>
        <button className="btn btn-primary" onClick={onBack} style={{ marginTop: '16px' }}>
          Back to Sessions
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Navigation Top Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ paddingLeft: 0 }}>
          <span className="material-symbols-outlined">arrow_back</span>
          <span>Back to All Sessions</span>
        </button>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            onClick={() => setIsEditingSessionModal(true)}
            title="Edit session details, timezone, date, and times"
            style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', backgroundColor: 'rgba(99, 102, 241, 0.08)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>edit_calendar</span>
            <span>Edit Session Info</span>
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleLaunchTesterFresh}
            title="Reset tester profile and open the check-in info form from scratch"
            style={{ borderColor: '#8b5cf6', color: '#6d28d9', backgroundColor: 'rgba(139, 92, 246, 0.08)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#8b5cf6' }}>person_edit</span>
            <span>Reset Tester (View Info Place)</span>
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleLaunchTester}
            title="Open candidate schedule directly in tester mode"
            style={{ borderColor: '#3b82f6', color: '#1d4ed8', backgroundColor: 'rgba(59, 130, 246, 0.08)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#3b82f6' }}>science</span>
            <span>Quick Test Board</span>
          </button>
          <button className="btn btn-secondary" onClick={exportCSV}>
            <span className="material-symbols-outlined">download</span>
            <span>Export CSV</span>
          </button>
          <button className="btn btn-primary" onClick={copySessionLink}>
            <span className="material-symbols-outlined">link</span>
            <span>Copy Participant Link</span>
          </button>
        </div>
      </div>

      {/* Session Hero Card */}
      <div className="card" style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span className="chip chip-accent">{session.timezone} Timezone</span>
              <span className="chip chip-neutral">{session.totalSlots} Slots ({session.slotDuration || 15} min)</span>
              <span className="chip chip-neutral">{attendees.length} Checked-in Candidates</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <h1 className="headline-lg" style={{ color: 'var(--color-primary)', margin: 0 }}>
                {session.title}
              </h1>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setIsEditingSessionModal(true)}
                title="Edit title, date, timezone (e.g. EST to MYT), and times"
                style={{ padding: '4px 8px', fontSize: '12px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                <span>Edit Details</span>
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: 'var(--color-secondary)', fontSize: '14px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>calendar_today</span>
                {formatDateDisplay(session.date)}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>schedule</span>
                {session.slots[0]?.startTime} – {session.slots[session.slots.length - 1]?.endTime}
              </span>
            </div>
            {/* Candidate Instructions / Description Section */}
            <div
              style={{
                marginTop: '16px',
                padding: '14px 16px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-surface-container)',
                border: '1px solid var(--color-outline-variant)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#f59e0b' }}>
                    description
                  </span>
                  <span style={{ fontWeight: '700', fontSize: '13px', color: 'var(--color-primary)' }}>
                    Candidate Instructions & Description:
                  </span>
                </div>

                {!isEditingDescription && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setDescriptionInput(session.description || '');
                      setIsEditingDescription(true);
                    }}
                    style={{ fontSize: '12px', padding: '4px 8px' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                    <span>{session.description ? 'Edit Instructions' : '+ Add Description'}</span>
                  </button>
                )}
              </div>

              {isEditingDescription ? (
                <form onSubmit={handleSaveDescription} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <textarea
                    className="input-field"
                    value={descriptionInput}
                    onChange={(e) => setDescriptionInput(e.target.value)}
                    placeholder="e.g. Please join from a quiet room with video enabled. Have your portfolio and resume ready..."
                    rows={4}
                    style={{ fontSize: '13px', width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setIsEditingDescription(false)}
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      style={{ fontSize: '12px', padding: '6px 14px' }}
                    >
                      Save Instructions
                    </button>
                  </div>
                </form>
              ) : session.description ? (
                <p
                  className="body-sm"
                  style={{
                    color: 'var(--color-on-surface-variant)',
                    backgroundColor: 'var(--color-surface)',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-outline-variant)',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.55,
                    fontSize: '13px'
                  }}
                >
                  {session.description}
                </p>
              ) : (
                <span className="body-sm" style={{ color: 'var(--color-secondary)', fontStyle: 'italic', fontSize: '13px' }}>
                  No candidate instructions provided yet. Click "+ Add Description" to write guidance for candidates.
                </span>
              )}
            </div>

            {/* Video Meeting / Zoom Link Section */}
            <div
              style={{
                marginTop: '16px',
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-surface-container)',
                border: '1px solid var(--color-outline-variant)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#2D8CFF' }}>
                    videocam
                  </span>
                  <span style={{ fontWeight: '700', fontSize: '13px', color: 'var(--color-primary)' }}>
                    Zoom / Video Meeting Link:
                  </span>
                </div>

                {!isEditingMeetingLink && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setMeetingLinkInput(session.meetingLink || '');
                      setIsEditingMeetingLink(true);
                    }}
                    style={{ fontSize: '12px', padding: '4px 8px' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                    <span>{session.meetingLink ? 'Edit Link' : '+ Add Zoom Link'}</span>
                  </button>
                )}
              </div>

              {isEditingMeetingLink ? (
                <form onSubmit={handleSaveMeetingLink} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    type="url"
                    className="input-field"
                    style={{ flex: 1, minWidth: '220px', padding: '8px 12px', fontSize: '13px' }}
                    placeholder="e.g. https://zoom.us/j/123456789 or Google Meet"
                    value={meetingLinkInput}
                    onChange={(e) => setMeetingLinkInput(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="btn btn-primary btn-sm">
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setIsEditingMeetingLink(false)}
                  >
                    Cancel
                  </button>
                </form>
              ) : session.meetingLink ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <a
                    href={session.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#1a73e8',
                      fontSize: '13px',
                      textDecoration: 'underline',
                      fontWeight: '600',
                      wordBreak: 'break-all'
                    }}
                  >
                    {session.meetingLink}
                  </a>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      navigator.clipboard.writeText(session.meetingLink);
                      onShowToast('Zoom link copied to clipboard!');
                    }}
                    style={{ padding: '4px 8px', fontSize: '11px' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>content_copy</span>
                    <span>Copy</span>
                  </button>
                  <a
                    href={session.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary btn-sm"
                    style={{ padding: '4px 10px', fontSize: '11px', backgroundColor: '#2D8CFF', borderColor: '#2D8CFF' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>open_in_new</span>
                    <span>Launch Call</span>
                  </a>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--color-secondary)' }}>
                  No Zoom link provided yet. Candidates will see "Link sent upon booking". Click <strong>+ Add Zoom Link</strong> to set one.
                </div>
              )}
            </div>
          </div>

          {/* Booking Progress Indicator */}
          <div
            style={{
              padding: '16px 20px',
              backgroundColor: 'var(--color-surface-container)',
              borderRadius: 'var(--radius-lg)',
              minWidth: '200px',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--color-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>
              Occupancy
            </div>
            <div className="headline-md" style={{ color: 'var(--color-primary)' }}>
              {session.bookedCount} <span style={{ fontSize: '16px', color: 'var(--color-secondary)' }}>/ {session.totalSlots}</span>
            </div>
            <div
              style={{
                height: '6px',
                backgroundColor: 'var(--color-outline-variant)',
                borderRadius: 'var(--radius-full)',
                overflow: 'hidden',
                marginTop: '8px'
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${session.percentBooked}%`,
                  backgroundColor: 'var(--color-primary)',
                  transition: 'width 0.3s ease'
                }}
              />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-secondary)', marginTop: '4px' }}>
              {session.percentBooked}% Booked
            </div>
          </div>
        </div>
      </div>

      {/* Main View Switcher: Slot Grid vs Checked-In Attendees Log */}
      <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--color-outline-variant)', marginBottom: '24px' }}>
        <button
          onClick={() => setActiveTab('slots')}
          style={{
            padding: '10px 16px',
            borderBottom: activeTab === 'slots' ? '2px solid var(--color-primary)' : '2px solid transparent',
            fontWeight: activeTab === 'slots' ? '700' : '500',
            color: activeTab === 'slots' ? 'var(--color-primary)' : 'var(--color-secondary)',
            fontSize: '15px'
          }}
        >
          Slot Grid ({session.slots.length})
        </button>
        <button
          onClick={() => setActiveTab('attendees')}
          style={{
            padding: '10px 16px',
            borderBottom: activeTab === 'attendees' ? '2px solid var(--color-primary)' : '2px solid transparent',
            fontWeight: activeTab === 'attendees' ? '700' : '500',
            color: activeTab === 'attendees' ? 'var(--color-primary)' : 'var(--color-secondary)',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>Checked-in Attendees Log</span>
          <span className="chip chip-neutral" style={{ fontSize: '11px', padding: '2px 8px' }}>
            {attendees.length}
          </span>
        </button>
      </div>

      {activeTab === 'attendees' ? (
        /* Checked-In Attendees List */
        <div>
          <div style={{ marginBottom: '16px' }}>
            <h3 className="headline-md" style={{ color: 'var(--color-primary)', marginBottom: '4px' }}>
              Recorded Attendees & Check-ins
            </h3>
            <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
              Candidates who unlocked the session link with their name & contact details.
            </p>
          </div>

          {attendees.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {attendees.map((att) => (
                <div
                  key={att.id}
                  className="card"
                  style={{
                    padding: '18px 24px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--color-secondary-container)',
                        color: 'var(--color-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: '700',
                        fontSize: '16px'
                      }}
                    >
                      {att.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: '700', fontSize: '15px', color: 'var(--color-primary)' }}>
                          {att.name}
                        </span>
                        <span className="chip chip-accent" style={{ fontSize: '10px', padding: '1px 6px' }}>
                          Cat {att.category || 'A'}
                        </span>
                        {att.slotChangeCount > 0 ? (
                          <span className="chip chip-neutral" style={{ fontSize: '10px', padding: '1px 6px' }} title="Candidate has used their 1 allowed slot change">
                            Rescheduled (1/1)
                          </span>
                        ) : (
                          <span className="chip chip-neutral" style={{ fontSize: '10px', padding: '1px 6px', opacity: 0.75 }}>
                            0/1 Changes Used
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--color-secondary)', marginTop: '2px' }}>
                        {att.contact}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
                        Checked in at: {new Date(att.firstCheckedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })} • {att.device || 'Desktop'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    {att.isBooked && att.bookedSlot ? (
                      <div style={{ textAlign: 'right' }}>
                        <span className="chip chip-success">
                          Booked: {att.bookedSlot.timeLabel}
                        </span>
                        <div style={{ fontSize: '11px', color: 'var(--color-secondary)', marginTop: '4px' }}>
                          Confirmed Slot
                        </div>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'right' }}>
                        <span className="chip chip-neutral">
                          Viewing Schedule (Not Booked Yet)
                        </span>
                        <div style={{ fontSize: '11px', color: 'var(--color-secondary)', marginTop: '4px' }}>
                          Browsing slots
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--color-secondary)' }}>
              No candidates have checked in through this session link yet.
            </div>
          )}
        </div>
      ) : (
        /* Slots Management Grid & Time Stream */
        <div>
          {/* Category Tabs / Tracks Filter */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              backgroundColor: 'var(--color-surface-container)',
              padding: '12px 18px',
              borderRadius: 'var(--radius-lg)',
              marginBottom: '20px',
              border: '1px solid var(--color-outline-variant)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--color-secondary)', textTransform: 'uppercase', marginRight: '4px' }}>
                Category Tracks:
              </span>

              <button
                type="button"
                className={`chip ${selectedCategoryTab === 'all' ? 'chip-primary' : 'chip-neutral'}`}
                onClick={() => setSelectedCategoryTab('all')}
                style={{
                  cursor: 'pointer',
                  padding: '6px 12px',
                  fontSize: '12px',
                  backgroundColor: selectedCategoryTab === 'all' ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: selectedCategoryTab === 'all' ? '#ffffff' : 'var(--color-primary)',
                  border: '1px solid var(--color-outline-variant)'
                }}
              >
                All Categories ({session.totalSlots || session.slots.length} seats)
              </button>

              {(session.categories || ['Category A', 'Category B', 'Category C']).map((cat) => {
                const catSlots = session.categorySlots?.[cat] || [];
                const catBooked = catSlots.filter((s) => s.isBooked).length;
                const isSelected = selectedCategoryTab === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`chip ${isSelected ? 'chip-primary' : 'chip-neutral'}`}
                    onClick={() => setSelectedCategoryTab(cat)}
                    style={{
                      cursor: 'pointer',
                      padding: '6px 12px',
                      fontSize: '12px',
                      backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--color-surface)',
                      color: isSelected ? '#ffffff' : 'var(--color-primary)',
                      border: '1px solid var(--color-outline-variant)'
                    }}
                  >
                    <span>{cat}</span>
                    <span style={{ opacity: 0.85, fontSize: '11px', marginLeft: '4px' }}>
                      ({catBooked}/{catSlots.length || 0})
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleOpenManageCategories}
              style={{ fontSize: '12px', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>category</span>
              <span>Manage / + Add Category</span>
            </button>
          </div>

          {/* Header Controls with View Switcher */}
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
              <h3 className="headline-md" style={{ color: 'var(--color-primary)' }}>
                Session Time Slots {selectedCategoryTab !== 'all' ? `— ${selectedCategoryTab}` : ''}
              </h3>
              <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
                {selectedCategoryTab !== 'all'
                  ? `Showing 9:00 AM – 4:00 PM schedule for ${selectedCategoryTab} (${session.categorySlots?.[selectedCategoryTab]?.length || 0} seats).`
                  : `Manage all candidate tracks across ${session.categories?.length || 3} categories (${session.totalSlots || session.slots.length} total seats).`}
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

          {layoutMode === 'stream' ? (
            <div className="time-stream-wrapper">
              {/* Stream Toolbar with Period Jump & Scroll Controls */}
              <div className="time-stream-toolbar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className={`btn btn-sm ${filterPeriod === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setFilterPeriod('all')}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    All ({session.totalSlots})
                  </button>
                  <button
                    className={`btn btn-sm ${filterPeriod === 'available' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setFilterPeriod('available')}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Open ({session.availableCount !== undefined ? session.availableCount : (session.totalSlots - session.bookedCount - (session.blockedCount || 0))})
                  </button>
                  <button
                    className={`btn btn-sm ${filterPeriod === 'booked' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setFilterPeriod('booked')}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Booked ({session.bookedCount})
                  </button>
                  <button
                    className={`btn btn-sm ${filterPeriod === 'blocked' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setFilterPeriod('blocked')}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Unavailable ({session.blockedCount || 0})
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

                {/* Right: Scroll Up / Down Controls */}
                <div className="scroll-nav-group">
                  <span style={{ fontSize: '12px', color: 'var(--color-secondary)', marginRight: '4px' }}>
                    Scroll:
                  </span>
                  <button
                    className="scroll-btn"
                    onClick={() => handleScrollStream('up')}
                    title="Scroll Up"
                    aria-label="Scroll Up"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>keyboard_arrow_up</span>
                  </button>
                  <button
                    className="scroll-btn"
                    onClick={() => handleScrollStream('down')}
                    title="Scroll Down"
                    aria-label="Scroll Down"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>keyboard_arrow_down</span>
                  </button>
                </div>
              </div>

              {/* Scrollable Viewport */}
              <div className="time-stream-scroll-viewport" ref={scrollContainerRef}>
                {morningSlots.length > 0 && (
                  <div id="admin-timeline-period-morning" className="time-period-section">
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
                      {morningSlots.map(renderAdminStreamSlotRow)}
                    </div>
                  </div>
                )}

                {afternoonSlots.length > 0 && (
                  <div id="admin-timeline-period-afternoon" className="time-period-section">
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
                      {afternoonSlots.map(renderAdminStreamSlotRow)}
                    </div>
                  </div>
                )}

                {eveningSlots.length > 0 && (
                  <div id="admin-timeline-period-evening" className="time-period-section">
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
                      {eveningSlots.map(renderAdminStreamSlotRow)}
                    </div>
                  </div>
                )}

                {filteredSlots.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--color-secondary)' }}>
                    No slots match the selected filter.
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Grid View */
            <div>
              {/* Filter Tabs */}
              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px', marginBottom: '20px' }}>
                {[
                  { key: 'all', label: `All Slots (${session.totalSlots})` },
                  { key: 'available', label: `Open (${session.availableCount !== undefined ? session.availableCount : (session.totalSlots - session.bookedCount - (session.blockedCount || 0))})` },
                  { key: 'booked', label: `Booked (${session.bookedCount})` },
                  { key: 'blocked', label: `Unavailable (${session.blockedCount || 0})` },
                  { key: 'morning', label: 'Morning (<12 PM)' },
                  { key: 'afternoon', label: 'Afternoon (12–5 PM)' },
                  { key: 'evening', label: 'Evening (5 PM+)' }
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

              {/* Slots Grid */}
              <div className="slots-grid">
                {filteredSlots.map(renderAdminGridSlotCard)}
              </div>

              {filteredSlots.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--color-secondary)' }}>
                  No slots match the selected filter.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for Admin Slot Cancellation */}
      <ConfirmModal
        isOpen={Boolean(slotToCancel)}
        title="Cancel Candidate Booking"
        message={`Are you sure you want to cancel the booking for ${slotToCancel?.booking?.candidateName} at ${slotToCancel?.timeLabel}? The slot will immediately reopen for other candidates.`}
        confirmText="Yes, Cancel Booking"
        cancelText="Keep Booking"
        isDanger={true}
        onConfirm={handleConfirmCancelSlot}
        onCancel={() => setSlotToCancel(null)}
      />

      {/* Manage / Add Categories Modal */}
      {isManagingCategories && (
        <div className="modal-overlay" onClick={() => setIsManagingCategories(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '24px' }}>category</span>
                <h3 className="headline-md" style={{ color: 'var(--color-primary)' }}>
                  Manage Session Categories
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsManagingCategories(false)}
                style={{ color: 'var(--color-secondary)' }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <p className="body-sm" style={{ color: 'var(--color-secondary)', marginBottom: '16px' }}>
              Each category has its own independent full-day schedule seats ({session.startTime} – {session.endTime}). Add or remove categories below:
            </p>

            {/* Current Categories List */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
              {categoryEditList.map((cat) => (
                <span
                  key={cat}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: 'var(--color-secondary-container)',
                    color: 'var(--color-primary)',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '13px',
                    fontWeight: '700'
                  }}
                >
                  <span>{cat}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveCategoryFromEditList(cat)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-secondary)',
                      padding: '0 2px'
                    }}
                    title="Remove category"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>close</span>
                  </button>
                </span>
              ))}
            </div>

            {/* Add Category Form */}
            <form onSubmit={handleAddCategoryToEditList} style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Category D or Finance Track"
                value={newCatInput}
                onChange={(e) => setNewCatInput(e.target.value)}
                style={{ fontSize: '13px', flex: 1 }}
              />
              <button
                type="submit"
                className="btn btn-secondary btn-sm"
                style={{ whiteSpace: 'nowrap', padding: '0 14px' }}
              >
                + Add Track
              </button>
            </form>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsManagingCategories(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveCategories}
                disabled={categoryEditList.length === 0}
              >
                Save Categories
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Admin Slot Cancellation */}
      <ConfirmModal
        isOpen={Boolean(slotToCancel)}
        title="Cancel Candidate Booking"
        message={`Are you sure you want to cancel the booking for ${slotToCancel?.booking?.candidateName || 'this candidate'} at ${slotToCancel?.timeLabel}? This will immediately open the slot for other candidates.`}
        confirmText="Yes, Cancel Booking"
        cancelText="Keep Booking"
        isDanger={true}
        onConfirm={handleConfirmCancelSlot}
        onCancel={() => setSlotToCancel(null)}
      />

      {/* Modal for Editing Session Details */}
      <EditSessionModal
        isOpen={isEditingSessionModal}
        session={session}
        onClose={() => setIsEditingSessionModal(false)}
        onUpdated={(updated) => {
          setSession(updated);
          loadData();
          if (onShowToast) onShowToast('Session settings updated successfully!');
        }}
      />
    </div>
  );
}
