import React, { useState, useEffect, useMemo } from 'react';
import { getAllCandidates, getAllAttendees, cancelBooking, subscribeToSync } from '../../services/storage';
import { formatDateDisplay } from '../../services/timeUtils';
import ConfirmModal from '../common/ConfirmModal';

export default function CandidateDirectory({ onSelectSession, onShowToast }) {
  const [candidates, setCandidates] = useState([]);
  const [allAttendees, setAllAttendees] = useState([]);
  const [viewTab, setViewTab] = useState('bookings'); // 'bookings' | 'attendees'
  const [searchQuery, setSearchQuery] = useState('');
  const [candidateToCancel, setCandidateToCancel] = useState(null);

  const loadData = () => {
    setCandidates(getAllCandidates());
    setAllAttendees(getAllAttendees());
  };

  useEffect(() => {
    loadData();
    const unsubscribe = subscribeToSync(() => {
      loadData();
    });
    return () => unsubscribe();
  }, []);

  const handleConfirmCancel = () => {
    if (!candidateToCancel) return;
    const res = cancelBooking(candidateToCancel.sessionId, candidateToCancel.slotId);
    if (res.success) {
      onShowToast(`Cancelled booking for ${candidateToCancel.candidateName}`);
      loadData();
    }
    setCandidateToCancel(null);
  };

  const filteredCandidates = useMemo(() => {
    if (!searchQuery.trim()) return candidates;
    const q = searchQuery.toLowerCase();
    return candidates.filter(
      (c) =>
        c.candidateName.toLowerCase().includes(q) ||
        c.candidateContact.toLowerCase().includes(q) ||
        c.sessionTitle.toLowerCase().includes(q)
    );
  }, [candidates, searchQuery]);

  const filteredAttendees = useMemo(() => {
    if (!searchQuery.trim()) return allAttendees;
    const q = searchQuery.toLowerCase();
    return allAttendees.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.contact.toLowerCase().includes(q) ||
        (a.sessionTitle && a.sessionTitle.toLowerCase().includes(q))
    );
  }, [allAttendees, searchQuery]);

  const exportCSV = () => {
    if (viewTab === 'bookings') {
      const listToExport = filteredCandidates;
      if (listToExport.length === 0) {
        onShowToast('No bookings available to export.', 'error');
        return;
      }
      const headers = ['Session Title', 'Session Date', 'Time Slot', 'Candidate Name', 'Category', 'Email', 'Phone', 'Contact Info', 'Booked At'];
      const rows = listToExport.map((c) => [
        `"${(c.sessionTitle || '').replace(/"/g, '""')}"`,
        `"${c.sessionDate || ''}"`,
        `"${c.slotTimeLabel || ''}"`,
        `"${(c.candidateName || '').replace(/"/g, '""')}"`,
        `"${c.candidateCategory || 'A'}"`,
        `"${(c.candidateEmail || '').replace(/"/g, '""')}"`,
        `"${(c.candidatePhone || '').replace(/"/g, '""')}"`,
        `"${(c.candidateContact || '').replace(/"/g, '""')}"`,
        `"${c.bookedAt ? new Date(c.bookedAt).toLocaleString() : ''}"`
      ]);

      const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `all_candidate_bookings_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      onShowToast(`Exported ${listToExport.length} candidate booking(s) to CSV!`);
    } else {
      const listToExport = filteredAttendees;
      if (listToExport.length === 0) {
        onShowToast('No attendees available to export.', 'error');
        return;
      }
      const headers = ['Session Title', 'Session Date', 'Candidate Name', 'Category', 'Email', 'Phone', 'Contact Info', 'Status', 'Booked Slot', 'First Checked In', 'Last Seen', 'Device', 'Client Timezone'];
      const rows = listToExport.map((att) => [
        `"${(att.sessionTitle || '').replace(/"/g, '""')}"`,
        `"${att.sessionDate || ''}"`,
        `"${(att.name || '').replace(/"/g, '""')}"`,
        `"${att.category || 'A'}"`,
        `"${(att.email || '').replace(/"/g, '""')}"`,
        `"${(att.phone || '').replace(/"/g, '""')}"`,
        `"${(att.contact || '').replace(/"/g, '""')}"`,
        `"${att.isBooked ? 'Booked' : 'Checked In'}"`,
        `"${att.bookedSlot ? att.bookedSlot.timeLabel : (att.bookedSlotId ? 'Booked' : 'None')}"`,
        `"${att.firstCheckedInAt ? new Date(att.firstCheckedInAt).toLocaleString() : ''}"`,
        `"${att.lastSeenAt ? new Date(att.lastSeenAt).toLocaleString() : ''}"`,
        `"${att.device || 'Desktop'}"`,
        `"${att.clientTimezone || 'UTC'}"`
      ]);

      const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `all_checked_in_attendees_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      onShowToast(`Exported ${listToExport.length} attendee record(s) to CSV!`);
    }
  };

  return (
    <div>
      {/* Header & Search */}
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
            Candidate & Attendee Directory
          </h2>
          <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
            {candidates.length} confirmed bookings • {allAttendees.length} checked-in participants
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: '280px' }}>
            <span
              className="material-symbols-outlined"
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--color-secondary)',
                fontSize: '20px'
              }}
            >
              search
            </span>
            <input
              type="text"
              className="input-field"
              placeholder="Search candidate or session..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '40px' }}
            />
          </div>

          <button className="btn btn-secondary" onClick={exportCSV}>
            <span className="material-symbols-outlined">download</span>
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Directory Tab Switcher */}
      <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--color-outline-variant)', marginBottom: '24px' }}>
        <button
          onClick={() => setViewTab('bookings')}
          style={{
            padding: '10px 16px',
            borderBottom: viewTab === 'bookings' ? '2px solid var(--color-primary)' : '2px solid transparent',
            fontWeight: viewTab === 'bookings' ? '700' : '500',
            color: viewTab === 'bookings' ? 'var(--color-primary)' : 'var(--color-secondary)',
            fontSize: '15px'
          }}
        >
          Confirmed Bookings ({candidates.length})
        </button>
        <button
          onClick={() => setViewTab('attendees')}
          style={{
            padding: '10px 16px',
            borderBottom: viewTab === 'attendees' ? '2px solid var(--color-primary)' : '2px solid transparent',
            fontWeight: viewTab === 'attendees' ? '700' : '500',
            color: viewTab === 'attendees' ? 'var(--color-primary)' : 'var(--color-secondary)',
            fontSize: '15px'
          }}
        >
          All Checked-in Attendees ({allAttendees.length})
        </button>
      </div>

      {viewTab === 'bookings' ? (
        /* Confirmed Bookings List */
        filteredCandidates.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredCandidates.map((c) => (
              <div
                key={c.id}
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
                    {c.candidateName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: '700', fontSize: '16px', color: 'var(--color-primary)' }}>
                        {c.candidateName}
                      </span>
                      <span className="chip chip-accent" style={{ fontSize: '11px', padding: '1px 6px' }}>
                        Category {c.candidateCategory || 'A'}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-secondary)' }}>
                      {c.candidateEmail ? `${c.candidateEmail} ${c.candidatePhone ? `• ${c.candidatePhone}` : ''}` : c.candidateContact}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '20px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--color-primary)' }}>
                      {c.sessionTitle}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-secondary)' }}>
                      {formatDateDisplay(c.sessionDate)} • {c.slotTimeLabel}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => onSelectSession(c.sessionId)}
                    >
                      View Session
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setCandidateToCancel(c)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--color-secondary)' }}>
            {searchQuery ? 'No bookings matched your search criteria.' : 'No candidates have booked slots yet.'}
          </div>
        )
      ) : (
        /* All Checked-in Attendees List */
        filteredAttendees.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredAttendees.map((att) => (
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: '700', fontSize: '16px', color: 'var(--color-primary)' }}>
                        {att.name}
                      </span>
                      <span className="chip chip-accent" style={{ fontSize: '11px', padding: '1px 6px' }}>
                        Category {att.category || 'A'}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-secondary)' }}>
                      {att.email ? `${att.email} ${att.phone ? `• ${att.phone}` : ''}` : att.contact}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
                      First checked in: {new Date(att.firstCheckedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '20px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--color-primary)' }}>
                      {att.sessionTitle || 'Session'}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-secondary)' }}>
                      {formatDateDisplay(att.sessionDate)}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => onSelectSession(att.sessionId)}
                    >
                      View Session
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--color-secondary)' }}>
            {searchQuery ? 'No attendees matched your search criteria.' : 'No attendees have checked in through links yet.'}
          </div>
        )
      )}

      {/* Cancel Candidate Confirmation */}
      <ConfirmModal
        isOpen={Boolean(candidateToCancel)}
        title="Cancel Booking"
        message={`Are you sure you want to cancel the booking for ${candidateToCancel?.candidateName} on ${formatDateDisplay(candidateToCancel?.sessionDate)} at ${candidateToCancel?.slotTimeLabel}?`}
        confirmText="Yes, Cancel Booking"
        cancelText="Keep Booking"
        isDanger={true}
        onConfirm={handleConfirmCancel}
        onCancel={() => setCandidateToCancel(null)}
      />
    </div>
  );
}
