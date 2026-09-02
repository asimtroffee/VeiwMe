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
 * Get canonical slug for category (e.g. "Category A", "Cat A", "A" -> "cat_a")
 */
export function getCanonicalCategorySlug(category) {
  if (!category) return '';
  const str = String(category).trim().toLowerCase();
  if (!str) return '';
  
  // Standard single letters A, B, C, D, etc. or "category A" / "cat A"
  const singleLetterMatch = str.match(/^(?:category|cat)?\s*([a-z0-9]+)$/i);
  if (singleLetterMatch) {
    return `cat_${singleLetterMatch[1].toLowerCase()}`;
  }
  
  // Clean arbitrary string to safe identifier slug
  return str.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'general';
}

/**
 * Compare two category strings for equivalence (e.g. "Category A" equals "Cat A" or "A")
 */
export function matchCategory(cat1, cat2) {
  if (!cat1 && !cat2) return true;
  if (!cat1 || !cat2) return false;
  const s1 = String(cat1).trim().toLowerCase();
  const s2 = String(cat2).trim().toLowerCase();
  if (s1 === s2) return true;

  const slug1 = getCanonicalCategorySlug(cat1);
  const slug2 = getCanonicalCategorySlug(cat2);
  if (slug1 && slug2 && slug1 === slug2) return true;

  // Strip "category " or "cat " prefix for clean comparison
  const clean1 = s1.replace(/^(category|cat)\s*[-_:]?\s*/i, '').trim();
  const clean2 = s2.replace(/^(category|cat)\s*[-_:]?\s*/i, '').trim();
  if (clean1 && clean2 && clean1 === clean2) return true;

  return false;
}

/**
 * Resolve requested category against session categories array
 */
export function resolveCategoryInSession(sessionCategories, requestedCategory) {
  if (!Array.isArray(sessionCategories) || sessionCategories.length === 0) {
    return requestedCategory || 'Category A';
  }
  if (!requestedCategory) {
    return sessionCategories[0];
  }
  // Exact match first
  const exact = sessionCategories.find((c) => c.trim().toLowerCase() === requestedCategory.trim().toLowerCase());
  if (exact) return exact;
  // Normalized/canonical match
  const matched = sessionCategories.find((c) => matchCategory(c, requestedCategory));
  if (matched) return matched;
  // Fallback to first category in session
  return sessionCategories[0];
}

/**
 * Format category label nicely for display (avoiding "Category Category A")
 */
export function formatCategoryName(category) {
  if (!category) return 'Category A';
  const str = String(category).trim();
  if (/^category\s+/i.test(str)) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  if (/^cat\s+/i.test(str)) {
    return 'Category ' + str.replace(/^cat\s+/i, '').trim();
  }
  if (/^[a-z0-9]$/i.test(str)) {
    return `Category ${str.toUpperCase()}`;
  }
  return str;
}

/**
 * Parse any variant slotId into its canonical components (single-day or multi-day)
 */
