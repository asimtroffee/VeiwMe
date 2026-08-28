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
