import React, { useState, useEffect, useMemo } from 'react';
import { getAllSessions, deleteSession, logoutAdmin, subscribeToSync } from '../../services/storage';
import { formatDateDisplay, getRelativeDateBadge } from '../../services/timeUtils';
import CreateSessionModal from './CreateSessionModal';
import SessionDetailView from './SessionDetailView';
import CandidateDirectory from './CandidateDirectory';
import ActivityLogView from './ActivityLogView';
import ConfirmModal from '../common/ConfirmModal';

export default function AdminDashboard({ onLogout, onShowToast }) {
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState('sessions'); // 'sessions' | 'candidates'
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState(null);

  const loadSessions = () => {
    setSessions(getAllSessions());
  };

  useEffect(() => {
    loadSessions();
    const unsubscribe = subscribeToSync(() => {
      loadSessions();
    });
    return () => unsubscribe();
  }, []);

  const handleCopyLink = (sessionId) => {
    const url = `${window.location.origin}${window.location.pathname}#/session/${sessionId}`;
    navigator.clipboard.writeText(url);
    onShowToast('Unique participant link copied to clipboard!');
  };

  const handleConfirmDelete = () => {
    if (!sessionToDelete) return;
    deleteSession(sessionToDelete.id);
    onShowToast(`Session "${sessionToDelete.title}" deleted.`);
    setSessionToDelete(null);
    loadSessions();
  };

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q) || s.date.includes(q));
  }, [sessions, searchQuery]);

  // Total summary statistics
  const stats = useMemo(() => {
    let totalSlots = 0;
    let totalBooked = 0;
    sessions.forEach((s) => {
      totalSlots += s.totalSlots || 0;
      totalBooked += s.bookedCount || 0;
    });
    return {
      sessionCount: sessions.length,
      totalSlots,
      totalBooked,
      percentBooked: totalSlots > 0 ? Math.round((totalBooked / totalSlots) * 100) : 0
    };
  }, [sessions]);

  // If a session is selected for detailed management
  if (selectedSessionId) {
    return (
      <div className="app-container" style={{ padding: '32px 24px' }}>
        <SessionDetailView
          sessionId={selectedSessionId}
          onBack={() => {
            setSelectedSessionId(null);
            loadSessions();
          }}
          onShowToast={onShowToast}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--color-background)' }}>
      {/* Admin Sidebar */}
      <aside
        style={{
          width: '260px',
          backgroundColor: 'var(--color-surface-container-low)',
          borderRight: '1px solid var(--color-outline-variant)',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 16px',
          flexShrink: 0
        }}
      >
        {/* Brand */}
        <div style={{ marginBottom: '32px', paddingLeft: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined fill" style={{ fontSize: '26px', color: 'var(--color-primary)' }}>
              calendar_month
            </span>
            <span className="font-headline headline-md" style={{ color: 'var(--color-primary)', fontWeight: '800' }}>
              ViewMe
            </span>
          </div>
          <span className="label-sm" style={{ color: 'var(--color-secondary)', display: 'block', marginTop: '2px' }}>
            Admin Console
          </span>
        </div>

        {/* Navigation Items */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
          <button
            onClick={() => setActiveTab('sessions')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: activeTab === 'sessions' ? 'var(--color-surface-container-highest)' : 'transparent',
              color: activeTab === 'sessions' ? 'var(--color-primary)' : 'var(--color-secondary)',
              fontWeight: activeTab === 'sessions' ? '700' : '500',
              fontSize: '14px',
              textAlign: 'left',
              transition: 'background var(--transition-fast)'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
              event_note
            </span>
            <span>Sessions & Schedules</span>
          </button>

          <button
            onClick={() => setActiveTab('candidates')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: activeTab === 'candidates' ? 'var(--color-surface-container-highest)' : 'transparent',
              color: activeTab === 'candidates' ? 'var(--color-primary)' : 'var(--color-secondary)',
              fontWeight: activeTab === 'candidates' ? '700' : '500',
              fontSize: '14px',
              textAlign: 'left',
              transition: 'background var(--transition-fast)'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
              group
            </span>
            <span>Candidate Directory</span>
          </button>

          <button
            onClick={() => setActiveTab('activity')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: activeTab === 'activity' ? 'var(--color-surface-container-highest)' : 'transparent',
              color: activeTab === 'activity' ? 'var(--color-primary)' : 'var(--color-secondary)',
              fontWeight: activeTab === 'activity' ? '700' : '500',
              fontSize: '14px',
              textAlign: 'left',
              transition: 'background var(--transition-fast)'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
              history
            </span>
            <span>Activity Audit Log</span>
          </button>
        </nav>

        {/* Sidebar Footer CTA */}
        <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--color-outline-variant)' }}>
          <button
            className="btn btn-primary"
            onClick={() => setIsCreateModalOpen(true)}
            style={{ width: '100%', marginBottom: '12px' }}
          >
            <span className="material-symbols-outlined">add</span>
            <span>New Session</span>
          </button>

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              logoutAdmin();
              onLogout();
            }}
            style={{ width: '100%', color: 'var(--color-secondary)', justifyContent: 'flex-start' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
              logout
            </span>
            <span>Lock Admin Console</span>
          </button>
        </div>
      </aside>

      {/* Main Admin Content */}
      <main style={{ flex: 1, padding: '32px 36px', overflowY: 'auto' }}>
        {activeTab === 'candidates' ? (
          <CandidateDirectory
            onSelectSession={(sessId) => {
              setSelectedSessionId(sessId);
            }}
            onShowToast={onShowToast}
          />
        ) : activeTab === 'activity' ? (
          <ActivityLogView />
        ) : (
          <div>
            {/* Top Bar with Stats & Action */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '16px',
                marginBottom: '28px'
              }}
            >
              <div>
                <h1 className="headline-lg" style={{ color: 'var(--color-primary)' }}>
                  Sessions & Schedules
                </h1>
                <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
                  Create self-contained interview sessions and generate unique booking links.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ position: 'relative', width: '240px' }}>
                  <span
                    className="material-symbols-outlined"
                    style={{
                      position: 'absolute',
                      left: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-secondary)',
                      fontSize: '18px'
                    }}
                  >
                    search
                  </span>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Search sessions..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ paddingLeft: '36px', paddingY: '8px', fontSize: '13px' }}
                  />
                </div>

                <button className="btn btn-primary" onClick={() => setIsCreateModalOpen(true)}>
                  <span className="material-symbols-outlined">add</span>
                  <span>+ New Session</span>
                </button>
              </div>
            </div>

            {/* Quick Metrics Cards */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginBottom: '28px'
              }}
            >
              <div className="card" style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--color-secondary)', textTransform: 'uppercase' }}>
                  Total Sessions
                </div>
                <div className="headline-md" style={{ color: 'var(--color-primary)', marginTop: '4px' }}>
                  {stats.sessionCount}
                </div>
              </div>
              <div className="card" style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--color-secondary)', textTransform: 'uppercase' }}>
                  Total Available Slots
                </div>
                <div className="headline-md" style={{ color: 'var(--color-primary)', marginTop: '4px' }}>
                  {stats.totalSlots}
                </div>
              </div>
              <div className="card" style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--color-secondary)', textTransform: 'uppercase' }}>
                  Total Booked Candidates
                </div>
                <div className="headline-md" style={{ color: 'var(--color-primary)', marginTop: '4px' }}>
                  {stats.totalBooked} <span style={{ fontSize: '14px', color: 'var(--color-secondary)' }}>({stats.percentBooked}%)</span>
                </div>
              </div>
            </div>

            {/* Session Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px' }}>
              {filteredSessions.map((session) => {
                const dateBadge = getRelativeDateBadge(session.date);
                return (
                  <div
                    key={session.id}
                    className="card"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      transition: 'transform var(--transition-fast), box-shadow var(--transition-fast)',
                      position: 'relative'
                    }}
                  >
                    <div>
                      {/* Card Header & Badges */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <span className="chip chip-neutral">{session.timezone}</span>
                          {dateBadge && <span className="chip chip-accent">{dateBadge}</span>}
                        </div>
                        <button
                          onClick={() => setSessionToDelete(session)}
                          style={{ color: 'var(--color-secondary)', padding: '4px', borderRadius: '4px' }}
                          title="Delete Session"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                            delete
                          </span>
                        </button>
                      </div>

                      {/* Title & Timing */}
                      <h3
                        className="headline-md"
                        style={{
                          color: 'var(--color-primary)',
                          marginBottom: '8px',
                          cursor: 'pointer'
                        }}
                        onClick={() => setSelectedSessionId(session.id)}
                      >
                        {session.title}
                      </h3>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: 'var(--color-secondary)', fontSize: '13px', marginBottom: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>calendar_today</span>
                          <span>{formatDateDisplay(session.date)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>schedule</span>
                          <span>{session.startTime} – {session.endTime} ({session.slotDuration || 15}m slots)</span>
                        </div>
                      </div>

                      {/* Booking Progress Bar */}
                      <div style={{ marginBottom: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                          <span style={{ color: 'var(--color-primary)' }}>{session.bookedCount} / {session.totalSlots} Booked</span>
                          <span style={{ color: 'var(--color-secondary)' }}>{session.percentBooked}%</span>
                        </div>
                        <div
                          style={{
                            height: '6px',
                            backgroundColor: 'var(--color-surface-container)',
                            borderRadius: 'var(--radius-full)',
                            overflow: 'hidden'
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${session.percentBooked}%`,
                              backgroundColor: 'var(--color-primary-container)',
                              borderRadius: 'var(--radius-full)'
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--color-outline-variant)', paddingTop: '14px' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleCopyLink(session.id)}
                        style={{ flex: 1 }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>link</span>
                        <span>Copy Link</span>
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setSelectedSessionId(session.id)}
                        style={{ flex: 1 }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>visibility</span>
                        <span>Manage Slots</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredSessions.length === 0 && (
              <div className="card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--color-secondary)' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '48px', marginBottom: '12px', opacity: 0.5 }}>
                  event_busy
                </span>
                <p className="headline-sm" style={{ color: 'var(--color-primary)', marginBottom: '8px' }}>
                  No sessions found
                </p>
                <p className="body-sm" style={{ marginBottom: '20px' }}>
                  {searchQuery ? 'No sessions match your search query.' : 'Click "+ New Session" to create your first interview schedule.'}
                </p>
                <button className="btn btn-primary" onClick={() => setIsCreateModalOpen(true)}>
                  Create New Session
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Create Session Modal */}
      <CreateSessionModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={(newSession) => {
          loadSessions();
          onShowToast(`Session "${newSession.title}" created with ${newSession.startTime}–${newSession.endTime} slots!`);
        }}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(sessionToDelete)}
        title="Delete Interview Session?"
        message={
          sessionToDelete?.bookedCount > 0
            ? `Warning: "${sessionToDelete?.title}" has ${sessionToDelete?.bookedCount} active booking(s). Deleting this session will permanently cancel all associated bookings.`
            : `Are you sure you want to delete session "${sessionToDelete?.title}"? This action cannot be undone.`
        }
        confirmText="Delete Session"
        cancelText="Cancel"
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setSessionToDelete(null)}
      />
    </div>
  );
}
