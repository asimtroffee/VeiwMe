import React, { useState, useEffect } from 'react';
import {
  isSessionAdminAuthenticated,
  getAllSessions,
  getSessionDetails,
  getParticipantProfile,
  subscribeToSync
} from './services/storage';
import AdminDashboard from './components/admin/AdminDashboard';
import AdminAuthModal from './components/admin/AdminAuthModal';
import ParticipantGate from './components/participant/ParticipantGate';
import ParticipantBoard from './components/participant/ParticipantBoard';
import Toast from './components/common/Toast';
import { formatDateDisplay } from './services/timeUtils';

export default function App() {
  const [currentHash, setCurrentHash] = useState(window.location.hash || '#/');
  const [isAdminAuth, setIsAdminAuth] = useState(isSessionAdminAuthenticated());
  const [showAdminAuthModal, setShowAdminAuthModal] = useState(false);
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const [participantProfiles, setParticipantProfiles] = useState({});

  // Sync hash routing
  useEffect(() => {
    const handleHashChange = () => {
      setCurrentHash(window.location.hash || '#/');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Listen to cross-tab updates
  useEffect(() => {
    const unsubscribe = subscribeToSync(() => {
      // triggers re-render
      setIsAdminAuth(isSessionAdminAuthenticated());
    });
    return () => unsubscribe();
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };

  // Parse current route
  const hash = currentHash.replace(/^#\/?/, '');
  const isSessionRoute = hash.startsWith('session/');
  const sessionId = isSessionRoute ? hash.split('/')[1] : null;
  const isAdminRoute = hash === 'admin' || hash.startsWith('admin/');

  // -------------------------------------------------------------
  // Render Route 1: Session Participant Route
  // -------------------------------------------------------------
  if (isSessionRoute && sessionId) {
    const session = getSessionDetails(sessionId);

    if (!session) {
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
          <div className="card" style={{ maxWidth: '440px', width: '100%', textAlign: 'center', padding: '40px 32px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'var(--color-error-container)',
                color: 'var(--color-on-error-container)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>
                event_busy
              </span>
            </div>
            <h2 className="headline-md" style={{ color: 'var(--color-primary)', marginBottom: '8px' }}>
              Session Not Found
            </h2>
            <p className="body-sm" style={{ color: 'var(--color-secondary)', marginBottom: '24px' }}>
              The interview session link you followed may have expired, been deleted, or is invalid.
            </p>
            <a href="#/" className="btn btn-primary" style={{ width: '100%' }}>
              Return to Home
            </a>
          </div>
          <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />
        </div>
      );
    }

    // Check if participant profile exists
    const currentProfile = participantProfiles[sessionId] || getParticipantProfile(sessionId);

    if (!currentProfile) {
      return (
        <div>
          <ParticipantGate
            session={session}
            onGatePassed={(profile) => {
              setParticipantProfiles((prev) => ({ ...prev, [sessionId]: profile }));
              showToast(`Welcome, ${profile.name}!`);
            }}
          />
          <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />
        </div>
      );
    }

    return (
      <div>
        <ParticipantBoard
          session={session}
          participantProfile={currentProfile}
          onSwitchProfile={() => {
            setParticipantProfiles((prev) => {
              const updated = { ...prev };
              delete updated[sessionId];
              return updated;
            });
          }}
          onShowToast={showToast}
        />
        <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render Route 2: Admin Dashboard Route
  // -------------------------------------------------------------
  if (isAdminRoute) {
    if (!isAdminAuth) {
      return (
        <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-background)' }}>
          <AdminAuthModal
            isOpen={true}
            onSuccess={() => {
              setIsAdminAuth(true);
              showToast('Admin console unlocked!');
            }}
            onCancel={() => {
              window.location.hash = '#/';
            }}
          />
          <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />
        </div>
      );
    }

    return (
      <div>
        <AdminDashboard
          onLogout={() => {
            setIsAdminAuth(false);
            showToast('Admin logged out successfully.');
          }}
          onShowToast={showToast}
        />
        <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render Route 3: Welcome / Showcase Landing
  // -------------------------------------------------------------
  const allSessions = getAllSessions();

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-background)', display: 'flex', flexDirection: 'column' }}>
      {/* Top Header */}
      <header
        style={{
          borderBottom: '1px solid var(--color-outline-variant)',
          backgroundColor: 'var(--color-surface)',
          padding: '16px 24px'
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined fill" style={{ fontSize: '26px', color: 'var(--color-primary)' }}>
              calendar_month
            </span>
            <span className="font-headline headline-md" style={{ color: 'var(--color-primary)', fontWeight: '800' }}>
              ViewMe
            </span>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <a href="#/admin" className="btn btn-primary">
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                admin_panel_settings
              </span>
              <span>Admin Console</span>
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main style={{ maxWidth: '960px', margin: '0 auto', padding: '60px 24px', flex: 1, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <span className="chip chip-accent" style={{ marginBottom: '16px', padding: '6px 14px' }}>
            v2: Sessions Architecture
          </span>
          <h1 className="display-lg" style={{ color: 'var(--color-primary)', marginBottom: '16px' }}>
            Real-Time Interview Scheduling
          </h1>
          <p className="body-lg" style={{ color: 'var(--color-secondary)', maxWidth: '640px', margin: '0 auto' }}>
            Self-contained session booking boards with unique links, upfront identity gates, and live conflict prevention.
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', marginTop: '28px' }}>
            <a href="#/admin" className="btn btn-primary btn-lg">
              <span className="material-symbols-outlined">dashboard</span>
              <span>Open Admin Dashboard</span>
            </a>
          </div>
        </div>

        {/* Live Active Sessions Section */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 className="headline-md" style={{ color: 'var(--color-primary)' }}>
              Active Demo Sessions
            </h2>
            <span className="label-md" style={{ color: 'var(--color-secondary)' }}>
              Click any link below to test participant booking
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {allSessions.map((s) => (
              <div
                key={s.id}
                className="card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                    <span className="chip chip-neutral">{s.timezone}</span>
                    <span className="chip chip-accent">{formatDateDisplay(s.date)}</span>
                  </div>
                  <h3 className="headline-sm" style={{ color: 'var(--color-primary)', marginBottom: '6px' }}>
                    {s.title}
                  </h3>
                  <div style={{ fontSize: '12px', color: 'var(--color-secondary)', marginBottom: '14px' }}>
                    {s.startTime} – {s.endTime} • {s.bookedCount} / {s.totalSlots} Booked
                  </div>
                </div>

                <a href={`#/session/${s.id}`} className="btn btn-secondary btn-sm" style={{ width: '100%' }}>
                  <span>Open Participant Board</span>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                    open_in_new
                  </span>
                </a>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--color-outline-variant)',
          padding: '20px 24px',
          textAlign: 'center',
          color: 'var(--color-secondary)',
          fontSize: '13px'
        }}
      >
        ViewMe v2 (Sessions) — Safe & Minimalist Interview Coordination Design System
      </footer>

      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />
    </div>
  );
}
