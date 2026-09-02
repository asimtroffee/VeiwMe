import React, { useState, useMemo, useEffect } from 'react';
import { updateSessionDetails, normalizeSessionDays } from '../../services/storage';
import { generateTimeSlots } from '../../services/timeUtils';

export default function EditSessionModal({ isOpen, session, onClose, onUpdated }) {
  const [eventType, setEventType] = useState('single');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('16:00');
  const [slotDuration, setSlotDuration] = useState(15);
  const [timezone, setTimezone] = useState('MYT');
  const [description, setDescription] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [days, setDays] = useState([]);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!session || !isOpen) return;
    const sessionDays = normalizeSessionDays(session);
    const type = session.eventType || (sessionDays.length > 1 ? 'multi' : 'single');

    setEventType(type);
    setTitle(session.title || '');
    setDate(session.date || (sessionDays[0] && sessionDays[0].date) || '');
    setStartTime(session.startTime || (sessionDays[0] && sessionDays[0].startTime) || '09:00');
    setEndTime(session.endTime || (sessionDays[0] && sessionDays[0].endTime) || '16:00');
    setSlotDuration(session.slotDuration || 15);
    setTimezone(session.timezone || 'MYT');
    setDescription(session.description || '');
    setMeetingLink(session.meetingLink || '');
    setDays(sessionDays);
    setError('');
  }, [session, isOpen]);

  const handleAddDay = () => {
    setDays((prev) => {
      let nextDate = '';
      if (prev.length > 0) {
        const lastDate = prev[prev.length - 1].date;
        if (lastDate) {
          const [y, m, d] = lastDate.split('-').map(Number);
          const next = new Date(y, m - 1, d + 1);
          nextDate = next.toISOString().split('T')[0];
        }
      }
      if (!nextDate) {
        const d = new Date();
        d.setDate(d.getDate() + prev.length + 1);
        nextDate = d.toISOString().split('T')[0];
      }

      const defaultStart = prev.length > 0 ? prev[prev.length - 1].startTime : startTime;
      const defaultEnd = prev.length > 0 ? prev[prev.length - 1].endTime : endTime;
      const nextIdx = prev.length + 1;

      return [
        ...prev,
        {
          id: `day_${nextIdx}`,
          date: nextDate,
          label: `Day ${nextIdx}`,
          startTime: defaultStart,
          endTime: defaultEnd
        }
      ];
    });
    setError('');
  };

  const handleRemoveDay = (dayId) => {
    if (days.length <= 1) {
      setError('A multi-day event must have at least 1 day.');
      return;
    }
    setDays((prev) => {
      const filtered = prev.filter((d) => d.id !== dayId);
      return filtered.map((d, idx) => ({
        ...d,
        id: `day_${idx + 1}`,
        label: `Day ${idx + 1}`
      }));
    });
    setError('');
  };

  const handleUpdateDay = (dayId, field, value) => {
    setDays((prev) =>
      prev.map((d) => (d.id === dayId ? { ...d, [field]: value } : d))
    );
  };

  const handleApplyHoursToAllDays = (sourceStart, sourceEnd) => {
    setDays((prev) =>
      prev.map((d) => ({
        ...d,
        startTime: sourceStart,
        endTime: sourceEnd
      }))
    );
  };

  // Calculate preview slots
  const previewInfo = useMemo(() => {
    const dur = Number(slotDuration) || 15;
    const categoriesCount = session?.categories ? session.categories.length : 1;

    if (eventType === 'single') {
      const slots = generateTimeSlots(startTime, endTime, dur);
      return {
        totalDays: 1,
        slotsPerCategory: slots.length,
        totalSeats: slots.length * categoriesCount,
        hasInvalidTimes: slots.length === 0
      };
    } else {
      let totalSlotsAcrossDays = 0;
      let hasInvalidTimes = false;

      days.forEach((day) => {
        const slots = generateTimeSlots(day.startTime, day.endTime, dur);
        if (slots.length === 0) hasInvalidTimes = true;
        totalSlotsAcrossDays += slots.length;
      });

      return {
        totalDays: days.length,
        slotsPerCategory: totalSlotsAcrossDays,
        totalSeats: totalSlotsAcrossDays * categoriesCount,
        hasInvalidTimes: hasInvalidTimes || days.length === 0
      };
    }
  }, [eventType, startTime, endTime, slotDuration, session, days]);

  if (!isOpen || !session) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Please provide an event title.');
      return;
    }

    if (eventType === 'single') {
      if (!date) {
        setError('Please select a date.');
        return;
      }
      if (previewInfo.slotsPerCategory === 0) {
        setError(`End time must be at least ${slotDuration} minutes after start time.`);
        return;
      }
    } else {
      if (days.length === 0) {
        setError('Please add at least one day.');
        return;
      }
      for (let i = 0; i < days.length; i++) {
        if (!days[i].date) {
          setError(`Please select a date for Day ${i + 1}.`);
          return;
        }
        const daySlots = generateTimeSlots(days[i].startTime, days[i].endTime, Number(slotDuration));
        if (daySlots.length === 0) {
          setError(`Day ${i + 1} (${days[i].date}): End time must be at least ${slotDuration} minutes after start time.`);
          return;
        }
      }
    }

    setIsSaving(true);
    try {
      const res = await updateSessionDetails(session.id, {
        title,
        eventType,
        date: eventType === 'single' ? date : days[0]?.date,
        days: eventType === 'multi' ? days : null,
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
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h2 className="headline-md" style={{ color: 'var(--color-primary)' }}>
              Edit Event Details
            </h2>
            <p className="body-sm" style={{ color: 'var(--color-secondary)' }}>
              Update schedule dates, time windows, timezone, or meeting links.
            </p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--color-secondary)' }}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Event Type Toggle */}
          <div style={{ marginBottom: '16px' }}>
            <label className="input-label" style={{ marginBottom: '8px' }}>
              Event Type *
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                padding: '4px',
                backgroundColor: 'var(--color-surface-container)',
                borderRadius: 'var(--radius-md)'
              }}
            >
              <button
                type="button"
                onClick={() => setEventType('single')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: eventType === 'single' ? 'var(--color-surface)' : 'transparent',
                  color: eventType === 'single' ? 'var(--color-primary)' : 'var(--color-secondary)',
                  fontWeight: eventType === 'single' ? '700' : '500',
                  boxShadow: eventType === 'single' ? 'var(--shadow-sm)' : 'none',
                  border: eventType === 'single' ? '1px solid var(--color-outline-variant)' : '1px solid transparent'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>event</span>
                <span>Single Day</span>
              </button>

              <button
                type="button"
                onClick={() => setEventType('multi')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: eventType === 'multi' ? 'var(--color-surface)' : 'transparent',
                  color: eventType === 'multi' ? 'var(--color-primary)' : 'var(--color-secondary)',
                  fontWeight: eventType === 'multi' ? '700' : '500',
                  boxShadow: eventType === 'multi' ? 'var(--shadow-sm)' : 'none',
                  border: eventType === 'multi' ? '1px solid var(--color-outline-variant)' : '1px solid transparent'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>date_range</span>
                <span>Multi-Day Event</span>
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label className="input-label" htmlFor="edit-sess-title">
              Event Title / Cohort Name *
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

          {/* Mode 1: Single Day */}
          {eventType === 'single' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
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
            </div>
          ) : (
            /* Mode 2: Multi-Day */
            <div style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label className="input-label" style={{ margin: 0 }}>
                  Event Days ({days.length}) *
                </label>
                {days.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleApplyHoursToAllDays(days[0].startTime, days[0].endTime)}
                    style={{ fontSize: '11px', padding: '2px 6px', color: 'var(--color-primary)' }}
                  >
                    Apply Day 1 hours to all
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
                {days.map((day, index) => (
                  <div
                    key={day.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--color-surface-container)',
                      border: '1px solid var(--color-outline-variant)',
                      display: 'grid',
                      gridTemplateColumns: 'auto 1.3fr 1fr 1fr auto',
                      gap: '8px',
                      alignItems: 'center'
                    }}
                  >
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: '700',
                        color: 'var(--color-primary)',
                        backgroundColor: 'var(--color-surface)',
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Day {index + 1}
                    </span>

                    <div>
                      <input
                        type="date"
                        className="input-field"
                        style={{ padding: '6px 8px', fontSize: '12px' }}
                        value={day.date}
                        onChange={(e) => handleUpdateDay(day.id, 'date', e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <input
                        type="time"
                        className="input-field"
                        style={{ padding: '6px 8px', fontSize: '12px' }}
                        value={day.startTime}
                        onChange={(e) => handleUpdateDay(day.id, 'startTime', e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <input
                        type="time"
                        className="input-field"
                        style={{ padding: '6px 8px', fontSize: '12px' }}
                        value={day.endTime}
                        onChange={(e) => handleUpdateDay(day.id, 'endTime', e.target.value)}
                        required
                      />
                    </div>

                    {days.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveDay(day.id)}
                        style={{
                          color: 'var(--color-secondary)',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        title={`Remove Day ${index + 1}`}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
                      </button>
                    ) : (
                      <div style={{ width: '26px' }} />
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleAddDay}
                style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
                <span>Add Another Day</span>
              </button>
            </div>
          )}

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
                {eventType === 'multi' ? (
                  <>
                    <strong>{previewInfo.totalDays} Days</strong> • {previewInfo.slotsPerCategory} slots per track × {categoriesCount} categories = <strong>{previewInfo.totalSeats} total seats</strong> ({timezone})
                  </>
                ) : (
                  <>
                    {previewInfo.slotsPerCategory} slots per track × {categoriesCount} categories = <strong>{previewInfo.totalSeats} total seats</strong> ({timezone})
                  </>
                )}
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
            <button type="submit" className="btn btn-primary" disabled={isSaving || previewInfo.hasInvalidTimes || previewInfo.totalSeats === 0}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>save</span>
              <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
