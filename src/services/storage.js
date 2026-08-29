import {
  generateTimeSlots,
  generateSessionId,
  isSlotWithinCutoff,
  getHoursUntilSlot,
  formatTimeUntilMeeting
} from './timeUtils';
import { db, isFirebaseConfigured } from './firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  runTransaction,
  onSnapshot
} from 'firebase/firestore';

const SESSIONS_KEY = 'viewme_sessions_v2';
const BOOKINGS_KEY = 'viewme_bookings_v2';
const ATTENDEES_KEY = 'viewme_attendees_v2';
const BLOCKED_SLOTS_KEY = 'viewme_blocked_slots_v2';
const EVENTS_KEY = 'viewme_activity_events_v2';
const ADMIN_AUTH_KEY = 'viewme_admin_auth_v2';
const ADMIN_LOCKOUT_KEY = 'viewme_admin_lockout_v2';
const PARTICIPANT_KEY = 'viewme_participant_profile_v2';

// Secure Admin Password from environment variable with fallback
const ADMIN_MASTER_PASSWORD = (import.meta.env.VITE_ADMIN_PASSWORD || 'admin').trim();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const SESSION_AUTH_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours expiring session

// Device & Client Metadata Helper
function getClientMetadata() {
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  let device = 'Desktop';
  if (/mobile/i.test(ua)) device = 'Mobile';
  else if (/tablet|ipad/i.test(ua)) device = 'Tablet';

  return {
    device,
    userAgent: ua,
    screenResolution: typeof window !== 'undefined' && window.screen ? `${window.screen.width}x${window.screen.height}` : '1920x1080',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  };
}

// Broadcast channel for real-time local multi-tab sync
let syncChannel = null;
try {
  if (typeof window !== 'undefined' && window.BroadcastChannel) {
    syncChannel = new BroadcastChannel('viewme_sync_channel');
  }
} catch (e) {
  console.warn('BroadcastChannel not supported:', e);
}

function broadcast(type, payload = {}) {
  if (syncChannel) {
    try {
      syncChannel.postMessage({ type, payload, timestamp: Date.now() });
    } catch (e) {
      console.warn('broadcast error:', e);
    }
  }
}

// Set up bidirectional live Firestore synchronization
let firestoreListenersActive = false;

export function initFirestoreLiveSync() {
  if (firestoreListenersActive || !isFirebaseConfigured() || !db) return;
  firestoreListenersActive = true;

  try {
    // 1. Live Sessions Listener
    onSnapshot(collection(db, 'sessions'), (snapshot) => {
      if (!snapshot.empty) {
        const remoteSessions = [];
        snapshot.forEach((d) => {
          remoteSessions.push(d.data());
        });
        saveRawSessions(remoteSessions);
        broadcast('SESSIONS_SYNCED', { sessions: remoteSessions });
      }
    }, (err) => console.warn('Firestore sessions listener warning:', err));

    // 2. Live Bookings Listener
    onSnapshot(collection(db, 'bookings'), (snapshot) => {
      const remoteBookings = {};
      snapshot.forEach((d) => {
        remoteBookings[d.id] = d.data();
      });
      saveRawBookings(remoteBookings);
      broadcast('BOOKINGS_SYNCED', { bookings: remoteBookings });
    }, (err) => console.warn('Firestore bookings listener warning:', err));

    // 3. Live Blocked Slots Listener
    onSnapshot(collection(db, 'blocked_slots'), (snapshot) => {
      const remoteBlocked = {};
      snapshot.forEach((d) => {
        remoteBlocked[d.id] = d.data();
      });
      saveRawBlockedSlots(remoteBlocked);
      broadcast('BLOCKED_SYNCED', { blocked: remoteBlocked });
    }, (err) => console.warn('Firestore blocked slots listener warning:', err));

    // 4. Live Attendees Listener
    onSnapshot(collection(db, 'attendees'), (snapshot) => {
      const remoteAttendees = {};
      snapshot.forEach((d) => {
        remoteAttendees[d.id] = d.data();
      });
      saveRawAttendees(remoteAttendees);
      broadcast('ATTENDEES_SYNCED', { attendees: remoteAttendees });
    }, (err) => console.warn('Firestore attendees listener warning:', err));

    // 5. Live Events Listener
    onSnapshot(collection(db, 'events'), (snapshot) => {
      if (!snapshot.empty) {
        const remoteEvents = [];
        snapshot.forEach((d) => {
          remoteEvents.push(d.data());
        });
        remoteEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        saveRawEvents(remoteEvents);
        broadcast('EVENTS_SYNCED', { events: remoteEvents });
      }
    }, (err) => console.warn('Firestore events listener warning:', err));
  } catch (e) {
    console.warn('Error starting Firestore live sync:', e);
  }
}

// Auto-start Firestore sync
if (typeof window !== 'undefined') {
  initFirestoreLiveSync();
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

  // Ensure Firestore is syncing
  initFirestoreLiveSync();

  return () => {
    if (syncChannel) syncChannel.removeEventListener('message', callback);
  };
}

