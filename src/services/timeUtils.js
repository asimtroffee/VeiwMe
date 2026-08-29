/**
 * Helper to convert "HH:MM" (24h) to minutes from midnight
 */
export function timeToMinutes(time24) {
  if (!time24) return 0;
  const [hours, minutes] = time24.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Helper to convert minutes from midnight to "h:mm A" (12h format)
 */
export function minutesTo12Hour(minutes) {
  const totalMinutes = Math.floor(minutes);
  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const mins = totalMinutes % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minsPadded = mins.toString().padStart(2, '0');
  return `${hours12}:${minsPadded} ${period}`;
}

/**
 * Determine period for slot grouping
 */
export function getSlotPeriod(startMinutes) {
  if (startMinutes < 720) return 'morning'; // before 12:00 PM
  if (startMinutes < 1020) return 'afternoon'; // 12:00 PM to 5:00 PM
  return 'evening'; // 5:00 PM onwards
}

/**
 * Generate 15-minute slot definitions between start and end time
 */
export function generateTimeSlots(startTime24, endTime24, slotDurationMinutes = 15) {
  const startMins = timeToMinutes(startTime24);
  const endMins = timeToMinutes(endTime24);

  if (endMins <= startMins) {
    return [];
  }

  const slots = [];
  let currentMins = startMins;

  while (currentMins + slotDurationMinutes <= endMins) {
    const nextMins = currentMins + slotDurationMinutes;
    const startFormatted = minutesTo12Hour(currentMins);
    const endFormatted = minutesTo12Hour(nextMins);
    const period = getSlotPeriod(currentMins);

    slots.push({
      id: `slot_${currentMins}_${nextMins}`,
      startTime: startFormatted,
      endTime: endFormatted,
      startMinutes: currentMins,
      endMinutes: nextMins,
      timeLabel: `${startFormatted} – ${endFormatted}`,
      period: period
    });

    currentMins = nextMins;
  }

  return slots;
}

/**
 * Format date string (YYYY-MM-DD) into user-friendly format
 */
export function formatDateDisplay(dateString) {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) return dateString;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Format relative date tag (e.g. "Today", "Tomorrow", or "in 3 days")
 */
export function getRelativeDateBadge(dateString) {
  if (!dateString) return null;
  const [year, month, day] = dateString.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const now = new Date();
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);

  const diffDays = Math.round((target - now) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays < -1) return 'Past';
  return `in ${diffDays} days`;
}

/**
 * Generate a short, friendly unique session ID (e.g., "8f2a1c")
 */
export function generateSessionId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Extract start minutes from slot object or slot ID (e.g. "slot_540_555" -> 540)
 */
export function extractSlotStartMinutes(slot) {
  if (!slot) return 0;
  if (typeof slot === 'object') {
    if (typeof slot.startMinutes === 'number') return slot.startMinutes;
    if (slot.id && typeof slot.id === 'string' && slot.id.startsWith('slot_')) {
      const parts = slot.id.split('_');
      if (parts.length >= 2 && !isNaN(Number(parts[1]))) {
        return Number(parts[1]);
      }
    }
    if (slot.startTime) return timeToMinutes(slot.startTime);
  } else if (typeof slot === 'string') {
    if (slot.startsWith('slot_')) {
      const parts = slot.split('_');
      if (parts.length >= 2 && !isNaN(Number(parts[1]))) {
        return Number(parts[1]);
      }
    }
    return timeToMinutes(slot);
  }
  return 0;
}

/**
 * Construct exact Date object for a scheduled slot start
 */
export function getSlotStartDateTime(sessionDate, slot) {
  if (!sessionDate) return null;
  const [year, month, day] = sessionDate.split('-').map(Number);
  if (!year || !month || !day) return null;

  const startMins = extractSlotStartMinutes(slot);
  const hours = Math.floor(startMins / 60);
  const mins = startMins % 60;

  return new Date(year, month - 1, day, hours, mins, 0, 0);
}

/**
 * Calculate hours remaining until the scheduled slot start
 */
export function getHoursUntilSlot(sessionDate, slot) {
  const slotDate = getSlotStartDateTime(sessionDate, slot);
  if (!slotDate) return 0;
  const diffMs = slotDate.getTime() - Date.now();
  return diffMs / (1000 * 60 * 60);
}

/**
 * Check if the meeting is within the 3-hour cutoff limit (or already started)
 */
export function isSlotWithinCutoff(sessionDate, slot, cutoffHours = 3) {
  const hours = getHoursUntilSlot(sessionDate, slot);
  return hours < cutoffHours;
}

/**
 * Format remaining hours into friendly string like "4h 25m" or "25 min"
 */
export function formatTimeUntilMeeting(sessionDate, slot) {
  const hours = getHoursUntilSlot(sessionDate, slot);
  if (hours <= 0) return 'Meeting time has passed';
  const totalMins = Math.round(hours * 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) {
    return `${h}h ${m > 0 ? `${m}m` : ''} remaining`;
  }
  return `${m} minute${m === 1 ? '' : 's'} remaining`;
}

