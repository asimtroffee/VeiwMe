import React, { useState, useMemo } from 'react';
import { createNewSession } from '../../services/storage';
import { generateTimeSlots } from '../../services/timeUtils';

export default function CreateSessionModal({ isOpen, onClose, onCreated }) {
  // Default values
  const defaultDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }, []);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('13:00');
  const [slotDuration, setSlotDuration] = useState(15);
  const [timezone, setTimezone] = useState('EST');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const previewSlots = useMemo(() => {
    return generateTimeSlots(startTime, endTime, Number(slotDuration));
  }, [startTime, endTime, slotDuration]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Please provide a session name or cohort label.');
      return;
    }
    if (previewSlots.length === 0) {
      setError(`End time must be at least ${slotDuration} minutes after start time.`);
      return;
    }

    const session = createNewSession({
      title,
      date,
      startTime,
      endTime,
      slotDuration: Number(slotDuration),
      timezone,
      description
    });

    onCreated(session);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '540px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 className="headline-md" style={{ color: 'var(--color-primary)' }}>
            Create New Session
          </h2>
          <button onClick={onClose} style={{ color: 'var(--color-secondary)' }}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label className="input-label" htmlFor="sess-title">
              Session Name / Cohort Label *
            </label>
            <input
              id="sess-title"
              type="text"
              className="input-field"
              placeholder="e.g. Marketing Cohort — Interview Day"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
            <div>
              <label className="input-label" htmlFor="sess-date">
                Interview Date *
              </label>
              <input
                id="sess-date"
                type="date"
                className="input-field"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="input-label" htmlFor="sess-tz">
                Timezone
              </label>
              <select
                id="sess-tz"
                className="input-field"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                <option value="EST">EST (Eastern)</option>
                <option value="CST">CST (Central)</option>
                <option value="MST">MST (Mountain)</option>
                <option value="PST">PST (Pacific)</option>
                <option value="GMT">GMT / UTC</option>
                <option value="CET">CET (Central European)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label className="input-label" htmlFor="sess-start">
                Start Time *
              </label>
              <input
                id="sess-start"
                type="time"
                className="input-field"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="input-label" htmlFor="sess-end">
                End Time *
              </label>
              <input
                id="sess-end"
                type="time"
                className="input-field"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="input-label" htmlFor="sess-duration">
                Slot Length *
              </label>
              <select
                id="sess-duration"
                className="input-field"
                value={slotDuration}
                onChange={(e) => setSlotDuration(Number(e.target.value))}
              >
                <option value={10}>10 Mins</option>
                <option value={15}>15 Mins (Standard)</option>
                <option value={20}>20 Mins</option>
                <option value={30}>30 Mins</option>
                <option value={45}>45 Mins</option>
                <option value={60}>60 Mins (1 Hour)</option>
              </select>
            </div>
          </div>

          {/* Slot Generation Live Preview */}
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: previewSlots.length > 0 ? 'var(--color-secondary-container)' : 'var(--color-error-container)',
              color: previewSlots.length > 0 ? 'var(--color-primary)' : 'var(--color-on-error-container)',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
              {previewSlots.length > 0 ? 'auto_awesome' : 'warning'}
            </span>
            <div style={{ fontSize: '13px' }}>
              {previewSlots.length > 0 ? (
                <>
                  Generates <strong>{previewSlots.length} slots</strong> ({slotDuration} minutes each)
                  <div style={{ fontSize: '12px', color: 'var(--color-secondary)' }}>
                    From {previewSlots[0].startTime} to {previewSlots[previewSlots.length - 1].endTime}
                  </div>
                </>
              ) : (
                `End time must be at least ${slotDuration} minutes after start time.`
              )}
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label className="input-label" htmlFor="sess-desc">
              Instructions or Notes for Candidates (Optional)
            </label>
            <textarea
              id="sess-desc"
              className="input-field"
              rows={3}
              placeholder="e.g. Please be in a quiet room with video enabled. Have your portfolio ready."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-error-container)',
                color: 'var(--color-on-error-container)',
                fontSize: '13px',
                marginBottom: '16px'
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={previewSlots.length === 0}>
              Create Session & Generate Link
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
