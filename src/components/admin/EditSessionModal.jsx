import React, { useState, useMemo, useEffect } from 'react';
import { updateSessionDetails } from '../../services/storage';
import { generateTimeSlots } from '../../services/timeUtils';

export default function EditSessionModal({ isOpen, session, onClose, onUpdated }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('16:00');
  const [slotDuration, setSlotDuration] = useState(15);
  const [timezone, setTimezone] = useState('MYT');
  const [description, setDescription] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!session || !isOpen) return;
    setTitle(session.title || '');
    setDate(session.date || '');
    setStartTime(session.startTime || '09:00');
    setEndTime(session.endTime || '16:00');
    setSlotDuration(session.slotDuration || 15);
    setTimezone(session.timezone || 'MYT');
    setDescription(session.description || '');
    setMeetingLink(session.meetingLink || '');
    setError('');
  }, [session, isOpen]);

  const previewSlots = useMemo(() => {
    return generateTimeSlots(startTime, endTime, Number(slotDuration));
  }, [startTime, endTime, slotDuration]);

  if (!isOpen || !session) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Please provide a session title.');
      return;
    }
    if (!date) {
      setError('Please select a date.');
      return;
    }
    if (previewSlots.length === 0) {
      setError(`End time must be at least ${slotDuration} minutes after start time.`);
      return;
    }

    setIsSaving(true);
    try {
      const res = updateSessionDetails(session.id, {
        title,
        date,
        startTime,
        endTime,
        slotDuration: Number(slotDuration),
        timezone,
        description,
        meetingLink
      });

      if (res.success) {
        if (onUpdated) onUpdated(res.session);
        onClose();
      } else {
        setError(res.error || 'Could not update session.');
      }
    } catch (err) {
      setError(err.message || 'Failed to save updates.');
    } finally {
      setIsSaving(false);
    }
  };

  const categoriesCount = session.categories ? session.categories.length : 1;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h2 className="headline-md" style={{ color: 'var(--color-primary)' }}>
              Edit Session Details
            </h2>
            <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
              Update schedule time window, timezone, or meeting links.
            </p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--color-secondary)' }}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label className="input-label" htmlFor="edit-sess-title">
              Session Title / Cohort Name *
            </label>
            <input
              id="edit-sess-title"
              type="text"
              className="input-field"
              placeholder="e.g. Score A Mission 2 Mock Q and A"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label className="input-label" htmlFor="edit-sess-date">
                Session Date *
              </label>
              <input
                id="edit-sess-date"
                type="date"
                className="input-field"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="input-label" htmlFor="edit-sess-tz">
                Timezone *
              </label>
              <select
                id="edit-sess-tz"
                className="input-field"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                <option value="MYT">MYT (Malaysia Time, UTC+8)</option>
                <option value="SGT">SGT (Singapore Time, UTC+8)</option>
                <option value="EST">EST (Eastern Standard Time)</option>
                <option value="CST">CST (Central Standard Time)</option>
                <option value="MST">MST (Mountain Standard Time)</option>
                <option value="PST">PST (Pacific Standard Time)</option>
                <option value="UTC">UTC (Universal Coordinated Time)</option>
                <option value="GMT">GMT (Greenwich Mean Time)</option>
                <option value="BST">BST (British Summer Time)</option>
                <option value="CET">CET (Central European Time)</option>
                <option value="IST">IST (India Standard Time)</option>
                <option value="JST">JST (Japan Standard Time, UTC+9)</option>
                <option value="AEST">AEST (Australian Eastern Time)</option>
              </select>
            </div>
          </div>

          {/* Time Window & Duration Settings */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label className="input-label" htmlFor="edit-sess-start">
                Start Time *
              </label>
              <input
                id="edit-sess-start"
                type="time"
                className="input-field"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="input-label" htmlFor="edit-sess-end">
                End Time *
              </label>
              <input
                id="edit-sess-end"
                type="time"
                className="input-field"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="input-label" htmlFor="edit-sess-duration">
                Slot Length *
              </label>
              <select
                id="edit-sess-duration"
                className="input-field"
                value={slotDuration}
                onChange={(e) => setSlotDuration(Number(e.target.value))}
              >
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={20}>20 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </div>
          </div>

          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-surface-container)',
              fontSize: '12px',
              color: 'var(--color-secondary)',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>info</span>
              <span>
                {previewSlots.length} slots per track × {categoriesCount} categories = <strong>{previewSlots.length * categoriesCount} total seats</strong> ({timezone})
              </span>
            </div>
          </div>

          {/* Zoom / Video Meeting Link */}
          <div style={{ marginBottom: '16px' }}>
            <label className="input-label" htmlFor="edit-sess-zoom" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#2D8CFF' }}>videocam</span>
              <span>Zoom / Video Meeting Link</span>
            </label>
            <input
              id="edit-sess-zoom"
              type="url"
              className="input-field"
              placeholder="e.g. https://zoom.us/j/123456789 or Google Meet / Teams link"
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label className="input-label" htmlFor="edit-sess-desc">
              Instructions or Notes for Candidates
            </label>
            <textarea
              id="edit-sess-desc"
              className="input-field"
              placeholder="Provide interview preparation notes, portfolio guidelines, or attendance instructions..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ resize: 'vertical' }}
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
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>save</span>
              <span>{isSaving ? 'Saving...' : 'Save Session Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
