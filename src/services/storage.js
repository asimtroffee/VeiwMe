import { generateTimeSlots, generateSessionId } from './timeUtils';
import { db, isFirebaseConfigured } from './firebase';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  runTransaction
} from 'firebase/firestore';

const SESSIONS_KEY = 'viewme_sessions_v2';
const BOOKINGS_KEY = 'viewme_bookings_v2';
const ATTENDEES_KEY = 'viewme_attendees_v2';
const BLOCKED_SLOTS_KEY = 'viewme_blocked_slots_v2';
const EVENTS_KEY = 'viewme_activity_events_v2';
const ADMIN_AUTH_KEY = 'viewme_admin_auth_v2';
const ADMIN_LOCKOUT_KEY = 'viewme_admin_lockout_v2';
const PARTICIPANT_KEY = 'viewme_participant_profile_v2';

const ADMIN_MASTER_PASSWORD = 'admin';
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Device & Client Metadata Helper
function getClientMetadata() {
  const ua = navigator.userAgent || '';
  let device = 'Desktop';
  if (/mobile/i.test(ua)) device = 'Mobile';
  else if (/tablet|ipad/i.test(ua)) device = 'Tablet';

  return {
    device,
    userAgent: ua,
    screenResolution: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  };
}

// Broadcast channel for real-time local multi-tab sync
let syncChannel = null;
try {
  syncChannel = new BroadcastChannel('viewme_sync_channel');
} catch (e) {
  console.warn('BroadcastChannel not supported:', e);
}

function broadcast(type, payload = {}) {
  if (syncChannel) {
    syncChannel.postMessage({ type, payload, timestamp: Date.now() });
  }
}

export function subscribeToSync(callback) {
  // Local broadcast listener
  if (syncChannel) {
    const handler = (event) => {
      if (event.data) {
        callback(event.data);
      }
    };
    syncChannel.addEventListener('message', handler);
  }

  // Firestore live listener if configured
  let unsubscribeFirestore = null;
  if (isFirebaseConfigured() && db) {
    try {
      unsubscribeFirestore = onSnapshot(collection(db, 'events'), () => {
        callback({ type: 'FIRESTORE_SYNC' });
      });
    } catch (e) {
      console.warn('Firestore live listener error:', e);
    }
  }

  return () => {
    if (syncChannel) syncChannel.removeEventListener('message', callback);
    if (unsubscribeFirestore) unsubscribeFirestore();
  };
}

// -------------------------------------------------------------
// Seed & Initial Data
// -------------------------------------------------------------

function getInitialSessions() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const dayAfter = new Date();
  dayAfter.setDate(dayAfter.getDate() + 2);
  const dayAfterStr = dayAfter.toISOString().split('T')[0];

  return [
    {
      id: 'mkt-round2',
      title: 'Marketing Cohort — Interview Day',
      date: tomorrowStr,
      startTime: '09:00',
      endTime: '13:00',
      slotDuration: 15,
      timezone: 'EST',
      description: 'Initial screening interviews for Marketing candidates.',
      createdAt: new Date().toISOString()
    },
    {
      id: 'eng-panel-b',
      title: 'Engineering Panel B — Final Round',
      date: dayAfterStr,
      startTime: '13:30',
      endTime: '17:30',
      slotDuration: 30,
      timezone: 'EST',
      description: 'Technical evaluation and deep-dive panel.',
      createdAt: new Date().toISOString()
    }
  ];
}

function getInitialBookings() {
  return {
    'mkt-round2_slot_540_555': {
      candidateName: 'Alex Rivera',
      candidateCategory: 'A',
      candidateEmail: 'alex.rivera@example.com',
      candidatePhone: '+1 555-019-2834',
      candidateContact: 'alex.rivera@example.com',
      bookedAt: new Date(Date.now() - 3600000).toISOString()
    }
  };
}

function getInitialAttendees() {
  return {
    'mkt-round2_alex.rivera@example.com': {
      id: 'mkt-round2_alex.rivera@example.com',
      sessionId: 'mkt-round2',
      name: 'Alex Rivera',
      category: 'A',
      email: 'alex.rivera@example.com',
      phone: '+1 555-019-2834',
      contact: 'alex.rivera@example.com',
      editCount: 0,
      device: 'Desktop',
      firstCheckedInAt: new Date(Date.now() - 3700000).toISOString(),
      lastSeenAt: new Date(Date.now() - 3600000).toISOString(),
      status: 'booked',
      bookedSlotId: 'slot_540_555'
    }
  };
}

