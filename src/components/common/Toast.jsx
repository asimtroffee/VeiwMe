import React, { useEffect } from 'react';

export default function Toast({ message, type = 'success', onClose, duration = 3500 }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onClose]);

  if (!message) return null;

  const isError = type === 'error';
  const isInfo = type === 'info';

  let bgClass = 'var(--color-primary)';
  let textClass = '#ffffff';
  let icon = 'check_circle';

  if (isError) {
    bgClass = 'var(--color-error)';
    textClass = '#ffffff';
    icon = 'error';
  } else if (isInfo) {
    bgClass = 'var(--color-primary-container)';
    textClass = '#ffffff';
    icon = 'info';
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '14px 20px',
        borderRadius: 'var(--radius-lg)',
        backgroundColor: bgClass,
        color: textClass,
        boxShadow: 'var(--shadow-lg)',
        fontSize: '14px',
        fontWeight: '500',
        animation: 'slideInRight 0.25s ease-out',
        maxWidth: '420px'
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{message}</span>
      <button
        onClick={onClose}
        style={{
          color: 'inherit',
          opacity: 0.8,
          display: 'flex',
          alignItems: 'center',
          padding: '2px'
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
          close
        </span>
      </button>
    </div>
  );
}