export function parseSlotId(slotId, defaultCategory = null) {
  if (!slotId) return null;
  const str = String(slotId).trim();
  
  // Format 1: slot_[dayId]_[categorySlug]_[startMinutes]_[endMinutes]
  // e.g. slot_day_1_cat_a_540_555 or slot_d2_cat_b_600_615
  const matchDayWithCat = str.match(/^slot_(day[_\-\w\d]+|d\d+)_(.+)_(\d+)_(\d+)$/i);
  if (matchDayWithCat) {
    const dayId = matchDayWithCat[1];
    const rawCat = matchDayWithCat[2];
    const startMins = Number(matchDayWithCat[3]);
    const endMins = Number(matchDayWithCat[4]);
    const canonicalSlug = getCanonicalCategorySlug(rawCat);
    return {
      rawId: str,
      dayId: dayId,
      canonicalId: `slot_${dayId}_${canonicalSlug}_${startMins}_${endMins}`,
      baseId: `slot_${dayId}_${startMins}_${endMins}`,
      categorySlug: canonicalSlug,
      startMinutes: startMins,
      endMinutes: endMins
    };
  }

  // Format 2: slot_[dayId]_[startMinutes]_[endMinutes]
  // e.g. slot_day_1_540_555
  const matchDayBase = str.match(/^slot_(day[_\-\w\d]+|d\d+)_(\d+)_(\d+)$/i);
  if (matchDayBase) {
    const dayId = matchDayBase[1];
    const startMins = Number(matchDayBase[2]);
    const endMins = Number(matchDayBase[3]);
    const canonicalSlug = defaultCategory ? getCanonicalCategorySlug(defaultCategory) : 'cat_a';
    return {
      rawId: str,
      dayId: dayId,
      canonicalId: `slot_${dayId}_${canonicalSlug}_${startMins}_${endMins}`,
      baseId: `slot_${dayId}_${startMins}_${endMins}`,
      categorySlug: canonicalSlug,
      startMinutes: startMins,
      endMinutes: endMins
    };
  }

  // Format 3: slot_[categorySlug]_[startMinutes]_[endMinutes]
  const matchWithCat = str.match(/^slot_(.+)_(\d+)_(\d+)$/i);
  if (matchWithCat) {
    const rawCat = matchWithCat[1];
    const startMins = Number(matchWithCat[2]);
    const endMins = Number(matchWithCat[3]);
    const canonicalSlug = getCanonicalCategorySlug(rawCat);
    return {
      rawId: str,
      dayId: null,
      canonicalId: `slot_${canonicalSlug}_${startMins}_${endMins}`,
      baseId: `slot_${startMins}_${endMins}`,
      categorySlug: canonicalSlug,
      startMinutes: startMins,
      endMinutes: endMins
    };
  }

  // Format 4: slot_[startMinutes]_[endMinutes]
  const matchBase = str.match(/^slot_(\d+)_(\d+)$/i);
  if (matchBase) {
    const startMins = Number(matchBase[1]);
    const endMins = Number(matchBase[2]);
    const canonicalSlug = defaultCategory ? getCanonicalCategorySlug(defaultCategory) : 'cat_a';
    return {
      rawId: str,
      dayId: null,
      canonicalId: `slot_${canonicalSlug}_${startMins}_${endMins}`,
      baseId: `slot_${startMins}_${endMins}`,
      categorySlug: canonicalSlug,
      startMinutes: startMins,
      endMinutes: endMins
    };
  }

  return null;
}

/**
 * Generate 15-minute slot definitions between start and end time (single-day or multi-day)
 */