function getInitialEvents() {
  return [
    {
      id: 'evt_init_1',
      type: 'SESSION_CREATED',
      sessionId: 'mkt-round2',
      sessionTitle: 'Marketing Cohort — Interview Day',
      actor: 'Admin',
      details: 'Created session with 15 min slots',
      timestamp: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: 'evt_init_2',
      type: 'USER_CHECKED_IN',
      sessionId: 'mkt-round2',
      sessionTitle: 'Marketing Cohort — Interview Day',
      actor: 'Alex Rivera',
      details: 'Checked in via link (alex.rivera@example.com) on Desktop',
      timestamp: new Date(Date.now() - 3700000).toISOString()
    },
    {
      id: 'evt_init_3',
      type: 'SLOT_BOOKED',
      sessionId: 'mkt-round2',
      sessionTitle: 'Marketing Cohort — Interview Day',
      actor: 'Alex Rivera',
      details: 'Reserved slot 09:00 AM – 09:15 AM',
      timestamp: new Date(Date.now() - 3600000).toISOString()
    }
  ];
}

// -------------------------------------------------------------
// Internal Data Accessors
// -------------------------------------------------------------

function getRawSessions() {
  const data = localStorage.getItem(SESSIONS_KEY);
  if (!data) {
    const initial = getInitialSessions();
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(initial));
    return initial;
  }
  try { return JSON.parse(data); } catch { return []; }
}

function saveRawSessions(sessions) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function getRawBookings() {
  const data = localStorage.getItem(BOOKINGS_KEY);
  if (!data) {
    const initial = getInitialBookings();
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify(initial));
    return initial;
  }
  try { return JSON.parse(data); } catch { return {}; }
}

function saveRawBookings(bookings) {
  localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
}

function getRawBlockedSlots() {
  const data = localStorage.getItem(BLOCKED_SLOTS_KEY);
  if (!data) return {};
  try { return JSON.parse(data); } catch { return {}; }
}

function saveRawBlockedSlots(blockedSlots) {
  localStorage.setItem(BLOCKED_SLOTS_KEY, JSON.stringify(blockedSlots));
}

function getRawAttendees() {
  const data = localStorage.getItem(ATTENDEES_KEY);
  if (!data) {
    const initial = getInitialAttendees();
    localStorage.setItem(ATTENDEES_KEY, JSON.stringify(initial));
    return initial;
  }
  try { return JSON.parse(data); } catch { return {}; }
}

function saveRawAttendees(attendees) {
  localStorage.setItem(ATTENDEES_KEY, JSON.stringify(attendees));
}

function getRawEvents() {
  const data = localStorage.getItem(EVENTS_KEY);
  if (!data) {
    const initial = getInitialEvents();
    localStorage.setItem(EVENTS_KEY, JSON.stringify(initial));
    return initial;
  }
  try { return JSON.parse(data); } catch { return []; }
}