// Direct cloud fetch for specific session (crucial for cross-device direct links)
export async function fetchRemoteSession(sessionId) {
  if (!sessionId) return null;

  if (isFirebaseConfigured() && db) {
    try {
      const sessionDocRef = doc(db, 'sessions', sessionId);
      const sessionSnap = await getDoc(sessionDocRef);
      if (sessionSnap.exists()) {
        const sessionData = sessionSnap.data();
        const sessions = getRawSessions();
        const existingIdx = sessions.findIndex((s) => s.id === sessionId);
        if (existingIdx >= 0) {
          sessions[existingIdx] = sessionData;
        } else {
          sessions.unshift(sessionData);
        }
        saveRawSessions(sessions);
      }

      // Also pull bookings & blocked slots for accurate slot availability
      const [bookingsSnap, blockedSnap] = await Promise.all([
        getDocs(collection(db, 'bookings')),
        getDocs(collection(db, 'blocked_slots'))
      ]);

      if (!bookingsSnap.empty) {
        const bookings = getRawBookings();
        bookingsSnap.forEach((d) => {
          bookings[d.id] = d.data();
        });
        saveRawBookings(bookings);
      }

      if (!blockedSnap.empty) {
        const blocked = getRawBlockedSlots();
        blockedSnap.forEach((d) => {
          blocked[d.id] = d.data();
        });
        saveRawBlockedSlots(blocked);
      }
    } catch (err) {
      console.warn('Could not fetch session directly from Firestore:', err);
    }
  }

  return getSessionDetails(sessionId);
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
      title: 'Q&A 15 min',
      date: tomorrowStr,
      startTime: '09:00',
      endTime: '13:00',
      slotDuration: 15,
      timezone: 'EST',
      description: 'Q&A session for participants.',
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
      sessionTitle: 'Q&A 15 min',
      actor: 'Admin',
      details: 'Created session with 15 min slots',
      timestamp: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: 'evt_init_2',
      type: 'USER_CHECKED_IN',
      sessionId: 'mkt-round2',
      sessionTitle: 'Q&A 15 min',
      actor: 'Alex Rivera',
      details: 'Checked in via link (alex.rivera@example.com) on Desktop',
      timestamp: new Date(Date.now() - 3700000).toISOString()
    },
    {
      id: 'evt_init_3',
      type: 'SLOT_BOOKED',
      sessionId: 'mkt-round2',
      sessionTitle: 'Q&A 15 min',
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

  const cleanInput = (inputPassword || '').trim();
  if (cleanInput === ADMIN_MASTER_PASSWORD) {
    localStorage.removeItem(ADMIN_LOCKOUT_KEY);
    const sessionToken = {
      authenticated: true,
      timestamp: Date.now(),
      expiresAt: Date.now() + SESSION_AUTH_DURATION_MS,
      token: `viewme_adm_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`
    };
    localStorage.setItem(ADMIN_AUTH_KEY, JSON.stringify(sessionToken));

    logActivityEvent({
      type: 'ADMIN_LOGIN',
      actor: 'Admin',
      details: 'Administrator console unlocked with expiring session token'
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
    if (parsed && parsed.authenticated) {
      if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
        localStorage.removeItem(ADMIN_AUTH_KEY);
        return false;
      }
      return true;
    }
    return false;
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
    const categories = session.categories && session.categories.length > 0 ? session.categories : ['A', 'B', 'C'];
    
    let totalSlots = 0;
    let bookedCount = 0;
    let blockedCount = 0;

    categories.forEach((cat) => {
      const slots = generateTimeSlots(session.startTime, session.endTime, duration, cat);
      totalSlots += slots.length;
      slots.forEach((slot) => {
        const key = `${session.id}_${slot.id}`;
        const legacyKey = cat === 'A' || cat === categories[0] ? `${session.id}_${slot.baseId}` : null;
        if (bookings[key] || (legacyKey && bookings[legacyKey])) {
          bookedCount++;
        } else if (blockedSlots[key] || (legacyKey && blockedSlots[legacyKey])) {
          blockedCount++;
        }
      });
    });

    return {
      ...session,
      categories,
      slotDuration: duration,
      totalSlots: totalSlots,
      bookedCount: bookedCount,
      blockedCount: blockedCount,
      availableCount: Math.max(0, totalSlots - bookedCount - blockedCount),
      percentBooked: totalSlots > 0 ? Math.round((bookedCount / totalSlots) * 100) : 0
    };
  });
}