export function generateTimeSlots(startTime24, endTime24, slotDurationMinutes = 15, category = null, dayObj = null) {
  const startMins = timeToMinutes(startTime24);
  const endMins = timeToMinutes(endTime24);

  if (endMins <= startMins) {
    return [];
  }

  const slots = [];
  let currentMins = startMins;
  const canonicalSlug = category ? getCanonicalCategorySlug(category) : null;
  const dayId = dayObj ? (dayObj.id || dayObj.dayId || 'day_1') : null;
  const dayDate = dayObj ? dayObj.date : null;
  const dayLabel = dayObj ? (dayObj.label || 'Day 1') : null;

  while (currentMins + slotDurationMinutes <= endMins) {
    const nextMins = currentMins + slotDurationMinutes;
    const startFormatted = minutesTo12Hour(currentMins);
    const endFormatted = minutesTo12Hour(nextMins);
    const period = getSlotPeriod(currentMins);

    let baseId;
    let slotId;

    if (dayId) {
      baseId = `slot_${dayId}_${currentMins}_${nextMins}`;
      slotId = canonicalSlug ? `slot_${dayId}_${canonicalSlug}_${currentMins}_${nextMins}` : baseId;
    } else {
      baseId = `slot_${currentMins}_${nextMins}`;
      slotId = canonicalSlug ? `slot_${canonicalSlug}_${currentMins}_${nextMins}` : baseId;
    }

    slots.push({
      id: slotId,
      baseId: baseId,
      dayId: dayId,
      date: dayDate,
      dayLabel: dayLabel,
      canonicalSlug: canonicalSlug || 'cat_a',
      category: category || null,
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
 * Format an event's date range or multi-day summary (e.g. "Sep 3 – Sep 5, 2026 (3 Days)" or "Thu, Sep 3, 2026")
 */
export function formatEventDateRange(session) {
  if (!session) return '';
  const days = session.days && Array.isArray(session.days) && session.days.length > 0
    ? session.days
    : (session.date ? [{ date: session.date }] : []);

  if (days.length === 0) return '';
  if (days.length === 1) {
    return formatDateDisplay(days[0].date);
  }

  // Multi-day event formatting
  const dates = days.map((d) => d.date).filter(Boolean).sort();
  if (dates.length === 0) return '';
  const firstDateStr = dates[0];
  const lastDateStr = dates[dates.length - 1];

  const [y1, m1, d1] = firstDateStr.split('-').map(Number);
  const [y2, m2, d2] = lastDateStr.split('-').map(Number);
  const date1 = new Date(y1, m1 - 1, d1);
  const date2 = new Date(y2, m2 - 1, d2);

  const m1Name = date1.toLocaleDateString('en-US', { month: 'short' });
  const m2Name = date2.toLocaleDateString('en-US', { month: 'short' });

  if (y1 === y2) {
    if (m1 === m2) {
      return `${m1Name} ${d1} – ${d2}, ${y1} (${days.length} Days)`;
    }
    return `${m1Name} ${d1} – ${m2Name} ${d2}, ${y1} (${days.length} Days)`;
  }
  return `${m1Name} ${d1}, ${y1} – ${m2Name} ${d2}, ${y2} (${days.length} Days)`;
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
      const parsed = parseSlotId(slot.id);
      if (parsed) return parsed.startMinutes;
    }
    if (slot.startTime) return timeToMinutes(slot.startTime);
  } else if (typeof slot === 'string') {
    if (slot.startsWith('slot_')) {
      const parsed = parseSlotId(slot);
      if (parsed) return parsed.startMinutes;
    }
    return timeToMinutes(slot);
  }
  return 0;
}

/**
 * Construct exact Date object for a scheduled slot start
 */
export function getSlotStartDateTime(sessionDate, slot) {
  const effectiveDate = (typeof slot === 'object' && (slot?.date || slot?.slotDate)) ? (slot.date || slot.slotDate) : sessionDate;
  if (!effectiveDate) return null;
  const [year, month, day] = effectiveDate.split('-').map(Number);
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
      const parsed = parseSlotId(slot.id);
      if (parsed) return parsed.endMinutes;
    }
    if (slot.endTime) return timeToMinutes(slot.endTime);
    if (typeof slot.startMinutes === 'number') return slot.startMinutes + durationMinutes;
  } else if (typeof slot === 'string') {
    if (slot.startsWith('slot_')) {
      const parsed = parseSlotId(slot);
      if (parsed) return parsed.endMinutes;
    }
    return timeToMinutes(slot) + durationMinutes;
  }
  return 0;
}

/**
 * Construct exact Date object for a scheduled slot end
 */
