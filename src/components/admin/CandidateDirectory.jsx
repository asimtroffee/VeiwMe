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
      onShowToast(`Cancelled interview for ${candidateToCancel.candidateName}`);
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
                    <div style={{ fontWeight: '700', fontSize: '16px', color: 'var(--color-primary)' }}>
                      {c.candidateName}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-secondary)' }}>
                      {c.candidateContact}
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
            {searchQuery ? 'No bookings matched your search criteria.' : 'No candidates have booked interview slots yet.'}
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
                    <div style={{ fontWeight: '700', fontSize: '16px', color: 'var(--color-primary)' }}>
                      {att.name}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-secondary)' }}>
                      {att.contact}
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
        title="Cancel Interview"
        message={`Are you sure you want to cancel the interview for ${candidateToCancel?.candidateName} on ${formatDateDisplay(candidateToCancel?.sessionDate)} at ${candidateToCancel?.slotTimeLabel}?`}
        confirmText="Yes, Cancel Booking"
        cancelText="Keep Booking"
        isDanger={true}
        onConfirm={handleConfirmCancel}
        onCancel={() => setCandidateToCancel(null)}
      />
    </div>
  );
}