export function getSessionDetails(sessionId, selectedCategory = null) {
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return null;

  const duration = Number(session.slotDuration) || 15;
  const categories = session.categories && session.categories.length > 0 ? session.categories : ['A', 'B', 'C'];
  const bookings = getRawBookings();
  const blockedSlots = getRawBlockedSlots();

  let totalSlots = 0;
  let bookedCount = 0;
  let blockedCount = 0;
  const allSlots = [];
  const categorySlots = {};

  categories.forEach((cat) => {
    const catRawSlots = generateTimeSlots(session.startTime, session.endTime, duration, cat);
    categorySlots[cat] = [];

    catRawSlots.forEach((slot) => {
      totalSlots++;
      const key = `${session.id}_${slot.id}`;
      const legacyKey = cat === 'A' || cat === categories[0] ? `${session.id}_${slot.baseId}` : null;

      const booking = bookings[key] || (legacyKey ? bookings[legacyKey] : null);
      const isBlocked = Boolean(blockedSlots[key] || (legacyKey ? blockedSlots[legacyKey] : null));

      let enrichedSlot;
      if (booking) {
        bookedCount++;
        enrichedSlot = {
          ...slot,
          isBooked: true,
          isBlocked: false,
          booking: booking
        };
      } else if (isBlocked) {
        blockedCount++;
        enrichedSlot = {
          ...slot,
          isBooked: false,
          isBlocked: true,
          booking: null,
          blockedInfo: blockedSlots[key] || (legacyKey ? blockedSlots[legacyKey] : null)
        };
      } else {
        enrichedSlot = {
          ...slot,
          isBooked: false,
          isBlocked: false,
          booking: null
        };
      }

      categorySlots[cat].push(enrichedSlot);
      allSlots.push(enrichedSlot);
    });
  });

  const slotsToReturn = selectedCategory && categorySlots[selectedCategory]
    ? categorySlots[selectedCategory]
    : allSlots;

  return {
    ...session,
    categories,
    slotDuration: duration,
    slots: slotsToReturn,
    allSlots: allSlots,
    categorySlots: categorySlots,
    totalSlots: totalSlots,
    bookedCount: bookedCount,
    blockedCount: blockedCount,
    availableCount: Math.max(0, totalSlots - bookedCount - blockedCount),
    percentBooked: totalSlots > 0 ? Math.round((bookedCount / totalSlots) * 100) : 0
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

export function createNewSession({
  title,
  date,
  startTime = '09:00',
  endTime = '16:00',
  slotDuration = 15,
  timezone = 'EST',
  description = '',
  meetingLink = '',
  categories = ['A', 'B', 'C']
}) {
  const sessions = getRawSessions();
  const id = generateSessionId();
  const validCategories = Array.isArray(categories) && categories.length > 0
    ? categories.map((c) => c.trim()).filter(Boolean)
    : ['A', 'B', 'C'];

  const newSession = {
    id,
    title: title.trim(),
    date,
    startTime,
    endTime,
    slotDuration: Number(slotDuration) || 15,
    timezone,
    description: description.trim(),
    meetingLink: (meetingLink || '').trim(),
    categories: validCategories,
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
    details: `Created session on ${date} (${startTime}–${endTime}, ${newSession.slotDuration}m slots, ${validCategories.length} categories: ${validCategories.join(', ')})`
  });

  broadcast('SESSION_CREATED', { session: newSession });
  return newSession;
}

export function updateSessionCategories(sessionId, categories) {
  const sessions = getRawSessions();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index === -1) return { success: false, error: 'Session not found.' };

  const validCategories = Array.isArray(categories) && categories.length > 0
    ? categories.map((c) => c.trim()).filter(Boolean)
    : ['A', 'B', 'C'];

  sessions[index] = {
    ...sessions[index],
    categories: validCategories,
    updatedAt: new Date().toISOString()
  };

  saveRawSessions(sessions);

  if (isFirebaseConfigured() && db) {
    setDoc(doc(db, 'sessions', sessionId), sessions[index], { merge: true }).catch((err) => {
      console.warn('Could not sync updated categories to Firestore:', err);
    });
  }

  logActivityEvent({
    type: 'SESSION_UPDATED',
    sessionId,
    sessionTitle: sessions[index].title,
    actor: 'Admin',
    details: `Updated session categories: ${validCategories.join(', ')}`
  });

  broadcast('SESSION_UPDATED', { sessionId, session: sessions[index] });
  return { success: true, session: sessions[index] };
}

export function updateSessionMeetingLink(sessionId, meetingLink) {
  const sessions = getRawSessions();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index === -1) return { success: false, error: 'Session not found.' };

  const cleanLink = (meetingLink || '').trim();
  sessions[index] = {
    ...sessions[index],
    meetingLink: cleanLink,
    updatedAt: new Date().toISOString()
  };

  saveRawSessions(sessions);

  if (isFirebaseConfigured() && db) {
    setDoc(doc(db, 'sessions', sessionId), sessions[index], { merge: true }).catch((err) => {
      console.warn('Could not sync updated session meeting link to Firestore:', err);
    });
  }

  logActivityEvent({
    type: 'SESSION_UPDATED',
    sessionId,
    sessionTitle: sessions[index].title,
    actor: 'Admin',
    details: cleanLink ? `Configured Zoom/video meeting link: ${cleanLink}` : 'Removed meeting link'
  });

  broadcast('SESSION_UPDATED', { sessionId, session: sessions[index] });
  return { success: true, session: sessions[index] };
}

