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
  const [endTime, setEndTime] = useState('16:00');
  const [slotDuration, setSlotDuration] = useState(15);
  const [timezone, setTimezone] = useState('EST');
  const [description, setDescription] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [categories, setCategories] = useState(['Category A', 'Category B', 'Category C']);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [error, setError] = useState('');

  const previewSlots = useMemo(() => {
    return generateTimeSlots(startTime, endTime, Number(slotDuration));
  }, [startTime, endTime, slotDuration]);

  if (!isOpen) return null;

  const handleAddCategory = (e) => {
    if (e) e.preventDefault();
    const clean = newCategoryInput.trim();
    if (!clean) return;
    if (categories.some((c) => c.toLowerCase() === clean.toLowerCase())) {
      setError(`Category "${clean}" already exists.`);
      return;
    }
    setCategories([...categories, clean]);
    setNewCategoryInput('');
    setError('');
  };

  const handleRemoveCategory = (catToRemove) => {
    if (categories.length <= 1) {
      setError('A session must have at least 1 category.');
      return;
    }
    setCategories(categories.filter((c) => c !== catToRemove));
    setError('');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Please provide a session name or cohort label.');
      return;
    }
    if (categories.length === 0) {
      setError('Please add at least one category.');
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
      description,
      meetingLink,
      categories
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
              placeholder="e.g. Q&A 15 min"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
            <div>
              <label className="input-label" htmlFor="sess-date">
                Session Date *
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
                Timezone *
              </label>
              <select
                id="sess-tz"
                className="input-field"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                <option value="EST">EST (Eastern Standard Time)</option>
                <option value="CST">CST (Central Standard Time)</option>
                <option value="MST">MST (Mountain Standard Time)</option>
                <option value="PST">PST (Pacific Standard Time)</option>
                <option value="UTC">UTC (Universal Coordinated Time)</option>
                <option value="GMT">GMT (Greenwich Mean Time)</option>
                <option value="BST">BST (British Summer Time)</option>
                <option value="CET">CET (Central European Time)</option>
                <option value="IST">IST (India Standard Time)</option>
                <option value="SGT">SGT (Singapore Time)</option>
                <option value="AEST">AEST (Australian Eastern Time)</option>
              </select>
            </div>
          </div>

          {/* Time Window & Duration Settings */}
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
              <label className="input-label" htmlFor="sess-dur">
                Slot Length *
              </label>
              <select
                id="sess-dur"
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

          {/* Category Configuration & Management */}
          <div style={{ marginBottom: '16px' }}>
            <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Categories / Tracks ({categories.length}) *</span>
              <span style={{ fontSize: '11px', color: 'var(--color-secondary)' }}>Each category receives a full 9am–4pm schedule</span>
            </label>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
              {categories.map((cat) => (
                <span
                  key={cat}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: 'var(--color-secondary-container)',
                    color: 'var(--color-primary)',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}
                >
                  <span>{cat}</span>
                  {categories.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveCategory(cat)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-secondary)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: 0
                      }}
                      title={`Remove ${cat}`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                    </button>
                  )}
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="input-field"
                placeholder="Add new category (e.g. Category D or Leadership)"
                value={newCategoryInput}
                onChange={(e) => setNewCategoryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCategory();
                  }
                }}
                style={{ fontSize: '13px' }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleAddCategory}
                style={{ whiteSpace: 'nowrap' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
                <span>Add Track</span>
              </button>
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
                {previewSlots.length} slots per track × {categories.length} categories = <strong>{previewSlots.length * categories.length} total seats</strong>
              </span>
            </div>
          </div>

          {/* Zoom / Video Meeting Link */}
          <div style={{ marginBottom: '16px' }}>
            <label className="input-label" htmlFor="sess-zoom" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#2D8CFF' }}>videocam</span>
              <span>Zoom / Video Meeting Link (Optional)</span>
            </label>
            <input
              id="sess-zoom"
              type="url"
              className="input-field"
              placeholder="e.g. https://zoom.us/j/123456789 or Google Meet / Teams link"
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
            />
            <div style={{ fontSize: '11px', color: 'var(--color-secondary)', marginTop: '4px' }}>
              Candidates will receive this link upon booking to join the session.
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label className="input-label" htmlFor="sess-desc">
              Instructions or Notes for Candidates (Optional)
            </label>
            <textarea
              id="sess-desc"
              className="input-field"
              rows={2}
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
