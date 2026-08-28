import React, { useState, useEffect, useMemo } from 'react';
import { getSessionDetails, getSessionAttendees, cancelBooking, subscribeToSync } from '../../services/storage';
import { formatDateDisplay } from '../../services/timeUtils';
import ConfirmModal from '../common/ConfirmModal';

export default function SessionDetailView({ sessionId, onBack, onShowToast }) {
  const [session, setSession] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [activeTab, setActiveTab] = useState('slots'); // 'slots' | 'attendees'
  const [filterPeriod, setFilterPeriod] = useState('all'); // all | available | booked | morning | afternoon | evening
  const [slotToCancel, setSlotToCancel] = useState(null);

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

  const handleConfirmCancelSlot = () => {
    if (!slotToCancel) return;
    const res = cancelBooking(sessionId, slotToCancel.id);
    if (res.success) {
      onShowToast(`Cancelled booking for ${slotToCancel.booking?.candidateName || 'slot'}`);
      loadData();
    }
    setSlotToCancel(null);
  };

  const exportCSV = () => {
    if (!session || !session.slots) return;
    const headers = ['Slot Time', 'Status', 'Candidate Name', 'Candidate Contact', 'Booked At'];
    const rows = session.slots.map((slot) => [
      `"${slot.timeLabel}"`,
      slot.isBooked ? '"Booked"' : '"Available"',
      slot.isBooked ? `"${slot.booking.candidateName}"` : '""',
      slot.isBooked ? `"${slot.booking.candidateContact}"` : '""',
      slot.isBooked ? `"${new Date(slot.booking.bookedAt).toLocaleString()}"` : '""'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
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
    return session.slots.filter((slot) => {
      if (filterPeriod === 'available') return !slot.isBooked;
      if (filterPeriod === 'booked') return slot.isBooked;
      if (filterPeriod === 'morning') return slot.period === 'morning';
      if (filterPeriod === 'afternoon') return slot.period === 'afternoon';
      if (filterPeriod === 'evening') return slot.period === 'evening';
      return true;
    });
  }, [session, filterPeriod]);

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

        <div style={{ display: 'flex', gap: '10px' }}>
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
            <h1 className="headline-lg" style={{ color: 'var(--color-primary)', marginBottom: '8px' }}>
              {session.title}
            </h1>
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
            {session.description && (
              <p className="body-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '12px' }}>
                {session.description}
              </p>
            )}
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
                      <div style={{ fontWeight: '700', fontSize: '15px', color: 'var(--color-primary)' }}>
                        {att.name}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--color-secondary)' }}>
                        {att.contact}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
                        Checked in at: {new Date(att.firstCheckedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
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
        /* Slots Management Grid */
        <div>
          {/* Filter Tabs */}
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px', marginBottom: '20px' }}>
            {[
              { key: 'all', label: `All Slots (${session.totalSlots})` },
              { key: 'booked', label: `Booked (${session.bookedCount})` },
              { key: 'available', label: `Available (${session.totalSlots - session.bookedCount})` },
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

          {/* Slots List / Grid */}
          <div className="slots-grid">
            {filteredSlots.map((slot) => {
              return (
                <div
                  key={slot.id}
                  className={`slot-card ${slot.isBooked ? 'booked' : 'available'}`}
                  style={{ minHeight: '140px' }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span className="label-md" style={{ color: 'var(--color-primary)', fontWeight: '700' }}>
                        {slot.timeLabel}
                      </span>
                      <span className={`chip ${slot.isBooked ? 'chip-neutral' : 'chip-success'}`}>
                        {slot.isBooked ? 'Booked' : 'Open'}
                      </span>
                    </div>

                    {slot.isBooked ? (
                      <div style={{ marginTop: '8px' }}>
                        <div style={{ fontWeight: '600', color: 'var(--color-primary)', fontSize: '14px' }}>
                          {slot.booking.candidateName}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--color-secondary)', marginTop: '2px' }}>
                          {slot.booking.candidateContact}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                          Booked {new Date(slot.booking.bookedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '13px', color: 'var(--color-secondary)', marginTop: '12px' }}>
                        Available for booking
                      </div>
                    )}
                  </div>

                  {slot.isBooked && (
                    <div style={{ marginTop: '14px', borderTop: '1px solid var(--color-outline-variant)', paddingTop: '10px', textAlign: 'right' }}>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => setSlotToCancel(slot)}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>cancel</span>
                        Cancel Booking
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {filteredSlots.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--color-secondary)' }}>
              No slots match the selected filter.
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
    </div>
  );
}
