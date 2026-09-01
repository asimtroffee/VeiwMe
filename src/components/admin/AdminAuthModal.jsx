import React, { useState } from 'react';
import { loginAdminWithFirebase } from '../../services/storage';

export default function AdminAuthModal({ isOpen, onSuccess, onCancel }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setIsSubmitting(true);

    try {
      const res = await loginAdminWithFirebase(email, password);
      if (res.success) {
        setPassword('');
        setEmail('');
        onSuccess();
      } else {
        setErrorMsg(res.error || 'Invalid administrator credentials.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Authentication error.');
    } finally {
      setIsSubmitting(false);
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
              admin_panel_settings
            </span>
          </div>
          <h2 className="headline-md" style={{ color: 'var(--color-primary)', marginBottom: '8px' }}>
            Coordinator Sign In
          </h2>
          <p className="body-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
            Sign in with your administrator account to access session controls and candidate records.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label className="input-label" htmlFor="admin-email">
              Admin Email
            </label>
            <input
              id="admin-email"
              type="email"
              className="input-field"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label className="input-label" htmlFor="admin-pass">
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="admin-pass"
                type={showPassword ? 'text' : 'password'}
                className="input-field"
                placeholder="Enter account password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              <button type="button" className="btn btn-secondary" onClick={onCancel} style={{ flex: 1 }} disabled={isSubmitting}>
                Cancel
              </button>
            )}
            <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={isSubmitting}>
              {isSubmitting ? 'Verifying...' : 'Sign In to Dashboard'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