export function getSlotEndDateTime(sessionDate, slot, durationMinutes = 15) {
  const effectiveDate = (typeof slot === 'object' && (slot?.date || slot?.slotDate)) ? (slot.date || slot.slotDate) : sessionDate;
  if (!effectiveDate) return null;
  const [year, month, day] = effectiveDate.split('-').map(Number);
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

  const effectiveDate = slot.date || booking?.slotDate || session.date;
  const startDate = getSlotStartDateTime(effectiveDate, slot);
  const endDate = getSlotEndDateTime(effectiveDate, slot, session.slotDuration || 15);

  if (!startDate || !endDate) return '';

  const startUtc = toGCalUtcString(startDate);
  const endUtc = toGCalUtcString(endDate);

  const title = session.title || 'Scheduled Session';
  const candidateName = candidateProfile?.name || booking?.candidateName || 'Participant';
  const category = candidateProfile?.category || booking?.candidateCategory || 'A';
  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
  const dayLabel = slot.dayLabel || (booking?.dayId ? `Day ${booking.dayId.replace(/\D/g, '')}` : '');

  const meetingUrl = session.meetingLink ? session.meetingLink.trim() : '';

  const descriptionLines = [
    meetingUrl
      ? `🚀 JOIN ZOOM MEETING:\n${meetingUrl}\n\n⚠️ IMPORTANT: Please join via the Zoom link above (this meeting is hosted on Zoom).\n`
      : '🎥 Meeting link will be provided by host.\n',
    `══════════════════════════════════`,
    `Session: ${session.title}`,
    dayLabel ? `Day: ${dayLabel} (${formatDateDisplay(effectiveDate)})` : `Date: ${formatDateDisplay(effectiveDate)}`,
    `Time: ${slot.timeLabel} (${session.timezone || 'Local Time'})`,
    `Participant: ${candidateName} (Category ${category})`,
    session.description ? `\nSession Instructions:\n${session.description}` : '',
    `\nManage / Change Slot: ${currentUrl}`
  ].filter(Boolean);

  const description = descriptionLines.join('\n');
  const location = meetingUrl || 'Online Video Meeting (Zoom)';

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${startUtc}/${endUtc}`,
    details: description,
    location: location
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Directly trigger open Google Calendar in new tab
 */
export function openGoogleCalendarDirectly({ session, slot, candidateProfile, booking }) {
  const url = generateGoogleCalendarUrl({ session, slot, candidateProfile, booking });
  if (url && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Generates an RFC 5545 compliant iCalendar (.ics) file
 */
export function downloadIcsFile({ session, slot, candidateProfile, booking }) {
  if (!session || !slot) return;

  const effectiveDate = slot.date || booking?.slotDate || session.date;
  const startDate = getSlotStartDateTime(effectiveDate, slot);
  const endDate = getSlotEndDateTime(effectiveDate, slot, session.slotDuration || 15);

  if (!startDate || !endDate) return;

  const startUtc = toGCalUtcString(startDate);
  const endUtc = toGCalUtcString(endDate);
  const nowUtc = toGCalUtcString(new Date());

  const candidateName = candidateProfile?.name || booking?.candidateName || 'Participant';
  const category = candidateProfile?.category || booking?.candidateCategory || 'A';
  const title = session.title || 'Scheduled Session';
  const uid = `viewme-${session.id}-${slot.id || 'slot'}-${Date.now()}@viewme.app`;
  const meetingUrl = session.meetingLink ? session.meetingLink.trim() : '';
  const dayLabel = slot.dayLabel || (booking?.dayId ? `Day ${booking.dayId.replace(/\D/g, '')}` : '');

  const icsDescription = [
    meetingUrl ? `🎥 JOIN ZOOM MEETING: ${meetingUrl}\\n` : '',
    `Session: ${session.title}`,
    dayLabel ? `Day: ${dayLabel} (${formatDateDisplay(effectiveDate)})` : `Date: ${formatDateDisplay(effectiveDate)}`,
    `Time: ${slot.timeLabel}`,
    `Participant: ${candidateName} (Category ${category})`,
    session.description ? `Instructions: ${session.description}` : '',
    `Portal: ${window.location.href}`
  ].filter(Boolean).join('\\n');

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ViewMe//Scheduler v2.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowUtc}`,
    `DTSTART:${startUtc}`,
    `DTEND:${endUtc}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${icsDescription}`,
    `LOCATION:${meetingUrl || 'Online Video Meeting'}`,
    `URL:${meetingUrl || window.location.href}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', `session-${session.id}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