function saveRawEvents(events) {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

// -------------------------------------------------------------
// Activity Audit & Event Logger
// -------------------------------------------------------------

export function logActivityEvent({ type, sessionId, sessionTitle, actor, details }) {
  const events = getRawEvents();
  const eventRecord = {
    id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    type,
    sessionId: sessionId || '',
    sessionTitle: sessionTitle || '',
    actor: actor || 'Candidate',
    details: details || '',
    timestamp: new Date().toISOString()
  };

  events.unshift(eventRecord);
  if (events.length > 500) events.pop(); // keep last 500 events
  saveRawEvents(events);

  // Sync to Firestore if available
  if (isFirebaseConfigured() && db) {
    setDoc(doc(db, 'events', eventRecord.id), eventRecord).catch((err) => {
      console.warn('Could not sync event to Firestore:', err);
    });
  }

  broadcast('EVENT_LOGGED', { event: eventRecord });
  return eventRecord;
}

export function getAllActivityEvents() {
  return getRawEvents();
}

export function getSessionActivityEvents(sessionId) {
  const events = getRawEvents();
  return events.filter((e) => e.sessionId === sessionId);
}

// -------------------------------------------------------------
// Admin Auth & Lockout
// -------------------------------------------------------------

export function getAdminLockoutStatus() {
  const data = localStorage.getItem(ADMIN_LOCKOUT_KEY);
  if (!data) return { isLocked: false, remainingAttempts: MAX_ATTEMPTS, lockoutUntil: 0 };
  try {
    const parsed = JSON.parse(data);
    const now = Date.now();
    if (parsed.lockoutUntil && parsed.lockoutUntil > now) {
      const minutesLeft = Math.ceil((parsed.lockoutUntil - now) / 60000);
      return { isLocked: true, remainingAttempts: 0, lockoutUntil: parsed.lockoutUntil, minutesLeft };
    }
    if (parsed.lockoutUntil && parsed.lockoutUntil <= now) {
      localStorage.removeItem(ADMIN_LOCKOUT_KEY);
      return { isLocked: false, remainingAttempts: MAX_ATTEMPTS, lockoutUntil: 0 };
    }
    return { isLocked: false, remainingAttempts: Math.max(0, MAX_ATTEMPTS - (parsed.failedAttempts || 0)), lockoutUntil: 0 };
  } catch {
    return { isLocked: false, remainingAttempts: MAX_ATTEMPTS, lockoutUntil: 0 };
  }
}

export function verifyAdminPassword(inputPassword) {
  const lockout = getAdminLockoutStatus();
  if (lockout.isLocked) {
    return { success: false, error: `Too many failed attempts. Locked out for ${lockout.minutesLeft} more minute(s).` };
  }

  if (inputPassword === ADMIN_MASTER_PASSWORD) {
    localStorage.removeItem(ADMIN_LOCKOUT_KEY);
    localStorage.setItem(ADMIN_AUTH_KEY, JSON.stringify({ authenticated: true, timestamp: Date.now() }));
    logActivityEvent({
      type: 'ADMIN_LOGIN',
      actor: 'Admin',
      details: 'Administrator console unlocked'
    });
    return { success: true };
  }

  const currentLockout = JSON.parse(localStorage.getItem(ADMIN_LOCKOUT_KEY) || '{"failedAttempts":0}');
  const newAttempts = (currentLockout.failedAttempts || 0) + 1;

  if (newAttempts >= MAX_ATTEMPTS) {
    const lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
    localStorage.setItem(ADMIN_LOCKOUT_KEY, JSON.stringify({ failedAttempts: newAttempts, lockoutUntil }));
    logActivityEvent({
      type: 'ADMIN_LOCKOUT_TRIGGERED',
      actor: 'System',
      details: 'Max 5 invalid password attempts reached. 15-minute security lockout triggered.'
    });
    return { success: false, error: 'Incorrect password. Max 5 attempts reached. You are locked out for 15 minutes.' };
  } else {
    localStorage.setItem(ADMIN_LOCKOUT_KEY, JSON.stringify({ failedAttempts: newAttempts, lockoutUntil: 0 }));
    const left = MAX_ATTEMPTS - newAttempts;
    return { success: false, error: `Incorrect password. ${left} attempt${left === 1 ? '' : 's'} remaining.` };
  }
}

export function isSessionAdminAuthenticated() {
  const auth = localStorage.getItem(ADMIN_AUTH_KEY);
  if (!auth) return false;
  try {
    const parsed = JSON.parse(auth);
    return Boolean(parsed && parsed.authenticated);
  } catch { return false; }
}

export function logoutAdmin() {
  localStorage.removeItem(ADMIN_AUTH_KEY);
  logActivityEvent({
    type: 'ADMIN_LOGOUT',
    actor: 'Admin',
    details: 'Administrator console locked'
  });
}

// -------------------------------------------------------------
// Sessions & Bookings Management
// -------------------------------------------------------------

export function getAllSessions() {
  const sessions = getRawSessions();
  const bookings = getRawBookings();
  const blockedSlots = getRawBlockedSlots();

  return sessions.map((session) => {
    const duration = Number(session.slotDuration) || 15;
    const slots = generateTimeSlots(session.startTime, session.endTime, duration);
    let bookedCount = 0;
    let blockedCount = 0;

    slots.forEach((slot) => {
      const key = `${session.id}_${slot.id}`;
      if (bookings[key]) {
        bookedCount++;
      } else if (blockedSlots[key]) {
        blockedCount++;
      }
    });

    return {
      ...session,
      slotDuration: duration,
      totalSlots: slots.length,
      bookedCount: bookedCount,
      blockedCount: blockedCount,
      availableCount: Math.max(0, slots.length - bookedCount - blockedCount),
      percentBooked: slots.length > 0 ? Math.round((bookedCount / slots.length) * 100) : 0
    };
  });
}

export function getSessionDetails(sessionId) {
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return null;

  const duration = Number(session.slotDuration) || 15;
  const bookings = getRawBookings();
  const blockedSlots = getRawBlockedSlots();
  const slots = generateTimeSlots(session.startTime, session.endTime, duration);

  let bookedCount = 0;
  let blockedCount = 0;
  const enrichedSlots = slots.map((slot) => {
    const key = `${session.id}_${slot.id}`;
    const booking = bookings[key];
    const isBlocked = Boolean(blockedSlots[key]);

    if (booking) {
      bookedCount++;
      return {
        ...slot,
        isBooked: true,
        isBlocked: false,
        booking: booking
      };
    }
    if (isBlocked) {
      blockedCount++;
      return {
        ...slot,
        isBooked: false,
        isBlocked: true,
        booking: null,
        blockedInfo: blockedSlots[key]
      };
    }
    return {
      ...slot,
      isBooked: false,
      isBlocked: false,
      booking: null
    };
  });

  return {
    ...session,
    slotDuration: duration,
    slots: enrichedSlots,
    totalSlots: slots.length,
    bookedCount: bookedCount,
    blockedCount: blockedCount,
    availableCount: Math.max(0, slots.length - bookedCount - blockedCount),
    percentBooked: slots.length > 0 ? Math.round((bookedCount / slots.length) * 100) : 0
  };
}

export function toggleSlotBlocked(sessionId, slotId, reason = 'Unavailable') {
  const blockedSlots = getRawBlockedSlots();
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const key = `${sessionId}_${slotId}`;

  const isCurrentlyBlocked = Boolean(blockedSlots[key]);
  if (isCurrentlyBlocked) {
    delete blockedSlots[key];
    saveRawBlockedSlots(blockedSlots);

    if (isFirebaseConfigured() && db) {
      deleteDoc(doc(db, 'blocked_slots', key)).catch(() => {});
    }

    logActivityEvent({
      type: 'SLOT_UNBLOCKED',
      sessionId,
      sessionTitle: session?.title || 'Session',
      actor: 'Admin',
      details: `Restored slot ${slotId} to open/available`
    });

    broadcast('SLOT_BLOCKED_TOGGLED', { sessionId, slotId, isBlocked: false });
    return { success: true, isBlocked: false };
  } else {
    const blockRecord = {
      sessionId,
      slotId,
      blockedAt: new Date().toISOString(),
      reason: reason || 'Unavailable'
    };

    blockedSlots[key] = blockRecord;
    saveRawBlockedSlots(blockedSlots);

    if (isFirebaseConfigured() && db) {
      setDoc(doc(db, 'blocked_slots', key), blockRecord).catch(() => {});
    }

    logActivityEvent({
      type: 'SLOT_BLOCKED',
      sessionId,
      sessionTitle: session?.title || 'Session',
      actor: 'Admin',
      details: `Marked slot ${slotId} unavailable`
    });

    broadcast('SLOT_BLOCKED_TOGGLED', { sessionId, slotId, isBlocked: true });
    return { success: true, isBlocked: true };
  }
}

export function createNewSession({ title, date, startTime, endTime, slotDuration = 15, timezone = 'EST', description = '' }) {
  const sessions = getRawSessions();
  const id = generateSessionId();

  const newSession = {
    id,
    title: title.trim(),
    date,
    startTime,
    endTime,
    slotDuration: Number(slotDuration) || 15,
    timezone,
    description: description.trim(),
    createdAt: new Date().toISOString()
  };

  sessions.unshift(newSession);
  saveRawSessions(sessions);

  // Firestore sync
  if (isFirebaseConfigured() && db) {
    setDoc(doc(db, 'sessions', newSession.id), newSession).catch((err) => {
      console.warn('Could not sync session to Firestore:', err);
    });
  }

  logActivityEvent({
    type: 'SESSION_CREATED',
    sessionId: newSession.id,
    sessionTitle: newSession.title,
    actor: 'Admin',
    details: `Created session on ${date} (${startTime}–${endTime}, ${newSession.slotDuration}m slots)`
  });

  broadcast('SESSION_CREATED', { session: newSession });
  return newSession;
}

export function deleteSession(sessionId) {
  let sessions = getRawSessions();
  const sessionToDelete = sessions.find((s) => s.id === sessionId);
  sessions = sessions.filter((s) => s.id !== sessionId);
  saveRawSessions(sessions);

  // Clean up bookings
  const bookings = getRawBookings();
  const updatedBookings = {};
  Object.keys(bookings).forEach((key) => {
    if (!key.startsWith(`${sessionId}_`)) {
      updatedBookings[key] = bookings[key];
    }
  });
  saveRawBookings(updatedBookings);

  // Clean up blocked slots
  const blockedSlots = getRawBlockedSlots();
  const updatedBlockedSlots = {};
  Object.keys(blockedSlots).forEach((key) => {
    if (!key.startsWith(`${sessionId}_`)) {
      updatedBlockedSlots[key] = blockedSlots[key];
    }
  });
  saveRawBlockedSlots(updatedBlockedSlots);

  // Firestore sync
  if (isFirebaseConfigured() && db) {
    deleteDoc(doc(db, 'sessions', sessionId)).catch((err) => {
      console.warn('Could not delete session from Firestore:', err);
    });
  }

  logActivityEvent({
    type: 'SESSION_DELETED',
    sessionId: sessionId,
    sessionTitle: sessionToDelete?.title || sessionId,
    actor: 'Admin',
    details: `Deleted session "${sessionToDelete?.title || sessionId}" and cleared bookings`
  });

  broadcast('SESSION_DELETED', { sessionId });
  return true;
}

// -------------------------------------------------------------
// Attendee Check-In Recording
// -------------------------------------------------------------

export function recordSessionAttendee(sessionId, { name, category = 'A', email = '', phone = '', contact = '' }) {
  const attendees = getRawAttendees();
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const derivedContact = contact || (email && phone ? `${email} • ${phone}` : email || phone || '');
  const normalizedContact = (email || derivedContact || name).trim().toLowerCase();
  const key = `${sessionId}_${normalizedContact}`;
  const now = new Date().toISOString();
  const clientMeta = getClientMetadata();

  const existing = attendees[key];
  const attendeeRecord = {
    id: key,
    sessionId,
    name: name.trim(),
    category: category || 'A',
    email: email.trim(),
    phone: phone.trim(),
    contact: derivedContact.trim(),
    editCount: existing?.editCount !== undefined ? existing.editCount : 0,
    device: clientMeta.device,
    clientTimezone: clientMeta.timezone,
    firstCheckedInAt: existing ? existing.firstCheckedInAt : now,
    lastSeenAt: now,
    status: existing ? existing.status : 'checked_in',
    bookedSlotId: existing ? existing.bookedSlotId : null
  };

  attendees[key] = attendeeRecord;
  saveRawAttendees(attendees);

  saveParticipantProfile(sessionId, {
    name: attendeeRecord.name,
    category: attendeeRecord.category,
    email: attendeeRecord.email,
    phone: attendeeRecord.phone,
    contact: attendeeRecord.contact,
    editCount: attendeeRecord.editCount
  });

  // Firestore sync
  if (isFirebaseConfigured() && db) {
    setDoc(doc(db, 'attendees', key), attendeeRecord, { merge: true }).catch((err) => {
      console.warn('Could not sync attendee to Firestore:', err);
    });
  }

  logActivityEvent({
    type: 'USER_CHECKED_IN',
    sessionId: sessionId,
    sessionTitle: session?.title || 'Interview Session',
    actor: attendeeRecord.name,
    details: `Checked in Category ${attendeeRecord.category} (${attendeeRecord.email || attendeeRecord.contact}) on ${attendeeRecord.device}`
  });

  broadcast('ATTENDEE_RECORDED', { sessionId, attendee: attendeeRecord });
  return attendeeRecord;
}

export function getSessionAttendees(sessionId) {
  const attendees = getRawAttendees();
  const session = getSessionDetails(sessionId);

  const list = [];
  Object.keys(attendees).forEach((key) => {
    if (key.startsWith(`${sessionId}_`)) {
      const att = attendees[key];
      let currentBooking = null;
      if (session && session.slots) {
        session.slots.forEach((slot) => {
          if (
            slot.isBooked &&
            (
              (att.email && slot.booking.candidateEmail && slot.booking.candidateEmail.toLowerCase() === att.email.toLowerCase()) ||
              slot.booking.candidateContact.toLowerCase() === att.contact.toLowerCase() ||
              slot.booking.candidateName.toLowerCase() === att.name.toLowerCase()
            )
          ) {
            currentBooking = slot;
          }
        });
      }

      list.push({
        ...att,
        isBooked: Boolean(currentBooking),
        bookedSlot: currentBooking
      });
    }
  });

  return list.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
}

export function getAllAttendees() {
  const attendees = getRawAttendees();
  const sessions = getRawSessions();
  const sessionMap = {};
  sessions.forEach((s) => { sessionMap[s.id] = s; });

  const list = [];
  Object.keys(attendees).forEach((key) => {
    const att = attendees[key];
    const session = sessionMap[att.sessionId];
    if (session) {
      list.push({
        ...att,
        sessionTitle: session.title,
        sessionDate: session.date
      });
    }
  });

  return list.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
}

// -------------------------------------------------------------
// Slot Booking (Atomic, 1 Slot Limit, Conflict Shield)
// -------------------------------------------------------------

export function bookSlot(sessionId, slotId, { candidateName, candidateContact, candidateCategory = 'A', candidateEmail = '', candidatePhone = '' }) {
  const bookings = getRawBookings();
  const blockedSlots = getRawBlockedSlots();
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const key = `${sessionId}_${slotId}`;

  // Check if slot is blocked by admin
  if (blockedSlots[key]) {
    return {
      success: false,
      conflict: true,
      error: 'This time slot has been marked unavailable by the session administrator.'
    };
  }

  // Conflict check: Already taken?
  if (bookings[key]) {
    logActivityEvent({
      type: 'BOOKING_CONFLICT',
      sessionId: sessionId,
      sessionTitle: session?.title || 'Session',
      actor: candidateName,
      details: `Attempted to book slot ${slotId} which was already taken.`
    });
    return {
      success: false,
      conflict: true,
      error: `This slot was just booked moments ago by ${bookings[key].candidateName}. Please select another open time slot.`
    };
  }

  // 1-Person 1-Slot Rule Check
  const normalizedContact = candidateContact.trim().toLowerCase();
  const normalizedEmail = candidateEmail.trim().toLowerCase();
  const normalizedName = candidateName.trim().toLowerCase();

  for (const [bookingKey, b] of Object.entries(bookings)) {
    if (bookingKey.startsWith(`${sessionId}_`) && bookingKey !== key) {
      if (
        (normalizedEmail && b.candidateEmail && b.candidateEmail.toLowerCase() === normalizedEmail) ||
        (b.candidateContact && b.candidateContact.toLowerCase() === normalizedContact) ||
        (b.candidateName && b.candidateName.toLowerCase() === normalizedName)
      ) {
        return {
          success: false,
          alreadyReserved: true,
          error: `You already have an active reserved interview slot in this session. Each candidate may only book one slot. Please cancel your existing booking first if you wish to choose a different time.`
        };
      }
    }
  }

  // Lock in booking
  const bookingRecord = {
    sessionId,
    slotId,
    candidateName: candidateName.trim(),
    candidateContact: candidateContact.trim(),
    candidateCategory: candidateCategory || 'A',
    candidateEmail: candidateEmail.trim(),
    candidatePhone: candidatePhone.trim(),
    bookedAt: new Date().toISOString()
  };

  bookings[key] = bookingRecord;
  saveRawBookings(bookings);

  // Update attendee status
  const attendees = getRawAttendees();
  const attKey = `${sessionId}_${(candidateEmail || candidateContact || candidateName).toLowerCase().trim()}`;
  if (attendees[attKey]) {
    attendees[attKey].status = 'booked';
    attendees[attKey].bookedSlotId = slotId;
    attendees[attKey].lastSeenAt = new Date().toISOString();
    saveRawAttendees(attendees);
  }

  // Firestore sync
  if (isFirebaseConfigured() && db) {
    setDoc(doc(db, 'bookings', key), bookingRecord).catch((err) => {
      console.warn('Could not sync booking to Firestore:', err);
    });
  }

  logActivityEvent({
    type: 'SLOT_BOOKED',
    sessionId: sessionId,
    sessionTitle: session?.title || 'Session',
    actor: candidateName.trim(),
    details: `Confirmed slot reservation for Category ${bookingRecord.candidateCategory} (${bookingRecord.candidateEmail || bookingRecord.candidateContact})`
  });

  broadcast('SLOT_BOOKED', { sessionId, slotId, booking: bookingRecord });

  return {
    success: true,
    booking: bookingRecord
  };
}

export function cancelBooking(sessionId, slotId) {
  const bookings = getRawBookings();
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const key = `${sessionId}_${slotId}`;

  if (!bookings[key]) {
    return { success: false, error: 'Booking not found.' };
  }

  const removedBooking = bookings[key];
  delete bookings[key];
  saveRawBookings(bookings);

  // Revert attendee status
  const attendees = getRawAttendees();
  const normalizedContact = (removedBooking.candidateEmail || removedBooking.candidateContact || '').toLowerCase();
  const attKey = `${sessionId}_${normalizedContact}`;
  if (attendees[attKey]) {
    attendees[attKey].status = 'checked_in';
    attendees[attKey].bookedSlotId = null;
    saveRawAttendees(attendees);
  }

  // Firestore sync
  if (isFirebaseConfigured() && db) {
    deleteDoc(doc(db, 'bookings', key)).catch((err) => {
      console.warn('Could not delete booking from Firestore:', err);
    });
  }

  logActivityEvent({
    type: 'SLOT_CANCELLED',
    sessionId: sessionId,
    sessionTitle: session?.title || 'Session',
    actor: removedBooking.candidateName,
    details: `Cancelled booking (${removedBooking.candidateContact})`
  });

  broadcast('SLOT_CANCELLED', { sessionId, slotId, removedBooking });
  return { success: true };
}

// -------------------------------------------------------------
// Candidate Directory (Aggregated for Admin)
// -------------------------------------------------------------

export function getAllCandidates() {
  const sessions = getRawSessions();
  const bookings = getRawBookings();
  const sessionMap = {};
  sessions.forEach((s) => { sessionMap[s.id] = s; });

  const candidateList = [];
  Object.keys(bookings).forEach((key) => {
    const booking = bookings[key];
    const [sessionId, ...slotParts] = key.split('_');
    const slotId = slotParts.join('_');
    const session = sessionMap[sessionId];

    if (session) {
      const slots = generateTimeSlots(session.startTime, session.endTime, session.slotDuration || 15);
      const matchedSlot = slots.find((sl) => sl.id === slotId);

      candidateList.push({
        id: key,
        candidateName: booking.candidateName,
        candidateCategory: booking.candidateCategory || 'A',
        candidateEmail: booking.candidateEmail || '',
        candidatePhone: booking.candidatePhone || '',
        candidateContact: booking.candidateContact,
        bookedAt: booking.bookedAt,
        sessionId: session.id,
        sessionTitle: session.title,
        sessionDate: session.date,
        slotTimeLabel: matchedSlot ? matchedSlot.timeLabel : 'Scheduled Time',
        slotId: slotId
      });
    }
  });

  return candidateList.sort((a, b) => new Date(b.bookedAt) - new Date(a.bookedAt));
}

// -------------------------------------------------------------
// Participant Local Identity / Gate Cache
// -------------------------------------------------------------

export function getParticipantProfile(sessionId) {
  try {
    const data = localStorage.getItem(`${PARTICIPANT_KEY}_${sessionId}`) || localStorage.getItem(PARTICIPANT_KEY);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

export function saveParticipantProfile(sessionId, profile) {
  try {
    localStorage.setItem(`${PARTICIPANT_KEY}_${sessionId}`, JSON.stringify(profile));
    localStorage.setItem(PARTICIPANT_KEY, JSON.stringify(profile));
  } catch (e) {
    console.error('Could not save participant profile:', e);
  }
}

export function clearParticipantProfile(sessionId) {
  try {
    if (sessionId) {
      localStorage.removeItem(`${PARTICIPANT_KEY}_${sessionId}`);
    }
    localStorage.removeItem(PARTICIPANT_KEY);
  } catch (e) {
    console.error('Could not clear participant profile:', e);
  }
}

export function updateParticipantProfile(sessionId, oldProfile, newProfile) {
  const currentEdits = Number(oldProfile?.editCount) || 0;
  if (currentEdits >= 2) {
    throw new Error('You cannot edit your information more than two times.');
  }

  const newName = newProfile.name.trim();
  const newCategory = newProfile.category || 'A';
  const newEmail = (newProfile.email || '').trim();
  const newPhone = (newProfile.phone || '').trim();
  const newContact = (newProfile.contact || (newEmail && newPhone ? `${newEmail} • ${newPhone}` : newEmail || newPhone)).trim();
  const nextEditCount = currentEdits + 1;

  const oldName = oldProfile?.name ? oldProfile.name.trim() : '';
  const oldEmail = oldProfile?.email ? oldProfile.email.trim() : '';
  const oldContact = oldProfile?.contact ? oldProfile.contact.trim() : '';

  const profileRecord = {
    name: newName,
    category: newCategory,
    email: newEmail,
    phone: newPhone,
    contact: newContact,
    editCount: nextEditCount
  };

  // Update localStorage profile
  saveParticipantProfile(sessionId, profileRecord);

  // Update attendees list
  const attendees = getRawAttendees();
  const oldKey = `${sessionId}_${(oldEmail || oldContact).toLowerCase()}`;
  const newKey = `${sessionId}_${(newEmail || newContact).toLowerCase()}`;

  let existingAtt = attendees[oldKey] || attendees[newKey];
  if (existingAtt) {
    if (oldKey !== newKey) {
      delete attendees[oldKey];
    }
    attendees[newKey] = {
      ...existingAtt,
      id: newKey,
      name: newName,
      category: newCategory,
      email: newEmail,
      phone: newPhone,
      contact: newContact,
      editCount: nextEditCount,
      lastSeenAt: new Date().toISOString()
    };
    saveRawAttendees(attendees);

    if (isFirebaseConfigured() && db) {
      if (oldKey !== newKey) {
        deleteDoc(doc(db, 'attendees', oldKey)).catch(() => {});
      }
      setDoc(doc(db, 'attendees', newKey), attendees[newKey], { merge: true }).catch(() => {});
    }
  } else {
    // Record as new attendee if missing
    recordSessionAttendee(sessionId, profileRecord);
  }

  // Update any existing bookings with new name and contact info
  const bookings = getRawBookings();
  let bookingUpdated = false;

  Object.keys(bookings).forEach((key) => {
    if (key.startsWith(`${sessionId}_`)) {
      const b = bookings[key];
      const matchOldEmail = oldEmail && b.candidateEmail?.toLowerCase() === oldEmail.toLowerCase();
      const matchOldContact = oldContact && b.candidateContact?.toLowerCase() === oldContact.toLowerCase();
      const matchOldName = oldName && b.candidateName?.toLowerCase() === oldName.toLowerCase();
      if (matchOldEmail || matchOldContact || matchOldName) {
        bookings[key] = {
          ...b,
          candidateName: newName,
          candidateCategory: newCategory,
          candidateEmail: newEmail,
          candidatePhone: newPhone,
          candidateContact: newContact
        };
        bookingUpdated = true;

        if (isFirebaseConfigured() && db) {
          setDoc(doc(db, 'bookings', key), bookings[key], { merge: true }).catch(() => {});
        }
      }
    }
  });

  if (bookingUpdated) {
    saveRawBookings(bookings);
  }

  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);

  logActivityEvent({
    type: 'USER_UPDATED_INFO',
    sessionId: sessionId,
    sessionTitle: session?.title || 'Interview Session',
    actor: newName,
    details: `Updated info (Category ${newCategory}, ${newEmail}, ${newPhone}) [Edit ${nextEditCount}/2]`
  });

  broadcast('PARTICIPANT_UPDATED', { sessionId, profile: profileRecord });

  return profileRecord;
}