export function updateSessionDescription(sessionId, description) {
  const sessions = getRawSessions();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index === -1) return { success: false, error: 'Session not found.' };

  const cleanDesc = (description || '').trim();
  sessions[index] = {
    ...sessions[index],
    description: cleanDesc,
    updatedAt: new Date().toISOString()
  };

  saveRawSessions(sessions);

  if (isFirebaseConfigured() && db) {
    setDoc(doc(db, 'sessions', sessionId), sessions[index], { merge: true }).catch((err) => {
      console.warn('Could not sync updated session description to Firestore:', err);
    });
  }

  logActivityEvent({
    type: 'SESSION_UPDATED',
    sessionId,
    sessionTitle: sessions[index].title,
    actor: 'Admin',
    details: cleanDesc ? `Updated candidate instructions/description` : 'Cleared candidate instructions'
  });

  broadcast('SESSION_UPDATED', { sessionId, session: sessions[index] });
  return { success: true, session: sessions[index] };
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
    slotChangeCount: existing?.slotChangeCount !== undefined ? existing.slotChangeCount : 0,
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
    editCount: attendeeRecord.editCount,
    slotChangeCount: attendeeRecord.slotChangeCount
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
    sessionTitle: session?.title || 'Session',
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
// Slot Change & 3-Hour Cutoff Verification
// -------------------------------------------------------------

export function checkSlotChangeEligibility(sessionId, slotId, participantProfile) {
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const attendees = getRawAttendees();

  const normalizedEmail = (participantProfile?.email || '').toLowerCase();
  const normalizedContact = (participantProfile?.contact || '').toLowerCase();
  const normalizedName = (participantProfile?.name || '').toLowerCase();

  const attKey = `${sessionId}_${normalizedEmail || normalizedContact || normalizedName}`;
  const attendee = attendees[attKey];

  const changeCount = attendee?.slotChangeCount !== undefined
    ? attendee.slotChangeCount
    : (participantProfile?.slotChangeCount !== undefined ? participantProfile.slotChangeCount : 0);

  // Rule 1: Maximum 1 Slot Change per session
  if (changeCount >= 1) {
    return {
      canChange: false,
      reason: 'max_changes_reached',
      message: 'You have already changed your slot once. Each candidate is permitted to change their booking only once.',
      changeCount,
      remainingChanges: 0
    };
  }

  // Rule 2: Minimum 3 Hours Before Meeting Start Time
  if (session && slotId) {
    const isWithin3Hours = isSlotWithinCutoff(session.date, slotId, 3);
    const hoursRemaining = getHoursUntilSlot(session.date, slotId);

    if (isWithin3Hours) {
      if (hoursRemaining <= 0) {
        return {
          canChange: false,
          reason: 'meeting_started',
          message: 'This session time has already started or passed. Bookings cannot be modified after the scheduled start time.',
          changeCount,
          remainingChanges: 1,
          hoursRemaining
        };
      }

      const totalMins = Math.max(1, Math.round(hoursRemaining * 60));
      const h = Math.floor(totalMins / 60);
      const m = totalMins % 60;
      const timeLeftStr = h > 0 ? `${h}h ${m > 0 ? `${m}m` : ''}` : `${m} min`;

      return {
        canChange: false,
        reason: 'within_cutoff',
        message: `Slot changes and cancellations must be made at least 3 hours before your scheduled time. There is only ${timeLeftStr} remaining until this session.`,
        changeCount,
        remainingChanges: 1,
        hoursRemaining
      };
    }
  }

  return {
    canChange: true,
    reason: 'eligible',
    message: 'You are eligible to change your slot once (must be completed at least 3 hours before the session).',
    changeCount,
    remainingChanges: 1
  };
}

// -------------------------------------------------------------
// Slot Booking (Atomic Transaction, 1 Slot Limit, Concurrency Shield)
// -------------------------------------------------------------

