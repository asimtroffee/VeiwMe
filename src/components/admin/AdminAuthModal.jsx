import React, { useState, useEffect } from 'react';
import { verifyAdminPassword, getAdminLockoutStatus } from '../../services/storage';

export default function AdminAuthModal({ isOpen, onSuccess, onCancel }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [lockoutStatus, setLockoutStatus] = useState(getAdminLockoutStatus());

  useEffect(() => {
    if (!isOpen) return;
    setLockoutStatus(getAdminLockoutStatus());
    const interval = setInterval(() => {
      setLockoutStatus(getAdminLockoutStatus());
    }, 5000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMsg('');

    const res = verifyAdminPassword(password);
    if (res.success) {
      setPassword('');
      onSuccess();
    } else {
      setErrorMsg(res.error);
      setLockoutStatus(getAdminLockoutStatus());
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '440px' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              width: '54px',
              height: '54px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--color-secondary-container)',
              color: 'var(--color-primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px'
            }}
          >
            <span className="material-symbols-outlined fill" style={{ fontSize: '28px' }}>
              lock
            </span>
          </div>
          <h2 className="headline-md" style={{ color: 'var(--color-primary)', marginBottom: '8px' }}>
            Admin Access Required
          </h2>
          <p className="body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
            Enter the master administrator password to view and manage interview sessions.
          </p>
        </div>

        {lockoutStatus.isLocked ? (
          <div
            style={{
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-error-container)',
              color: 'var(--color-on-error-container)',
              textAlign: 'center',
              marginBottom: '20px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '6px' }}>
              <span className="material-symbols-outlined">timer</span>
              <strong className="label-md">Lockout Active</strong>
            </div>
            <p className="body-sm">
              Too many failed attempts. Locked out for approximately {lockoutStatus.minutesLeft} more minute(s).
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '18px' }}>
              <label className="input-label" htmlFor="admin-pass">
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="admin-pass"
                  type={showPassword ? 'text' : 'password'}
                  className="input-field"
                  placeholder="Enter admin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  required
                  style={{ paddingRight: '42px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--color-secondary)'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '6px',
                  fontSize: '12px',
                  color: 'var(--color-on-surface-variant)'
                }}
              >
                <span>Default: <code style={{ backgroundColor: 'var(--color-surface-container)', padding: '2px 4px', borderRadius: '4px' }}>admin</code></span>
                <span>{lockoutStatus.remainingAttempts} attempts remaining</span>
              </div>
            </div>

            {errorMsg && (
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
                <span>{errorMsg}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              {onCancel && (
                <button type="button" className="btn btn-secondary" onClick={onCancel} style={{ flex: 1 }}>
                  Cancel
                </button>
              )}
              <button type="submit" className="btn btn-primary" style={{ flex: 2 }}>
                Unlock Dashboard
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