/**
 * Extract end minutes from slot object or slot ID (e.g. "slot_540_555" -> 555)
 */
export function extractSlotEndMinutes(slot, durationMinutes = 15) {
  if (!slot) return 0;
  if (typeof slot === 'object') {
    if (typeof slot.endMinutes === 'number') return slot.endMinutes;
    if (slot.id && typeof slot.id === 'string' && slot.id.startsWith('slot_')) {
      const parts = slot.id.split('_');
      if (parts.length >= 3 && !isNaN(Number(parts[2]))) {
        return Number(parts[2]);
      }
    }
    if (slot.endTime) return timeToMinutes(slot.endTime);
    if (typeof slot.startMinutes === 'number') return slot.startMinutes + durationMinutes;
  } else if (typeof slot === 'string') {
    if (slot.startsWith('slot_')) {
      const parts = slot.split('_');
      if (parts.length >= 3 && !isNaN(Number(parts[2]))) {
        return Number(parts[2]);
      }
    }
    return timeToMinutes(slot) + durationMinutes;
  }
  return 0;
}

/**
 * Construct exact Date object for a scheduled slot end
 */
export function getSlotEndDateTime(sessionDate, slot, durationMinutes = 15) {
  if (!sessionDate) return null;
  const [year, month, day] = sessionDate.split('-').map(Number);
  if (!year || !month || !day) return null;

  const endMins = extractSlotEndMinutes(slot, durationMinutes);
  const hours = Math.floor(endMins / 60);
  const mins = endMins % 60;

  return new Date(year, month - 1, day, hours, mins, 0, 0);
}

/**
 * Format a Date object into Google Calendar ISO UTC string: YYYYMMDDTHHmmssZ
 */
function toGCalUtcString(date) {
  if (!date) return '';
  return date.toISOString().replace(/-|:|\.\d\d\d/g, '');
}

/**
 * Build Google Calendar Web Template URL to directly add the event
 */
export function generateGoogleCalendarUrl({ session, slot, candidateProfile, booking }) {
  if (!session || !slot) return '';

  const startDate = getSlotStartDateTime(session.date, slot);
  const endDate = getSlotEndDateTime(session.date, slot, session.slotDuration || 15);

  if (!startDate || !endDate) return '';

  const startUtc = toGCalUtcString(startDate);
  const endUtc = toGCalUtcString(endDate);

  const title = `Interview: ${session.title || 'Scheduled Interview'}`;
  const candidateName = candidateProfile?.name || booking?.candidateName || 'Candidate';
  const category = candidateProfile?.category || booking?.candidateCategory || 'A';
  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

  const descriptionLines = [
    `Interview Session: ${session.title}`,
    `Date: ${formatDateDisplay(session.date)}`,
    `Time: ${slot.timeLabel} (${session.timezone || 'Local Time'})`,
    `Candidate: ${candidateName} (Category ${category})`,
    session.description ? `\nInstructions:\n${session.description}` : '',
    `\nView & Manage Interview: ${currentUrl}`
  ].filter(Boolean);

  const description = descriptionLines.join('\n');
  const location = 'Online Video Call (Link sent prior to meeting)';

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${startUtc}/${endUtc}`,
    details: description,
    location: location
  });

  if (candidateProfile?.email || booking?.candidateEmail) {
    params.append('add', (candidateProfile?.email || booking?.candidateEmail).trim());
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Directly trigger open Google Calendar in new tab
 */
export function openGoogleCalendarDirectly({ session, slot, candidateProfile, booking }) {
  try {
    const url = generateGoogleCalendarUrl({ session, slot, candidateProfile, booking });
    if (url && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
  } catch (e) {
    console.warn('Failed to open Google Calendar:', e);
  }
  return false;
}

/**
 * Generate and download standard .ics calendar invite (works with Apple Calendar / Outlook)
 */
export function downloadIcsFile({ session, slot, candidateProfile, booking }) {
  if (!session || !slot || typeof window === 'undefined') return;

  const startDate = getSlotStartDateTime(session.date, slot);
  const endDate = getSlotEndDateTime(session.date, slot, session.slotDuration || 15);

  if (!startDate || !endDate) return;

  const startUtc = toGCalUtcString(startDate);
  const endUtc = toGCalUtcString(endDate);
  const nowUtc = toGCalUtcString(new Date());

  const candidateName = candidateProfile?.name || booking?.candidateName || 'Candidate';
  const category = candidateProfile?.category || booking?.candidateCategory || 'A';
  const title = `Interview: ${session.title || 'Scheduled Interview'}`;
  const uid = `viewme-${session.id}-${slot.id || 'slot'}-${Date.now()}@viewme.app`;

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ViewMe//Interview Scheduler v2.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowUtc}`,
    `DTSTART:${startUtc}`,
    `DTEND:${endUtc}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:Interview Session with ${candidateName} (Category ${category}).\\nSession: ${session.title}\\nInstructions: ${session.description || 'Online meeting'}\\n${window.location.href}`,
    'LOCATION:Online Video Meeting',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', `interview-${session.id}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