export async function bookSlot(sessionId, slotId, { candidateName, candidateContact, candidateCategory = 'A', candidateEmail = '', candidatePhone = '' }) {
  const bookings = getRawBookings();

  // Guard: Single booking per candidate (check existing bookings in session)
  const normalizedName = candidateName.trim().toLowerCase();
  const normalizedContact = candidateContact.trim().toLowerCase();
  const normalizedEmail = candidateEmail.trim().toLowerCase();

  for (const [key, b] of Object.entries(bookings)) {
    if (key.startsWith(`${sessionId}_`)) {
      if (
        (normalizedEmail && b.candidateEmail && b.candidateEmail.toLowerCase() === normalizedEmail) ||
        (b.candidateContact && b.candidateContact.toLowerCase() === normalizedContact) ||
        (b.candidateName && b.candidateName.toLowerCase() === normalizedName)
      ) {
        return {
          success: false,
          alreadyReserved: true,
          error: `You already have an active reserved slot in this session. Each candidate may only book one slot. Please use Change Slot if you wish to choose a different time.`
        };
      }
    }
  }

  const blockedSlots = getRawBlockedSlots();
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const key = `${sessionId}_${slotId}`;

  // Client-side quick validation
  if (blockedSlots[key]) {
    return {
      success: false,
      conflict: true,
      error: 'This time slot has been marked unavailable by the session administrator.'
    };
  }

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

  const attKey = `${sessionId}_${(candidateEmail || candidateContact || candidateName).toLowerCase().trim()}`;
  const attendees = getRawAttendees();
  let attendeeRecord = attendees[attKey];
  if (attendeeRecord) {
    attendeeRecord = {
      ...attendeeRecord,
      status: 'booked',
      bookedSlotId: slotId,
      lastSeenAt: new Date().toISOString()
    };
  }

  // ATOMIC FIRESTORE TRANSACTION (Guarantees zero double-bookings under concurrent traffic)
  if (isFirebaseConfigured() && db) {
    try {
      await runTransaction(db, async (transaction) => {
        const bookingDocRef = doc(db, 'bookings', key);
        const blockedDocRef = doc(db, 'blocked_slots', key);

        const [bookingSnap, blockedSnap] = await Promise.all([
          transaction.get(bookingDocRef),
          transaction.get(blockedDocRef)
        ]);

        if (blockedSnap.exists()) {
          throw new Error('This time slot has been marked unavailable by the session administrator.');
        }

        if (bookingSnap.exists()) {
          const existingData = bookingSnap.data();
          throw new Error(`This slot was just reserved by ${existingData.candidateName || 'another participant'}. Please select another time.`);
        }

        transaction.set(bookingDocRef, bookingRecord);

        if (attendeeRecord) {
          const attendeeDocRef = doc(db, 'attendees', attKey);
          transaction.set(attendeeDocRef, attendeeRecord, { merge: true });
        }
      });
    } catch (err) {
      console.warn('Firestore booking transaction rejected:', err);
      logActivityEvent({
        type: 'BOOKING_CONFLICT',
        sessionId: sessionId,
        sessionTitle: session?.title || 'Session',
        actor: candidateName,
        details: `Concurrent booking collision detected on slot ${slotId}`
      });
      return {
        success: false,
        conflict: true,
        error: err.message || 'This slot is no longer available. Please choose a different time.'
      };
    }
  }

  // Commit locally
  bookings[key] = bookingRecord;
  saveRawBookings(bookings);

  if (attendeeRecord) {
    attendees[attKey] = attendeeRecord;
    saveRawAttendees(attendees);
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

// -------------------------------------------------------------
// Reschedule / Change Slot (Atomic 2-Doc Transaction & Limits)
// -------------------------------------------------------------

export async function rescheduleBooking(sessionId, oldSlotId, newSlotId, candidateProfile) {
  // Check eligibility on old slot
  const eligibility = checkSlotChangeEligibility(sessionId, oldSlotId, candidateProfile);
  if (!eligibility.canChange) {
    return {
      success: false,
      error: eligibility.message,
      reason: eligibility.reason
    };
  }

  const bookings = getRawBookings();
  const blockedSlots = getRawBlockedSlots();
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const newKey = `${sessionId}_${newSlotId}`;
  const oldKey = `${sessionId}_${oldSlotId}`;

  // Check if new slot is blocked or already taken locally
  if (blockedSlots[newKey]) {
    return {
      success: false,
      error: 'The selected new time slot has been marked unavailable by the session administrator.'
    };
  }

  if (bookings[newKey]) {
    return {
      success: false,
      error: `The slot was just taken by another candidate (${bookings[newKey].candidateName}). Please pick another available time.`
    };
  }

  const oldBooking = bookings[oldKey];
  const candidateName = candidateProfile.name || oldBooking?.candidateName || '';
  const candidateEmail = candidateProfile.email || oldBooking?.candidateEmail || '';
  const candidatePhone = candidateProfile.phone || oldBooking?.candidatePhone || '';
  const candidateContact = candidateProfile.contact || oldBooking?.candidateContact || '';
  const candidateCategory = candidateProfile.category || oldBooking?.candidateCategory || 'A';

  const newBookingRecord = {
    sessionId,
    slotId: newSlotId,
    candidateName: candidateName.trim(),
    candidateContact: candidateContact.trim(),
    candidateCategory: candidateCategory || 'A',
    candidateEmail: candidateEmail.trim(),
    candidatePhone: candidatePhone.trim(),
    bookedAt: new Date().toISOString(),
    rescheduledFrom: oldSlotId,
    rescheduledAt: new Date().toISOString()
  };

  const attendees = getRawAttendees();
  const attKey = `${sessionId}_${(candidateEmail || candidateContact || candidateName).toLowerCase().trim()}`;
  const nextSlotChangeCount = (eligibility.changeCount || 0) + 1;
  let attendeeRecord = attendees[attKey];

  if (attendeeRecord) {
    attendeeRecord = {
      ...attendeeRecord,
      status: 'booked',
      bookedSlotId: newSlotId,
      slotChangeCount: nextSlotChangeCount,
      lastSeenAt: new Date().toISOString()
    };
  }

  const updatedProfile = {
    ...candidateProfile,
    slotChangeCount: nextSlotChangeCount
  };

  // ATOMIC FIRESTORE RESCHEDULE TRANSACTION (Delete old + Insert new in single atomic commit)
  if (isFirebaseConfigured() && db) {
    try {
      await runTransaction(db, async (transaction) => {
        const oldDocRef = doc(db, 'bookings', oldKey);
        const newDocRef = doc(db, 'bookings', newKey);
        const blockedDocRef = doc(db, 'blocked_slots', newKey);

        const [newSnap, blockedSnap] = await Promise.all([
          transaction.get(newDocRef),
          transaction.get(blockedDocRef)
        ]);

        if (blockedSnap.exists()) {
          throw new Error('The selected new time slot has been marked unavailable.');
        }

        if (newSnap.exists()) {
          const existing = newSnap.data();
          throw new Error(`The slot was just taken by another candidate (${existing.candidateName || 'another participant'}). Please pick another available time.`);
        }

        transaction.delete(oldDocRef);
        transaction.set(newDocRef, newBookingRecord);

        if (attendeeRecord) {
          const attendeeDocRef = doc(db, 'attendees', attKey);
          transaction.set(attendeeDocRef, attendeeRecord, { merge: true });
        }
      });
    } catch (err) {
      console.warn('Firestore reschedule transaction failed:', err);
      return {
        success: false,
        error: err.message || 'Failed to switch time slot. The new slot might be taken.'
      };
    }
  }

  // Commit locally
  delete bookings[oldKey];
  bookings[newKey] = newBookingRecord;
  saveRawBookings(bookings);

  if (attendeeRecord) {
    attendees[attKey] = attendeeRecord;
    saveRawAttendees(attendees);
  }
  saveParticipantProfile(sessionId, updatedProfile);

  logActivityEvent({
    type: 'SLOT_RESCHEDULED',
    sessionId,
    sessionTitle: session?.title || 'Session',
    actor: candidateName.trim(),
    details: `Rescheduled slot from ${oldSlotId} to ${newSlotId} [Slot Change 1/1 Used]`
  });

  broadcast('SLOT_BOOKED', { sessionId, slotId: newSlotId, booking: newBookingRecord });
  broadcast('SLOT_CANCELLED', { sessionId, slotId: oldSlotId });
  broadcast('PARTICIPANT_UPDATED', { sessionId, profile: updatedProfile });

  return {
    success: true,
    booking: newBookingRecord,
    updatedProfile
  };
}

export async function cancelBooking(sessionId, slotId, candidateProfile = null, isCandidateAction = false) {
  if (isCandidateAction && candidateProfile) {
    const eligibility = checkSlotChangeEligibility(sessionId, slotId, candidateProfile);
    if (!eligibility.canChange) {
      return {
        success: false,
        error: eligibility.message,
        reason: eligibility.reason
      };
    }
  }

  const bookings = getRawBookings();
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  
  let key = `${sessionId}_${slotId}`;
  let removedBooking = bookings[key];

  // Resilient multi-category and legacy key matching
  if (!removedBooking) {
    const matchedKey = Object.keys(bookings).find((k) => {
      if (!k.startsWith(`${sessionId}_`)) return false;
      const b = bookings[k];
      if (k === `${sessionId}_${slotId}`) return true;
      if (k.endsWith(slotId)) return true;
      if (slotId && k.includes(slotId)) return true;
      if (b && b.slotId === slotId) return true;
      return false;
    });
    if (matchedKey) {
      key = matchedKey;
      removedBooking = bookings[matchedKey];
    }
  }

  if (!removedBooking) {
    return { success: false, error: 'Booking not found.' };
  }

  delete bookings[key];
  saveRawBookings(bookings);

  // Revert attendee status
  const attendees = getRawAttendees();
  const rawEmail = (removedBooking.candidateEmail || '').trim().toLowerCase();
  const rawContact = (removedBooking.candidateContact || '').trim().toLowerCase();
  const rawName = (removedBooking.candidateName || '').trim().toLowerCase();

  // Find attendee record across all possible key formats
  let attKey = `${sessionId}_${rawEmail || rawContact || rawName}`;
  if (!attendees[attKey]) {
    const foundKey = Object.keys(attendees).find((k) => {
      if (!k.startsWith(`${sessionId}_`)) return false;
      const att = attendees[k];
      if (rawEmail && att.email && att.email.toLowerCase() === rawEmail) return true;
      if (rawContact && att.contact && att.contact.toLowerCase().includes(rawContact)) return true;
      if (rawName && att.name && att.name.toLowerCase() === rawName) return true;
      return false;
    });
    if (foundKey) {
      attKey = foundKey;
    }
  }
  
  if (attendees[attKey]) {
    attendees[attKey].status = 'checked_in';
    attendees[attKey].bookedSlotId = null;
    attendees[attKey].isBooked = false;
    if (isCandidateAction) {
      attendees[attKey].slotChangeCount = (attendees[attKey].slotChangeCount || 0) + 1;
    }
    saveRawAttendees(attendees);

    if (candidateProfile) {
      const updatedProf = {
        ...candidateProfile,
        slotChangeCount: attendees[attKey].slotChangeCount
      };
      saveParticipantProfile(sessionId, updatedProf);
    }
  }

  // Firestore sync
  if (isFirebaseConfigured() && db) {
    try {
      await deleteDoc(doc(db, 'bookings', key));
      if (attendees[attKey]) {
        await setDoc(doc(db, 'attendees', attKey), attendees[attKey], { merge: true });
      }
    } catch (err) {
      console.warn('Could not delete booking from Firestore:', err);
    }
  }

  logActivityEvent({
    type: 'SLOT_CANCELLED',
    sessionId: sessionId,
    sessionTitle: session?.title || 'Session',
    actor: removedBooking.candidateName,
    details: `Cancelled booking (${removedBooking.candidateContact})${isCandidateAction ? ' [Slot Change 1/1 Used]' : ''}`
  });

  broadcast('SLOT_CANCELLED', { sessionId, slotId, removedBooking });
  broadcast('SESSION_DATA_SYNC', { sessionId, type: 'CANCELLED' });
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
    const slotId = booking.slotId || slotParts.join('_');
    const session = sessionMap[sessionId];

    if (session) {
      const category = booking.candidateCategory || 'A';
      const slots = generateTimeSlots(session.startTime, session.endTime, session.slotDuration || 15, category);
      const matchedSlot = slots.find((sl) => sl.id === slotId || sl.baseId === slotId || key.endsWith(sl.id));

      candidateList.push({
        id: key,
        candidateName: booking.candidateName,
        candidateCategory: category,
        candidateEmail: booking.candidateEmail || '',
        candidatePhone: booking.candidatePhone || '',
        candidateContact: booking.candidateContact,
        bookedAt: booking.bookedAt,
        sessionId: session.id,
        sessionTitle: session.title,
        sessionDate: session.date,
        slotTimeLabel: matchedSlot ? matchedSlot.timeLabel : (booking.slotTimeLabel || 'Scheduled Time'),
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

  const newName = (newProfile.name || '').trim();
  const newCategory = newProfile.category || 'A';
  const newEmail = (newProfile.email || '').trim();
  const newPhone = (newProfile.phone || '').trim();
  const newContact = (newProfile.contact || (newEmail && newPhone ? `${newEmail} • ${newPhone}` : newEmail || newPhone)).trim();
  const nextEditCount = currentEdits + 1;

  const oldName = oldProfile?.name ? oldProfile.name.trim() : '';
  const oldEmail = oldProfile?.email ? oldProfile.email.trim() : '';
  const oldContact = oldProfile?.contact ? oldProfile.contact.trim() : '';

  // Look up existing attendee first
  const attendees = getRawAttendees();
  const oldKey = `${sessionId}_${(oldEmail || oldContact).toLowerCase()}`;
  const newKey = `${sessionId}_${(newEmail || newContact).toLowerCase()}`;

  let existingAtt = null;
  if (attendees[sessionId] && Array.isArray(attendees[sessionId])) {
    existingAtt = attendees[sessionId].find(
      (a) => (oldEmail && a.email?.toLowerCase() === oldEmail.toLowerCase()) ||
             (oldContact && a.contact?.toLowerCase() === oldContact.toLowerCase()) ||
             (oldName && a.name?.toLowerCase() === oldName.toLowerCase())
    );
  } else {
    existingAtt = attendees[oldKey] || attendees[newKey];
  }

  const slotChangeCount = existingAtt?.slotChangeCount !== undefined
    ? existingAtt.slotChangeCount
    : (oldProfile?.slotChangeCount !== undefined ? oldProfile.slotChangeCount : 0);

  const profileRecord = {
    name: newName,
    category: newCategory,
    email: newEmail,
    phone: newPhone,
    contact: newContact,
    editCount: nextEditCount,
    slotChangeCount: slotChangeCount,
    isTester: Boolean(oldProfile?.isTester || newProfile?.isTester)
  };

  // Update localStorage profile
  saveParticipantProfile(sessionId, profileRecord);

  // Update attendees list
  if (existingAtt) {
    if (attendees[sessionId] && Array.isArray(attendees[sessionId])) {
      attendees[sessionId] = attendees[sessionId].map((a) => {
        if (a === existingAtt || a.id === existingAtt.id) {
          return {
            ...a,
            name: newName,
            category: newCategory,
            email: newEmail,
            phone: newPhone,
            contact: newContact,
            editCount: nextEditCount,
            slotChangeCount: a.slotChangeCount !== undefined ? a.slotChangeCount : slotChangeCount,
            lastSeenAt: new Date().toISOString()
          };
        }
        return a;
      });
    } else {
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
        slotChangeCount: existingAtt.slotChangeCount !== undefined ? existingAtt.slotChangeCount : slotChangeCount,
        lastSeenAt: new Date().toISOString()
      };
    }
    saveRawAttendees(attendees);

    if (isFirebaseConfigured() && db) {
      if (oldKey !== newKey) {
        deleteDoc(doc(db, 'attendees', oldKey)).catch(() => {});
      }
      setDoc(doc(db, 'attendees', newKey), { ...profileRecord, sessionId, lastSeenAt: new Date().toISOString() }, { merge: true }).catch(() => {});
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
    sessionTitle: session?.title || 'Session',
    actor: newName,
    details: `Updated info (Category ${newCategory}, ${newEmail}, ${newPhone}) [Edit ${nextEditCount}/2]`
  });

  broadcast('PARTICIPANT_UPDATED', { sessionId, profile: profileRecord });

  return profileRecord;
}

// -------------------------------------------------------------
// Invisible Tester Sandbox Engine
// -------------------------------------------------------------

export function isTesterAccount(profile) {
  if (!profile) return false;
  if (profile.isTester) return true;
  const email = (profile.email || '').toLowerCase();
  const contact = (profile.contact || '').toLowerCase();
  const name = (profile.name || '').toLowerCase();
  return (
    email.includes('tester@') ||
    email.includes('.internal') ||
    email.includes('test') ||
    contact.includes('tester') ||
    name.includes('[test') ||
    name.includes('qa tester')
  );
}

/**
 * Resets all bookings and change limits for a tester account in a session
 */
export async function resetTesterSessionState(sessionId, candidateIdentifier) {
  if (!sessionId) return { success: false };

  const idLower = (candidateIdentifier || '').toLowerCase();
  const bookings = getRawBookings();
  const keysToDelete = [];

  Object.keys(bookings).forEach((key) => {
    if (key.startsWith(`${sessionId}_`)) {
      const b = bookings[key];
      const bEmail = (b.candidateEmail || '').toLowerCase();
      const bContact = (b.candidateContact || '').toLowerCase();
      const bName = (b.candidateName || '').toLowerCase();
      if (
        (idLower && (bEmail === idLower || bContact.includes(idLower) || bName.includes(idLower))) ||
        b.isTester ||
        bEmail.includes('.internal') ||
        bEmail.includes('tester@')
      ) {
        keysToDelete.push(key);
      }
    }
  });

  keysToDelete.forEach((k) => {
    delete bookings[k];
  });
  saveRawBookings(bookings);

  // Firestore sync removal if online
  if (isFirestoreConfigured()) {
    try {
      for (const k of keysToDelete) {
        await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.BOOKINGS, k));
      }
    } catch (e) {
      console.warn('Firestore tester cleanup error:', e);
    }
  }

  // Reset attendee change limit
  const attendees = getRawAttendees();
  if (attendees[sessionId]) {
    attendees[sessionId] = attendees[sessionId].map((att) => {
      const aEmail = (att.email || '').toLowerCase();
      const aContact = (att.contact || '').toLowerCase();
      if (
        (idLower && (aEmail === idLower || aContact.includes(idLower))) ||
        att.isTester ||
        aEmail.includes('.internal')
      ) {
        return {
          ...att,
          slotChangeCount: 0,
          editCount: 0,
          isBooked: false,
          bookedSlot: null
        };
      }
      return att;
    });
    saveRawAttendees(attendees);
  }

  // Broadcast sync
  broadcast('SESSION_DATA_SYNC', { sessionId, type: 'TESTER_RESET' });

  return { success: true };
}

/**
 * Reset slot change counter for testing slot rescheduling unlimited times
 */
export function resetTesterSlotChangeLimit(sessionId, candidateIdentifier) {
  if (!sessionId) return { success: false };

  const idLower = (candidateIdentifier || '').toLowerCase();
  const attendees = getRawAttendees();

  if (attendees[sessionId]) {
    attendees[sessionId] = attendees[sessionId].map((att) => {
      const aEmail = (att.email || '').toLowerCase();
      const aContact = (att.contact || '').toLowerCase();
      if (
        (idLower && (aEmail === idLower || aContact.includes(idLower))) ||
        att.isTester ||
        aEmail.includes('.internal')
      ) {
        return {
          ...att,
          slotChangeCount: 0
        };
      }
      return att;
    });
    saveRawAttendees(attendees);
  }

  broadcast('SESSION_DATA_SYNC', { sessionId, type: 'LIMIT_RESET' });
  return { success: true };
}



