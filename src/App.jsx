import React, { useState, useEffect, Suspense, lazy } from 'react';
import {
  isSessionAdminAuthenticated,
  getAllSessions,
  getSessionDetails,
  fetchRemoteSession,
  getParticipantProfile,
  clearParticipantProfile,
  subscribeToSessionSync,
  subscribeToAdminSync,
  subscribeToSync
} from './services/storage';
import Toast from './components/common/Toast';
import { formatDateDisplay } from './services/timeUtils';

// Code-split components to reduce initial bundle size for candidates
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard'));
const AdminAuthModal = lazy(() => import('./components/admin/AdminAuthModal'));
const ParticipantGate = lazy(() => import('./components/participant/ParticipantGate'));
const ParticipantBoard = lazy(() => import('./components/participant/ParticipantBoard'));

function PageLoader({ text = 'Loading...' }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        backgroundColor: 'var(--color-background)',
        gap: '16px'
      }}
    >
      <div
        style={{
          width: '44px',
          height: '44px',
          border: '4px solid var(--color-surface-container-high)',
          borderTop: '4px solid var(--color-primary)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }}
      />
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <p className="body-md" style={{ color: 'var(--color-secondary)' }}>
        {text}
      </p>
    </div>
  );
}

export default function App() {
  const [currentHash, setCurrentHash] = useState(window.location.hash || '#/');
  const [isAdminAuth, setIsAdminAuth] = useState(isSessionAdminAuthenticated());
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const [participantProfiles, setParticipantProfiles] = useState({});
  const [currentSession, setCurrentSession] = useState(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [sessionFetchAttempted, setSessionFetchAttempted] = useState(false);

  // Sync hash routing
  useEffect(() => {
    const handleHashChange = () => {
      setCurrentHash(window.location.hash || '#/');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Parse current route
  const hash = currentHash.replace(/^#\/?/, '');
  const isSessionRoute = hash.startsWith('session/');
  const sessionId = isSessionRoute ? hash.split('/')[1] : null;
  const isAdminRoute = hash === 'admin' || hash.startsWith('admin/');

  // Fetch or sync session data whenever route changes or live sync fires
  const loadActiveSession = async (targetSessionId) => {
    if (!targetSessionId) return;

    // Check local store first
    const local = getSessionDetails(targetSessionId);
    if (local) {
      setCurrentSession(local);
    } else {
      setIsLoadingSession(true);
    }

    // Fetch remote Firestore data to ensure freshness on every device
    try {
      const remote = await fetchRemoteSession(targetSessionId);
      if (remote) {
        setCurrentSession(remote);
      }
    } catch (err) {
      console.warn('Error fetching remote session:', err);
    } finally {
      setIsLoadingSession(false);
      setSessionFetchAttempted(true);
    }
  };

  useEffect(() => {
    if (isSessionRoute && sessionId) {
      setSessionFetchAttempted(false);
      loadActiveSession(sessionId);
    } else {
      setCurrentSession(null);
      setIsLoadingSession(false);
      setSessionFetchAttempted(false);
    }
  }, [currentHash, isSessionRoute, sessionId]);

  // Scoped Firestore synchronization: only listen to relevant data based on active route
  useEffect(() => {
    let unsubscribe = () => {};

    if (isSessionRoute && sessionId) {
      // Listen ONLY to active session documents (saves ~90% Firestore read quotas)
      unsubscribe = subscribeToSessionSync(sessionId, () => {
        const fresh = getSessionDetails(sessionId);
        if (fresh) {
          setCurrentSession(fresh);
        }
      });
    } else if (isAdminRoute) {
      // Listen to admin-level session updates
      unsubscribe = subscribeToAdminSync(() => {
        setIsAdminAuth(isSessionAdminAuthenticated());
      });
    } else {
      // General broadcast sync
      unsubscribe = subscribeToSync(() => {
        setIsAdminAuth(isSessionAdminAuthenticated());
      });
    }

    return () => unsubscribe();
  }, [isSessionRoute, sessionId, isAdminRoute]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };

  // -------------------------------------------------------------
  // Render Route 1: Session Participant Route
  // -------------------------------------------------------------
  if (isSessionRoute && sessionId) {
    if (isLoadingSession && !currentSession) {
      return <PageLoader text="Connecting to interview session..." />;
    }

    if (!currentSession && sessionFetchAttempted) {
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

    if (!currentSession) {
      return null;
    }

    // Check if participant profile exists
    const currentProfile = participantProfiles[sessionId] || getParticipantProfile(sessionId);

    if (!currentProfile) {
      return (
        <Suspense fallback={<PageLoader text="Loading session check-in..." />}>
          <div>
            <ParticipantGate
              session={currentSession}
              onGatePassed={(profile) => {
                setParticipantProfiles((prev) => ({ ...prev, [sessionId]: profile }));
                showToast(`Welcome, ${profile.name}!`);
              }}
            />
            <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />
          </div>
        </Suspense>
      );
    }

    const handleUpdateParticipantProfile = (newProfile) => {
      setParticipantProfiles((prev) => ({
        ...prev,
        [sessionId]: newProfile
      }));
    };

    const handleResetParticipantProfile = () => {
      clearParticipantProfile(sessionId);
      setParticipantProfiles((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    };

    return (
      <Suspense fallback={<PageLoader text="Loading schedule board..." />}>
        <div>
          <ParticipantBoard
            session={currentSession}
            participantProfile={currentProfile}
            onUpdateProfile={handleUpdateParticipantProfile}
            onResetProfile={handleResetParticipantProfile}
            onShowToast={showToast}
          />
          <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />
        </div>
      </Suspense>
    );
  }

  // -------------------------------------------------------------
  // Render Route 2: Admin Dashboard Route
  // -------------------------------------------------------------
  if (isAdminRoute) {
    if (!isAdminAuth) {
      return (
        <Suspense fallback={<PageLoader text="Loading authentication..." />}>
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
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<PageLoader text="Loading admin console..." />}>
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
      </Suspense>
    );
  }

  // -------------------------------------------------------------
  // Render Route 3: Private Portal Notice (No Public Session Directory)
  // -------------------------------------------------------------
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
            <a href="#/admin" className="btn btn-secondary btn-sm">
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                lock
              </span>
              <span>Admin Console</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Notice Section */}
      <main style={{ maxWidth: '640px', margin: '0 auto', padding: '80px 24px', flex: 1, width: '100%', display: 'flex', alignItems: 'center' }}>
        <div className="card" style={{ width: '100%', textAlign: 'center', padding: '48px 32px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--color-secondary-container)',
              color: 'var(--color-primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '20px'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>
              mail_lock
            </span>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <span className="chip chip-neutral">Invitation-Only Access</span>
          </div>

          <h1 className="headline-lg" style={{ color: 'var(--color-primary)', marginBottom: '12px' }}>
            Private Scheduling Portal
          </h1>

          <p className="body-md" style={{ color: 'var(--color-secondary)', marginBottom: '28px', lineHeight: 1.6 }}>
            Sessions on ViewMe are private and confidential. To access your session booking board, 
            please open the direct link sent to your email address by the coordinator.
          </p>

          <div
            style={{
              padding: '16px 20px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-surface-container)',
              border: '1px solid var(--color-outline-variant)',
              textAlign: 'left',
              marginBottom: '28px',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--color-primary)', marginTop: '2px' }}>
              info
            </span>
            <div style={{ fontSize: '13px', color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
              <strong>Looking for your session?</strong>
              <br />
              Check your inbox for an email from your coordinator with the subject containing your session link.
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
            <a href="#/admin" className="btn btn-secondary">
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                admin_panel_settings
              </span>
              <span>Coordinator Sign In</span>
            </a>
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
        ViewMe — Confidential Scheduling Coordination System
      </footer>

      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />
    </div>
  );
}
