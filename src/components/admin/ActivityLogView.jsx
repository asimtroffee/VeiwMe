import React, { useState, useEffect, useMemo } from 'react';
import { getAllActivityEvents, subscribeToAdminSync } from '../../services/storage';
import { isFirebaseConfigured } from '../../services/firebase';

export default function ActivityLogView() {
  const [events, setEvents] = useState([]);
  const [filterType, setFilterType] = useState('all'); // all | check_ins | bookings | admin

  const loadEvents = () => {
    setEvents(getAllActivityEvents());
  };

  useEffect(() => {
    loadEvents();
    const unsubscribe = subscribeToAdminSync(() => {
      loadEvents();
    });
    return () => unsubscribe();
  }, []);

  const filteredEvents = useMemo(() => {
    if (filterType === 'all') return events;
    if (filterType === 'check_ins') return events.filter((e) => e.type === 'USER_CHECKED_IN');
    if (filterType === 'bookings') return events.filter((e) => e.type === 'SLOT_BOOKED' || e.type === 'SLOT_CANCELLED');
    if (filterType === 'admin') return events.filter((e) => e.type.startsWith('SESSION_') || e.type.startsWith('ADMIN_'));
    return events;
  }, [events, filterType]);

  const getEventBadge = (type) => {
    switch (type) {
      case 'USER_CHECKED_IN':
        return { label: 'Candidate Check-in', icon: 'login', bg: 'var(--color-secondary-container)', text: 'var(--color-primary)' };
      case 'SLOT_BOOKED':
        return { label: 'Slot Reserved', icon: 'check_circle', bg: 'var(--color-success-container)', text: 'var(--color-on-success-container)' };
      case 'SLOT_CANCELLED':
        return { label: 'Booking Cancelled', icon: 'cancel', bg: 'var(--color-error-container)', text: 'var(--color-on-error-container)' };
      case 'SESSION_CREATED':
        return { label: 'Session Created', icon: 'add_circle', bg: 'var(--color-primary-fixed)', text: 'var(--color-on-primary-fixed)' };
      case 'SESSION_DELETED':
        return { label: 'Session Deleted', icon: 'delete', bg: 'var(--color-error-container)', text: 'var(--color-on-error-container)' };
      case 'ADMIN_LOGIN':
        return { label: 'Admin Login', icon: 'lock_open', bg: 'var(--color-surface-container-high)', text: 'var(--color-primary)' };
      default:
        return { label: type, icon: 'info', bg: 'var(--color-surface-container)', text: 'var(--color-secondary)' };
    }
  };

  return (
    <div>
      {/* Header */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 className="headline-lg" style={{ color: 'var(--color-primary)' }}>
              Activity & Audit Trail
            </h2>
            <span className={`chip ${isFirebaseConfigured() ? 'chip-success' : 'chip-neutral'}`}>
              {isFirebaseConfigured() ? 'Cloud Synced (Firebase)' : 'Local Sync'}
            </span>
          </div>
          <p className="body-sm" style={{ color: 'var(--color-secondary)', marginTop: '4px' }}>
            Real-time event recording of candidate check-ins, reservations, cancellations, and system changes.
          </p>
        </div>

        {/* Filter Buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { key: 'all', label: `All Events (${events.length})` },
            { key: 'check_ins', label: 'Check-ins' },
            { key: 'bookings', label: 'Bookings' },
            { key: 'admin', label: 'Admin Actions' }
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilterType(tab.key)}
              className={`btn btn-sm ${filterType === tab.key ? 'btn-primary' : 'btn-secondary'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Events Timeline / Feed */}
      {filteredEvents.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredEvents.map((evt) => {
            const badge = getEventBadge(evt.type);
            const timeFormatted = new Date(evt.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              month: 'short',
              day: 'numeric'
            });

            return (
              <div
                key={evt.id}
                className="card"
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: badge.bg,
                      color: badge.text,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                      {badge.icon}
                    </span>
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: '700', fontSize: '14px', color: 'var(--color-primary)' }}>
                        {evt.actor}
                      </span>
                      <span className="chip" style={{ backgroundColor: badge.bg, color: badge.text, fontSize: '11px', padding: '2px 8px' }}>
                        {badge.label}
                      </span>
                      {evt.sessionTitle && (
                        <span style={{ fontSize: '12px', color: 'var(--color-secondary)' }}>
                          • {evt.sessionTitle}
                        </span>
                      )}
                    </div>
                    <p className="body-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
                      {evt.details}
                    </p>
                  </div>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0, fontSize: '12px', color: 'var(--color-secondary)' }}>
                  {timeFormatted}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--color-secondary)' }}>
          No activity recorded yet for the selected filter.
        </div>
      )}
    </div>
  );
}
