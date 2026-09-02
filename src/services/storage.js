import {
  generateTimeSlots,
  generateSessionId,
  isSlotWithinCutoff,
  getHoursUntilSlot,
  formatTimeUntilMeeting,
  matchCategory,
  resolveCategoryInSession,
  formatCategoryName,
  getCanonicalCategorySlug,
  parseSlotId,
  minutesTo12Hour
} from './timeUtils';
import { db, auth, isFirebaseConfigured, ensureFirebaseAuth } from './firebase';

// Automatically ensure Firebase anonymous auth session on startup
if (isFirebaseConfigured()) {
  ensureFirebaseAuth().catch(() => {});
}
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  runTransaction,
  onSnapshot,
  query,
  where
} from 'firebase/firestore';
import {
  signInWithEmailAndPassword,
  signOut,
  signInAnonymously
} from 'firebase/auth';

const SESSIONS_KEY = 'viewme_sessions_v2';
const DELETED_SESSIONS_KEY = 'viewme_deleted_sessions_v2';
const BOOKINGS_KEY = 'viewme_bookings_v2';
const ATTENDEES_KEY = 'viewme_attendees_v2';
const BLOCKED_SLOTS_KEY = 'viewme_blocked_slots_v2';
const EVENTS_KEY = 'viewme_activity_events_v2';
const ADMIN_AUTH_KEY = 'viewme_admin_auth_v2';
const PARTICIPANT_KEY = 'viewme_participant_profile_v2';

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

// Active scoped Firestore listener unsubscribers
const activeListeners = new Map();

/**
 * Scoped real-time listener for a specific session.
 * Minimizes Firestore read quota usage by only subscribing to documents for this sessionId.
 */
export function subscribeToSessionSync(sessionId, callback) {
  if (!sessionId) return () => {};

  // Local broadcast listener
  let localHandler = null;
  if (syncChannel) {
    localHandler = (event) => {
      if (event.data) {
        callback(event.data);
      }
    };
    syncChannel.addEventListener('message', localHandler);
  }

  const unsubs = [];

  if (isFirebaseConfigured() && db) {
    try {
      // 1. Session Document Listener
      const unsubSession = onSnapshot(doc(db, 'sessions', sessionId), (snap) => {
        if (snap.exists()) {
          const sessionData = snap.data();
          const sessions = getRawSessions();
          const idx = sessions.findIndex((s) => s.id === sessionId);
          if (idx >= 0) sessions[idx] = sessionData;
          else sessions.unshift(sessionData);
          saveRawSessions(sessions);
          callback({ type: 'SESSION_SYNCED', payload: { sessionId, session: sessionData } });
        }
      }, (err) => console.warn('Session listener warning:', err));
      unsubs.push(unsubSession);

      // 2. Scoped Bookings Listener
      const bookingsQuery = query(collection(db, 'bookings'), where('sessionId', '==', sessionId));
      const unsubBookings = onSnapshot(bookingsQuery, (snapshot) => {
        const bookings = getRawBookings();
        Object.keys(bookings).forEach((k) => {
          if (k.startsWith(`${sessionId}_`)) delete bookings[k];
        });
        snapshot.forEach((d) => {
          bookings[d.id] = d.data();
        });
        saveRawBookings(bookings);
        callback({ type: 'BOOKINGS_SYNCED', payload: { sessionId } });
      }, (err) => console.warn('Bookings listener warning:', err));
      unsubs.push(unsubBookings);

      // 3. Scoped Blocked Slots Listener
      const blockedQuery = query(collection(db, 'blocked_slots'), where('sessionId', '==', sessionId));
      const unsubBlocked = onSnapshot(blockedQuery, (snapshot) => {
        const blocked = getRawBlockedSlots();
        Object.keys(blocked).forEach((k) => {
          if (k.startsWith(`${sessionId}_`)) delete blocked[k];
        });
        snapshot.forEach((d) => {
          blocked[d.id] = d.data();
        });
        saveRawBlockedSlots(blocked);
        callback({ type: 'BLOCKED_SYNCED', payload: { sessionId } });
      }, (err) => console.warn('Blocked slots listener warning:', err));
      unsubs.push(unsubBlocked);

      // 4. Scoped Attendees Listener
      const attendeesQuery = query(collection(db, 'attendees'), where('sessionId', '==', sessionId));
      const unsubAttendees = onSnapshot(attendeesQuery, (snapshot) => {
        const attendees = getRawAttendees();
        Object.keys(attendees).forEach((k) => {
          if (k.startsWith(`${sessionId}_`)) delete attendees[k];
        });
        snapshot.forEach((d) => {
          attendees[d.id] = d.data();
        });
        saveRawAttendees(attendees);
        callback({ type: 'ATTENDEES_SYNCED', payload: { sessionId } });
      }, (err) => console.warn('Attendees listener warning:', err));
      unsubs.push(unsubAttendees);
    } catch (err) {
      console.warn('Error starting scoped session sync:', err);
    }
  }

  return () => {
    if (syncChannel && localHandler) {
      syncChannel.removeEventListener('message', localHandler);
    }
    unsubs.forEach((u) => {
      try { u(); } catch (_) {}
    });
  };
}

/**
 * Admin dashboard sync listener. Active when admin is viewing dashboard or candidate directory.
 * Syncs all sessions, bookings, blocked slots, attendees, and events in real time.
 */
export function subscribeToAdminSync(callback) {
  let localHandler = null;
  if (syncChannel) {
    localHandler = (event) => {
      if (event.data) callback(event.data);
    };
    syncChannel.addEventListener('message', localHandler);
  }

  const unsubs = [];

  if (isFirebaseConfigured() && db) {
    try {
      // 1. All Sessions
      const unsubSessions = onSnapshot(collection(db, 'sessions'), (snapshot) => {
        const remoteSessions = [];
        snapshot.forEach((d) => remoteSessions.push(d.data()));
        const merged = mergeRemoteSessions(remoteSessions);
        callback({ type: 'SESSIONS_SYNCED', payload: { sessions: merged } });
      }, (err) => console.warn('Admin sessions sync warning:', err));
      unsubs.push(unsubSessions);

      // 2. All Bookings (Critical for accurate slot occupancy, stats, candidate lists)
      const unsubBookings = onSnapshot(collection(db, 'bookings'), (snapshot) => {
        const bookings = {};
        snapshot.forEach((d) => {
          bookings[d.id] = d.data();
        });
        const merged = mergeRemoteBookings(bookings, true);
        callback({ type: 'BOOKINGS_SYNCED', payload: { bookings: merged } });
      }, (err) => console.warn('Admin bookings sync warning:', err));
      unsubs.push(unsubBookings);

      // 3. All Blocked Slots
      const unsubBlocked = onSnapshot(collection(db, 'blocked_slots'), (snapshot) => {
        const blocked = {};
        snapshot.forEach((d) => {
          blocked[d.id] = d.data();
        });
        const merged = mergeRemoteBlockedSlots(blocked, true);
        callback({ type: 'BLOCKED_SYNCED', payload: { blocked: merged } });
      }, (err) => console.warn('Admin blocked slots sync warning:', err));
      unsubs.push(unsubBlocked);

      // 4. All Attendees (PII Protected - available when admin authenticated)
      const unsubAttendees = onSnapshot(collection(db, 'attendees'), (snapshot) => {
        const attendees = {};
        snapshot.forEach((d) => {
          attendees[d.id] = d.data();
        });
        const merged = mergeRemoteAttendees(attendees, true);
        callback({ type: 'ATTENDEES_SYNCED', payload: { attendees: merged } });
      }, (err) => {
        // Expected if unauthenticated
      });
      unsubs.push(unsubAttendees);

      // 5. All Events
      const unsubEvents = onSnapshot(collection(db, 'events'), (snapshot) => {
        const remoteEvents = [];
        snapshot.forEach((d) => remoteEvents.push(d.data()));
        const merged = mergeRemoteEvents(remoteEvents);
        callback({ type: 'EVENTS_SYNCED', payload: { events: merged } });
      }, (err) => {
        // Expected if unauthenticated
      });
      unsubs.push(unsubEvents);
    } catch (err) {
      console.warn('Error starting admin sync:', err);
    }
  }

  return () => {
    if (syncChannel && localHandler) {
      syncChannel.removeEventListener('message', localHandler);
    }
    unsubs.forEach((u) => {
      try { u(); } catch (_) {}
    });
  };
}

export function subscribeToSync(callback) {
  if (syncChannel) {
    const handler = (event) => {
      if (event.data) callback(event.data);
    };
    syncChannel.addEventListener('message', handler);
    return () => syncChannel.removeEventListener('message', handler);
  }
  return () => {};
}

/**
 * Explicit one-time remote fetch of all collections for admin
 */
export async function fetchAllRemoteAdminData() {
  if (isFirebaseConfigured() && db) {
    try {
      const [sessionsSnap, bookingsSnap, blockedSnap] = await Promise.all([
        getDocs(collection(db, 'sessions')),
        getDocs(collection(db, 'bookings')),
        getDocs(collection(db, 'blocked_slots'))
      ]);

      if (!sessionsSnap.empty) {
        const remoteSessions = [];
        sessionsSnap.forEach((d) => remoteSessions.push(d.data()));
        mergeRemoteSessions(remoteSessions);
      }

      if (!bookingsSnap.empty) {
        const bookings = {};
        bookingsSnap.forEach((d) => {
          bookings[d.id] = d.data();
        });
        mergeRemoteBookings(bookings, true);
      }

      if (!blockedSnap.empty) {
        const blocked = {};
        blockedSnap.forEach((d) => {
          blocked[d.id] = d.data();
        });
        mergeRemoteBlockedSlots(blocked, true);
      }

      try {
        const attendeesSnap = await getDocs(collection(db, 'attendees'));
        if (!attendeesSnap.empty) {
          const attendees = {};
          attendeesSnap.forEach((d) => {
            attendees[d.id] = d.data();
          });
          mergeRemoteAttendees(attendees, true);
        }
      } catch (_) {}

      try {
        const eventsSnap = await getDocs(collection(db, 'events'));
        if (!eventsSnap.empty) {
          const events = [];
          eventsSnap.forEach((d) => events.push(d.data()));
          mergeRemoteEvents(events);
        }
      } catch (_) {}
    } catch (err) {
      console.warn('Error fetching remote admin data:', err);
    }
  }
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
        getDocs(query(collection(db, 'bookings'), where('sessionId', '==', sessionId))),
        getDocs(query(collection(db, 'blocked_slots'), where('sessionId', '==', sessionId)))
      ]);

      const bookings = getRawBookings();
      Object.keys(bookings).forEach((k) => {
        if (k.startsWith(`${sessionId}_`)) delete bookings[k];
      });
      bookingsSnap.forEach((d) => {
        bookings[d.id] = d.data();
      });
      saveRawBookings(bookings);

      const blocked = getRawBlockedSlots();
      Object.keys(blocked).forEach((k) => {
        if (k.startsWith(`${sessionId}_`)) delete blocked[k];
      });
      blockedSnap.forEach((d) => {
        blocked[d.id] = d.data();
      });
      saveRawBlockedSlots(blocked);

      try {
        const attendeesSnap = await getDocs(query(collection(db, 'attendees'), where('sessionId', '==', sessionId)));
        const attendees = getRawAttendees();
        Object.keys(attendees).forEach((k) => {
          if (k.startsWith(`${sessionId}_`)) delete attendees[k];
        });
        attendeesSnap.forEach((d) => {
          attendees[d.id] = d.data();
        });
        saveRawAttendees(attendees);
      } catch (_) {}
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
  if (isFirebaseConfigured()) {
    return [];
  }
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

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
    }
  ];
}

function getInitialBookings() {
  return {};
}

function getInitialAttendees() {
  return {};
}

function getInitialEvents() {
  return [];
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

function getDeletedSessionIds() {
  const data = localStorage.getItem(DELETED_SESSIONS_KEY);
  if (!data) return new Set();
  try { return new Set(JSON.parse(data)); } catch { return new Set(); }
}

function addDeletedSessionId(id) {
  if (!id) return;
  const deleted = getDeletedSessionIds();
  deleted.add(id);
  localStorage.setItem(DELETED_SESSIONS_KEY, JSON.stringify(Array.from(deleted)));
}

function removeDeletedSessionId(id) {
  if (!id) return;
  const deleted = getDeletedSessionIds();
  if (deleted.has(id)) {
    deleted.delete(id);
    localStorage.setItem(DELETED_SESSIONS_KEY, JSON.stringify(Array.from(deleted)));
  }
}

export function mergeRemoteSessions(remoteSessions = []) {
  const deletedIds = getDeletedSessionIds();
  const localSessions = getRawSessions();
  const sessionMap = new Map();

  // 1. Keep local sessions that were not deleted
  localSessions.forEach((s) => {
    if (s && s.id && !deletedIds.has(s.id)) {
      sessionMap.set(s.id, s);
    }
  });

  // 2. Merge / overlay remote sessions
  remoteSessions.forEach((remoteS) => {
    if (remoteS && remoteS.id && !deletedIds.has(remoteS.id)) {
      sessionMap.set(remoteS.id, {
        ...(sessionMap.get(remoteS.id) || {}),
        ...remoteS
      });
    }
  });

  const merged = Array.from(sessionMap.values());
  saveRawSessions(merged);
  return merged;
}

export function mergeRemoteBookings(remoteBookings = {}, isFullSync = false) {
  const localBookings = getRawBookings();
  const merged = isFullSync ? { ...remoteBookings } : { ...localBookings, ...remoteBookings };
  saveRawBookings(merged);
  return merged;
}

export function mergeRemoteBlockedSlots(remoteBlocked = {}, isFullSync = false) {
  const localBlocked = getRawBlockedSlots();
  const merged = isFullSync ? { ...remoteBlocked } : { ...localBlocked, ...remoteBlocked };
  saveRawBlockedSlots(merged);
  return merged;
}

export function mergeRemoteAttendees(remoteAttendees = {}, isFullSync = false) {
  const localAttendees = getRawAttendees();
  const merged = isFullSync ? { ...remoteAttendees } : { ...localAttendees, ...remoteAttendees };
  saveRawAttendees(merged);
  return merged;
}

export function mergeRemoteEvents(remoteEvents = []) {
  const localEvents = getRawEvents();
  const eventMap = new Map();
  localEvents.forEach((e) => {
    if (e && e.id) eventMap.set(e.id, e);
  });
  remoteEvents.forEach((e) => {
    if (e && e.id) eventMap.set(e.id, e);
  });
  const merged = Array.from(eventMap.values());
  merged.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (merged.length > 500) merged.length = 500;
  saveRawEvents(merged);
  return merged;
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
// Admin Firebase Authentication
// -------------------------------------------------------------

export async function loginAdminWithFirebase(email, password) {
  const cleanEmail = (email || '').trim();
  const cleanPass = (password || '').trim();

  if (!cleanEmail || !cleanPass) {
    return { success: false, error: 'Email and password are required.' };
  }

  if (!isFirebaseConfigured() || !auth) {
    return { success: false, error: 'Firebase Auth is not initialized. Please verify configuration.' };
  }

  try {
    const userCred = await signInWithEmailAndPassword(auth, cleanEmail, cleanPass);
    const sessionToken = {
      authenticated: true,
      email: userCred.user?.email || cleanEmail,
      uid: userCred.user?.uid,
      timestamp: Date.now(),
      expiresAt: Date.now() + SESSION_AUTH_DURATION_MS,
      token: `viewme_adm_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`
    };
    localStorage.setItem(ADMIN_AUTH_KEY, JSON.stringify(sessionToken));

    logActivityEvent({
      type: 'ADMIN_LOGIN',
      actor: cleanEmail,
      details: 'Administrator successfully authenticated via Firebase'
    });

    broadcast('ADMIN_AUTH_CHANGED', { authenticated: true });
    return { success: true, email: cleanEmail, user: userCred.user };
  } catch (err) {
    console.error('Firebase Auth error:', err.code, err.message);
    let userMsg = 'Invalid email or password.';
    if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      userMsg = 'Invalid administrator email or password.';
    } else if (err.code === 'auth/too-many-requests') {
      userMsg = 'Access temporarily locked by Firebase due to multiple failed attempts. Please try again in a few minutes.';
    } else if (err.code === 'auth/network-request-failed') {
      userMsg = 'Network error. Please check your internet connection.';
    } else if (err.message) {
      userMsg = err.message;
    }
    return { success: false, error: userMsg };
  }
}

// Alias for backward compatibility
export async function verifyAdminPassword(inputPassword, inputEmail = '') {
  return loginAdminWithFirebase(inputEmail, inputPassword);
}

export function isSessionAdminAuthenticated() {
  if (auth && auth.currentUser) return true;
  const sessionAuth = localStorage.getItem(ADMIN_AUTH_KEY);
  if (!sessionAuth) return false;
  try {
    const parsed = JSON.parse(sessionAuth);
    if (parsed && parsed.authenticated) {
      if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
        localStorage.removeItem(ADMIN_AUTH_KEY);
        return false;
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function logoutAdmin() {
  localStorage.removeItem(ADMIN_AUTH_KEY);
  if (isFirebaseConfigured() && auth && auth.currentUser) {
    signOut(auth).catch(() => {});
  }
  logActivityEvent({
    type: 'ADMIN_LOGOUT',
    actor: 'Admin',
    details: 'Administrator logged out'
  });
  broadcast('ADMIN_AUTH_CHANGED', { authenticated: false });
}

// -------------------------------------------------------------
// Sessions & Bookings Management
// -------------------------------------------------------------

/**
 * Normalizes session days into a clean array of day definitions
 */
export function normalizeSessionDays(session) {
  if (!session) return [];
  if (session.days && Array.isArray(session.days) && session.days.length > 0) {
    return session.days.map((d, idx) => ({
      id: d.id || `day_${idx + 1}`,
      date: d.date || session.date || '',
      label: d.label || `Day ${idx + 1}`,
      startTime: d.startTime || session.startTime || '09:00',
      endTime: d.endTime || session.endTime || '16:00'
    }));
  }
  return [
    {
      id: 'day_1',
      date: session.date || '',
      label: 'Day 1',
      startTime: session.startTime || '09:00',
      endTime: session.endTime || '16:00'
    }
  ];
}

function findBookingForSlot(bookings, sessionId, slot, categoryName) {
  const canonicalKey = `${sessionId}_${slot.id}`;
  if (bookings[canonicalKey]) return bookings[canonicalKey];

  // Check by matching time, category, and day/date across all booking records for this session
  for (const [key, b] of Object.entries(bookings)) {
    if (!key.startsWith(`${sessionId}_`)) continue;
    if (!matchCategory(b.candidateCategory, categoryName)) continue;
    
    // Check if slotId or parsed slotId matches
    const parsed = parseSlotId(b.slotId, b.candidateCategory || categoryName);
    if (parsed) {
      if (parsed.canonicalId === slot.id || parsed.rawId === slot.id) {
        return b;
      }
      // If dayId is present on both, ensure dayId matches
      if (slot.dayId && parsed.dayId && slot.dayId !== parsed.dayId) {
        continue;
      }
      // If slotDate is present on both, ensure date matches
      if (slot.date && b.slotDate && slot.date !== b.slotDate) {
        continue;
      }
      if (parsed.startMinutes === slot.startMinutes && parsed.endMinutes === slot.endMinutes) {
        if (!slot.dayId || !parsed.dayId || slot.dayId === parsed.dayId) {
          return b;
        }
      }
    }
    // Check startMinutes if saved directly
    if (b.startMinutes !== undefined && b.startMinutes === slot.startMinutes) {
      if ((!slot.date || !b.slotDate || slot.date === b.slotDate) &&
          (!slot.dayId || !b.dayId || slot.dayId === b.dayId)) {
        return b;
      }
    }
  }

  // Legacy key check for default / first category
  const legacyKey = `${sessionId}_${slot.baseId}`;
  if (bookings[legacyKey] && matchCategory(bookings[legacyKey].candidateCategory, categoryName)) {
    return bookings[legacyKey];
  }

  return null;
}

function findBlockedForSlot(blockedSlots, sessionId, slot, categoryName) {
  const canonicalKey = `${sessionId}_${slot.id}`;
  if (blockedSlots[canonicalKey]) return blockedSlots[canonicalKey];

  for (const [key, blk] of Object.entries(blockedSlots)) {
    if (!key.startsWith(`${sessionId}_`)) continue;
    const parsed = parseSlotId(blk.slotId, categoryName);
    if (parsed) {
      if (parsed.canonicalId === slot.id || parsed.rawId === slot.id) {
        return blk;
      }
      if (slot.dayId && parsed.dayId && slot.dayId !== parsed.dayId) {
        continue;
      }
      if (parsed.startMinutes === slot.startMinutes && parsed.endMinutes === slot.endMinutes) {
        if (!slot.dayId || !parsed.dayId || slot.dayId === parsed.dayId) {
          return blk;
        }
      }
    }
  }

  const legacyKey = `${sessionId}_${slot.baseId}`;
  if (blockedSlots[legacyKey]) {
    return blockedSlots[legacyKey];
  }

  return null;
}

export function getAllSessions() {
  const sessions = getRawSessions();
  const bookings = getRawBookings();
  const blockedSlots = getRawBlockedSlots();

  return sessions.map((session) => {
    const duration = Number(session.slotDuration) || 15;
    const categories = session.categories && session.categories.length > 0 ? session.categories : ['Category A', 'Category B', 'Category C'];
    const days = normalizeSessionDays(session);
    const eventType = session.eventType || (days.length > 1 ? 'multi' : 'single');
    
    let totalSlots = 0;
    let bookedCount = 0;
    let blockedCount = 0;
    let attendedCount = 0;

    days.forEach((day) => {
      categories.forEach((cat) => {
        const slots = generateTimeSlots(
          day.startTime || session.startTime || '09:00',
          day.endTime || session.endTime || '16:00',
          duration,
          cat,
          days.length > 1 ? day : null
        );
        totalSlots += slots.length;
        slots.forEach((slot) => {
          const booking = findBookingForSlot(bookings, session.id, slot, cat);
          const isBlocked = Boolean(findBlockedForSlot(blockedSlots, session.id, slot, cat));
          if (booking) {
            bookedCount++;
            if (booking.attendanceStatus === 'attended') attendedCount++;
          } else if (isBlocked) {
            blockedCount++;
          }
        });
      });
    });

    return {
      ...session,
      eventType,
      days,
      date: session.date || days[0]?.date || '',
      categories,
      slotDuration: duration,
      totalSlots: totalSlots,
      bookedCount: bookedCount,
      blockedCount: blockedCount,
      attendedCount: attendedCount,
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
  const categories = session.categories && session.categories.length > 0 ? session.categories : ['Category A', 'Category B', 'Category C'];
  const days = normalizeSessionDays(session);
  const eventType = session.eventType || (days.length > 1 ? 'multi' : 'single');
  const isMultiDay = days.length > 1;

  const bookings = getRawBookings();
  const blockedSlots = getRawBlockedSlots();

  let totalSlots = 0;
  let bookedCount = 0;
  let blockedCount = 0;
  let attendedCount = 0;
  const allSlots = [];
  const categorySlots = {};
  const daySlots = {};

  days.forEach((day) => {
    daySlots[day.id] = { all: [] };
    categories.forEach((cat) => {
      daySlots[day.id][cat] = [];
    });
  });

  categories.forEach((cat) => {
    categorySlots[cat] = [];
  });

  days.forEach((day) => {
    categories.forEach((cat) => {
      const catRawSlots = generateTimeSlots(
        day.startTime || session.startTime || '09:00',
        day.endTime || session.endTime || '16:00',
        duration,
        cat,
        isMultiDay ? day : null
      );

      catRawSlots.forEach((slot) => {
        totalSlots++;
        const booking = findBookingForSlot(bookings, session.id, slot, cat);
        const blockedRecord = findBlockedForSlot(blockedSlots, session.id, slot, cat);

        let enrichedSlot;
        if (booking) {
          bookedCount++;
          if (booking.attendanceStatus === 'attended') attendedCount++;
          enrichedSlot = {
            ...slot,
            date: slot.date || day.date,
            dayId: slot.dayId || day.id,
            dayLabel: slot.dayLabel || day.label,
            isBooked: true,
            isBlocked: false,
            booking: {
              ...booking,
              slotDate: booking.slotDate || slot.date || day.date,
              dayId: booking.dayId || slot.dayId || day.id,
              candidateCategory: cat,
              attendanceStatus: booking.attendanceStatus || 'not_marked'
            }
          };
        } else if (blockedRecord) {
          blockedCount++;
          enrichedSlot = {
            ...slot,
            date: slot.date || day.date,
            dayId: slot.dayId || day.id,
            dayLabel: slot.dayLabel || day.label,
            isBooked: false,
            isBlocked: true,
            booking: null,
            blockedInfo: blockedRecord
          };
        } else {
          enrichedSlot = {
            ...slot,
            date: slot.date || day.date,
            dayId: slot.dayId || day.id,
            dayLabel: slot.dayLabel || day.label,
            isBooked: false,
            isBlocked: false,
            booking: null
          };
        }

        categorySlots[cat].push(enrichedSlot);
        allSlots.push(enrichedSlot);

        if (daySlots[day.id]) {
          daySlots[day.id].all.push(enrichedSlot);
          if (daySlots[day.id][cat]) {
            daySlots[day.id][cat].push(enrichedSlot);
          }
        }
      });
    });
  });

  const resolvedCategory = selectedCategory ? resolveCategoryInSession(categories, selectedCategory) : null;
  const slotsToReturn = resolvedCategory && categorySlots[resolvedCategory]
    ? categorySlots[resolvedCategory]
    : allSlots;

  return {
    ...session,
    eventType,
    days,
    date: session.date || days[0]?.date || '',
    categories,
    slotDuration: duration,
    slots: slotsToReturn,
    allSlots: allSlots,
    categorySlots: categorySlots,
    daySlots: daySlots,
    totalSlots: totalSlots,
    bookedCount: bookedCount,
    blockedCount: blockedCount,
    attendedCount: attendedCount,
    availableCount: Math.max(0, totalSlots - bookedCount - blockedCount),
    percentBooked: totalSlots > 0 ? Math.round((bookedCount / totalSlots) * 100) : 0
  };
}

// -------------------------------------------------------------
// Attendance Tracking (Admin-Only)
// -------------------------------------------------------------

/**
 * Toggle attendance status for a booked slot.
 * Accepts either slotId (string) or full slot object.
 * @param {string} sessionId
 * @param {string|object} slotOrSlotId
 * @param {'not_marked'|'attended'|'no_show'} status
 */
export async function updateBookingAttendance(sessionId, slotOrSlotId, status) {
  const bookings = getRawBookings();
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);

  const slotId = typeof slotOrSlotId === 'string' ? slotOrSlotId : slotOrSlotId?.id;
  const slotObj = typeof slotOrSlotId === 'object' ? slotOrSlotId : null;
  const slotBooking = slotObj?.booking || null;

  let bookingKey = null;
  let targetBooking = null;

  // 1. Direct match by key with slotId
  if (slotId && bookings[`${sessionId}_${slotId}`]) {
    bookingKey = `${sessionId}_${slotId}`;
    targetBooking = bookings[bookingKey];
  }

  // 2. Direct match by slot.booking.slotId
  if (!targetBooking && slotBooking?.slotId) {
    const bKey = `${sessionId}_${slotBooking.slotId}`;
    if (bookings[bKey]) {
      bookingKey = bKey;
      targetBooking = bookings[bKey];
    }
  }

  // 3. Match using findBookingForSlot if slot object is available
  if (!targetBooking && slotObj) {
    const category = slotObj.category || slotBooking?.candidateCategory || 'Category A';
    const found = findBookingForSlot(bookings, sessionId, slotObj, category);
    if (found) {
      targetBooking = found;
      for (const [k, b] of Object.entries(bookings)) {
        if (b === found || (k.startsWith(`${sessionId}_`) && b.slotId === found.slotId)) {
          bookingKey = k;
          break;
        }
      }
    }
  }

  // 4. Scan all bookings in this session for match by candidate email, phone, name, startMinutes, or slotId
  if (!targetBooking) {
    const candidateEmail = (slotBooking?.candidateEmail || '').trim().toLowerCase();
    const candidateName = (slotBooking?.candidateName || '').trim().toLowerCase();
    const candidatePhone = (slotBooking?.candidatePhone || '').replace(/\D/g, '');
    const startMins = slotObj?.startMinutes !== undefined ? slotObj.startMinutes : slotBooking?.startMinutes;
    const endMins = slotObj?.endMinutes !== undefined ? slotObj.endMinutes : slotBooking?.endMinutes;

    for (const [k, b] of Object.entries(bookings)) {
      if (!k.startsWith(`${sessionId}_`)) continue;

      const bEmail = (b.candidateEmail || '').trim().toLowerCase();
      const bName = (b.candidateName || '').trim().toLowerCase();
      const bPhone = (b.candidatePhone || '').replace(/\D/g, '');

      // Check slot ID or canonical slot ID match
      if (slotId && (b.slotId === slotId || k === `${sessionId}_${slotId}`)) {
        bookingKey = k;
        targetBooking = b;
        break;
      }
      if (slotBooking?.slotId && (b.slotId === slotBooking.slotId || k === `${sessionId}_${slotBooking.slotId}`)) {
        bookingKey = k;
        targetBooking = b;
        break;
      }

      // Check candidate identity match
      const emailMatches = candidateEmail && bEmail && candidateEmail === bEmail;
      const phoneMatches = candidatePhone && candidatePhone.length >= 7 && bPhone && candidatePhone === bPhone;
      const nameMatches = candidateName && bName && candidateName === bName;

      if (emailMatches || phoneMatches || (nameMatches && (candidateEmail || candidatePhone))) {
        bookingKey = k;
        targetBooking = b;
        break;
      }

      // Check startMinutes and endMinutes match
      if (startMins !== undefined && endMins !== undefined && b.startMinutes === startMins && b.endMinutes === endMins) {
        bookingKey = k;
        targetBooking = b;
        break;
      }

      // Check parsed slot ID
      if (slotId) {
        const parsedSlot = parseSlotId(slotId, b.candidateCategory);
        if (parsedSlot && (b.slotId === parsedSlot.canonicalId || b.slotId === parsedSlot.rawId)) {
          bookingKey = k;
          targetBooking = b;
          break;
        }
      }
    }
  }

  // 5. Cloud fallback: If still not found locally, query Firestore for this session's bookings
  if (!targetBooking && isFirebaseConfigured() && db) {
    try {
      const q = query(collection(db, 'bookings'), where('sessionId', '==', sessionId));
      const snap = await getDocs(q);
      const candidateEmail = (slotBooking?.candidateEmail || '').trim().toLowerCase();
      const candidateName = (slotBooking?.candidateName || '').trim().toLowerCase();

      snap.forEach((d) => {
        if (targetBooking) return;
        const b = d.data();
        const bEmail = (b.candidateEmail || '').trim().toLowerCase();
        const bName = (b.candidateName || '').trim().toLowerCase();

        if (
          (slotId && (d.id === `${sessionId}_${slotId}` || b.slotId === slotId)) ||
          (slotBooking?.slotId && (d.id === `${sessionId}_${slotBooking.slotId}` || b.slotId === slotBooking.slotId)) ||
          (candidateEmail && bEmail && candidateEmail === bEmail) ||
          (candidateName && bName && candidateName === bName)
        ) {
          bookingKey = d.id;
          targetBooking = b;
        }
      });
    } catch (err) {
      console.warn('Firestore fallback booking search error:', err);
    }
  }

  if (!targetBooking) {
    return { success: false, error: 'Booking not found.' };
  }

  if (!bookingKey) {
    bookingKey = targetBooking.slotId ? `${sessionId}_${targetBooking.slotId}` : `${sessionId}_${slotId}`;
  }

  const updatedBooking = {
    ...targetBooking,
    attendanceStatus: status,
    attendanceMarkedAt: new Date().toISOString()
  };
  bookings[bookingKey] = updatedBooking;
  saveRawBookings(bookings);

  // Sync to Firestore
  if (isFirebaseConfigured() && db) {
    try {
      await setDoc(doc(db, 'bookings', bookingKey), {
        attendanceStatus: status,
        attendanceMarkedAt: updatedBooking.attendanceMarkedAt
      }, { merge: true });

      if (targetBooking.slotId && `${sessionId}_${targetBooking.slotId}` !== bookingKey) {
        await setDoc(doc(db, 'bookings', `${sessionId}_${targetBooking.slotId}`), {
          attendanceStatus: status,
          attendanceMarkedAt: updatedBooking.attendanceMarkedAt
        }, { merge: true }).catch(() => {});
      }
    } catch (err) {
      console.warn('Could not update attendance in Firestore:', err);
    }
  }

  // Also keep attendee record in sync if present
  const attendeeIdentifier = (targetBooking.candidateEmail || targetBooking.candidatePhone || targetBooking.candidateContact || targetBooking.candidateName || '').toLowerCase().trim();
  const attKey = `${sessionId}_${attendeeIdentifier}`;
  const attendees = getRawAttendees();
  let attendeeKey = attendees[attKey] ? attKey : null;

  if (!attendeeKey) {
    for (const [ak, a] of Object.entries(attendees)) {
      if (!ak.startsWith(`${sessionId}_`)) continue;
      if (
        (targetBooking.candidateEmail && a.email && a.email.toLowerCase() === targetBooking.candidateEmail.toLowerCase()) ||
        (targetBooking.candidatePhone && a.phone && a.phone.replace(/\D/g, '') === targetBooking.candidatePhone.replace(/\D/g, '')) ||
        (targetBooking.candidateName && a.name && a.name.toLowerCase() === targetBooking.candidateName.toLowerCase())
      ) {
        attendeeKey = ak;
        break;
      }
    }
  }

  if (attendeeKey && attendees[attendeeKey]) {
    attendees[attendeeKey] = {
      ...attendees[attendeeKey],
      attendanceStatus: status,
      attendanceMarkedAt: updatedBooking.attendanceMarkedAt
    };
    saveRawAttendees(attendees);
    if (isFirebaseConfigured() && db) {
      setDoc(doc(db, 'attendees', attendeeKey), {
        attendanceStatus: status,
        attendanceMarkedAt: updatedBooking.attendanceMarkedAt
      }, { merge: true }).catch(() => {});
    }
  }

  logActivityEvent({
    type: 'ATTENDANCE_UPDATED',
    sessionId,
    sessionTitle: session?.title || 'Session',
    actor: 'Admin',
    details: `Marked ${targetBooking.candidateName || 'candidate'} as "${status === 'attended' ? 'Attended' : status === 'no_show' ? 'No-show' : 'Not marked'}" for slot ${slotId}`
  });

  broadcast('ATTENDANCE_UPDATED', { sessionId, slotId, status });
  return { success: true, status, booking: updatedBooking };
}

export async function toggleSlotBlocked(sessionId, slotId, reason = 'Unavailable') {
  const blockedSlots = getRawBlockedSlots();
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const key = `${sessionId}_${slotId}`;

  const isCurrentlyBlocked = Boolean(blockedSlots[key]);
  if (isCurrentlyBlocked) {
    delete blockedSlots[key];
    saveRawBlockedSlots(blockedSlots);

    if (isFirebaseConfigured() && db) {
      try {
        await deleteDoc(doc(db, 'blocked_slots', key));
      } catch (err) {
        console.warn('Could not unblock slot in Firestore:', err);
      }
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
      try {
        await setDoc(doc(db, 'blocked_slots', key), blockRecord);
      } catch (err) {
        console.warn('Could not block slot in Firestore:', err);
      }
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

export async function createNewSession({
  title,
  eventType = 'single',
  date,
  days = null,
  startTime = '09:00',
  endTime = '16:00',
  slotDuration = 15,
  timezone = 'EST',
  description = '',
  meetingLink = '',
  categories = ['Category A', 'Category B', 'Category C']
}) {
  const sessions = getRawSessions();
  const id = generateSessionId();
  removeDeletedSessionId(id);
  const validCategories = Array.isArray(categories) && categories.length > 0
    ? categories.map((c) => c.trim()).filter(Boolean)
    : ['Category A', 'Category B', 'Category C'];

  let validDays = [];
  if (eventType === 'multi' && Array.isArray(days) && days.length > 0) {
    validDays = days.map((d, idx) => ({
      id: d.id || `day_${idx + 1}`,
      date: d.date,
      label: d.label || `Day ${idx + 1}`,
      startTime: d.startTime || startTime,
      endTime: d.endTime || endTime
    }));
  } else {
    validDays = [
      {
        id: 'day_1',
        date: date || new Date().toISOString().split('T')[0],
        label: 'Day 1',
        startTime: startTime,
        endTime: endTime
      }
    ];
  }

  const primaryDate = validDays[0]?.date || date || new Date().toISOString().split('T')[0];

  const newSession = {
    id,
    title: title.trim(),
    eventType: validDays.length > 1 ? 'multi' : 'single',
    date: primaryDate,
    days: validDays,
    startTime,
    endTime,
    slotDuration: Number(slotDuration) || 15,
    timezone,
    description: description.trim(),
    meetingLink: (meetingLink || '').trim(),
    categories: validCategories,
    createdAt: new Date().toISOString()
  };

  // Direct Firestore write as primary persistence
  if (isFirebaseConfigured() && db) {
    try {
      await setDoc(doc(db, 'sessions', newSession.id), newSession);
    } catch (err) {
      console.warn('Could not sync session to Firestore:', err);
    }
  }

  sessions.unshift(newSession);
  saveRawSessions(sessions);

  const daysSummary = validDays.length > 1
    ? `${validDays.length} days (${validDays.map((d) => d.date).join(', ')})`
    : `on ${primaryDate}`;

  logActivityEvent({
    type: 'SESSION_CREATED',
    sessionId: newSession.id,
    sessionTitle: newSession.title,
    actor: 'Admin',
    details: `Created ${newSession.eventType} session ${daysSummary} (${startTime}–${endTime}, ${newSession.slotDuration}m slots, ${validCategories.length} categories: ${validCategories.join(', ')})`
  });

  broadcast('SESSION_CREATED', { session: newSession });
  return newSession;
}

export async function updateSessionDetails(sessionId, updates = {}) {
  const sessions = getRawSessions();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index === -1) return { success: false, error: 'Session not found.' };

  const prev = sessions[index];
  const validCategories = updates.categories && Array.isArray(updates.categories) && updates.categories.length > 0
    ? updates.categories.map((c) => c.trim()).filter(Boolean)
    : prev.categories || ['Category A', 'Category B', 'Category C'];

  let validDays = prev.days || normalizeSessionDays(prev);
  if (updates.days && Array.isArray(updates.days) && updates.days.length > 0) {
    validDays = updates.days.map((d, idx) => ({
      id: d.id || `day_${idx + 1}`,
      date: d.date,
      label: d.label || `Day ${idx + 1}`,
      startTime: d.startTime || updates.startTime || prev.startTime || '09:00',
      endTime: d.endTime || updates.endTime || prev.endTime || '16:00'
    }));
  } else if (updates.date) {
    validDays = [
      {
        id: 'day_1',
        date: updates.date,
        label: 'Day 1',
        startTime: updates.startTime || prev.startTime || '09:00',
        endTime: updates.endTime || prev.endTime || '16:00'
      }
    ];
  }

  const primaryDate = validDays[0]?.date || updates.date || prev.date;
  const eventType = updates.eventType || (validDays.length > 1 ? 'multi' : 'single');

  const updated = {
    ...prev,
    ...(updates.title !== undefined && { title: updates.title.trim() }),
    eventType,
    date: primaryDate,
    days: validDays,
    ...(updates.startTime !== undefined && { startTime: updates.startTime }),
    ...(updates.endTime !== undefined && { endTime: updates.endTime }),
    ...(updates.slotDuration !== undefined && { slotDuration: Number(updates.slotDuration) || prev.slotDuration }),
    ...(updates.timezone !== undefined && { timezone: updates.timezone.trim() }),
    ...(updates.description !== undefined && { description: (updates.description || '').trim() }),
    ...(updates.meetingLink !== undefined && { meetingLink: (updates.meetingLink || '').trim() }),
    ...(updates.categories !== undefined && { categories: validCategories }),
    updatedAt: new Date().toISOString()
  };

  // Direct Firestore write
  if (isFirebaseConfigured() && db) {
    try {
      await setDoc(doc(db, 'sessions', sessionId), updated, { merge: true });
    } catch (err) {
      console.warn('Could not sync updated session details to Firestore:', err);
    }
  }

  sessions[index] = updated;
  saveRawSessions(sessions);

  logActivityEvent({
    type: 'SESSION_UPDATED',
    sessionId,
    sessionTitle: updated.title,
    actor: 'Admin',
    details: `Updated session settings (Title: "${updated.title}", EventType: ${updated.eventType}, Dates: ${validDays.map((d) => d.date).join(', ')}, Time: ${updated.startTime}–${updated.endTime} ${updated.timezone})`
  });

  broadcast('SESSION_UPDATED', { sessionId, session: updated });
  return { success: true, session: updated };
}

export async function updateSessionCategories(sessionId, categories) {
  const sessions = getRawSessions();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index === -1) return { success: false, error: 'Session not found.' };

  const validCategories = Array.isArray(categories) && categories.length > 0
    ? categories.map((c) => c.trim()).filter(Boolean)
    : ['Category A', 'Category B', 'Category C'];

  sessions[index] = {
    ...sessions[index],
    categories: validCategories,
    updatedAt: new Date().toISOString()
  };

  if (isFirebaseConfigured() && db) {
    try {
      await setDoc(doc(db, 'sessions', sessionId), sessions[index], { merge: true });
    } catch (err) {
      console.warn('Could not sync updated categories to Firestore:', err);
    }
  }

  saveRawSessions(sessions);

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

export async function updateSessionMeetingLink(sessionId, meetingLink) {
  const sessions = getRawSessions();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index === -1) return { success: false, error: 'Session not found.' };

  const cleanLink = (meetingLink || '').trim();
  sessions[index] = {
    ...sessions[index],
    meetingLink: cleanLink,
    updatedAt: new Date().toISOString()
  };

  if (isFirebaseConfigured() && db) {
    try {
      await setDoc(doc(db, 'sessions', sessionId), sessions[index], { merge: true });
    } catch (err) {
      console.warn('Could not sync updated session meeting link to Firestore:', err);
    }
  }

  saveRawSessions(sessions);

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

export async function updateSessionDescription(sessionId, description) {
  const sessions = getRawSessions();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index === -1) return { success: false, error: 'Session not found.' };

  const cleanDesc = (description || '').trim();
  sessions[index] = {
    ...sessions[index],
    description: cleanDesc,
    updatedAt: new Date().toISOString()
  };

  if (isFirebaseConfigured() && db) {
    try {
      await setDoc(doc(db, 'sessions', sessionId), sessions[index], { merge: true });
    } catch (err) {
      console.warn('Could not sync updated session description to Firestore:', err);
    }
  }

  saveRawSessions(sessions);

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

export async function deleteSession(sessionId) {
  addDeletedSessionId(sessionId);
  let sessions = getRawSessions();
  const sessionToDelete = sessions.find((s) => s.id === sessionId);
  sessions = sessions.filter((s) => s.id !== sessionId);
  saveRawSessions(sessions);

  // Clean up bookings locally
  const bookings = getRawBookings();
  const updatedBookings = {};
  const bookingKeysToDelete = [];
  Object.keys(bookings).forEach((key) => {
    if (!key.startsWith(`${sessionId}_`)) {
      updatedBookings[key] = bookings[key];
    } else {
      bookingKeysToDelete.push(key);
    }
  });
  saveRawBookings(updatedBookings);

  // Clean up blocked slots locally
  const blockedSlots = getRawBlockedSlots();
  const updatedBlockedSlots = {};
  const blockedKeysToDelete = [];
  Object.keys(blockedSlots).forEach((key) => {
    if (!key.startsWith(`${sessionId}_`)) {
      updatedBlockedSlots[key] = blockedSlots[key];
    } else {
      blockedKeysToDelete.push(key);
    }
  });
  saveRawBlockedSlots(updatedBlockedSlots);

  // Direct Firestore delete for session and related collections
  if (isFirebaseConfigured() && db) {
    try {
      await deleteDoc(doc(db, 'sessions', sessionId));
      bookingKeysToDelete.forEach((bKey) => {
        deleteDoc(doc(db, 'bookings', bKey)).catch(() => {});
      });
      blockedKeysToDelete.forEach((blkKey) => {
        deleteDoc(doc(db, 'blocked_slots', blkKey)).catch(() => {});
      });
    } catch (err) {
      console.warn('Could not delete session from Firestore:', err);
    }
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

export async function recordSessionAttendee(sessionId, { name, category = 'A', email = '', phone = '', contact = '', isTester = false }) {
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
    bookedSlotId: existing ? existing.bookedSlotId : null,
    isTester: isTester || existing?.isTester || false
  };

  // Direct Firestore write
  if (isFirebaseConfigured() && db) {
    try {
      await setDoc(doc(db, 'attendees', key), attendeeRecord, { merge: true });
    } catch (err) {
      console.warn('Could not sync attendee to Firestore:', err);
    }
  }

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
  const seenEmails = new Set();
  const seenNames = new Set();

  Object.keys(attendees).forEach((key) => {
    if (key.startsWith(`${sessionId}_`)) {
      const att = attendees[key];
      let currentBooking = null;
      const allSlots = session?.allSlots || session?.slots || [];
      allSlots.forEach((slot) => {
        if (
          slot.isBooked && slot.booking &&
          (
            (att.email && slot.booking.candidateEmail && slot.booking.candidateEmail.toLowerCase() === att.email.toLowerCase()) ||
            (att.phone && slot.booking.candidatePhone && slot.booking.candidatePhone.replace(/\D/g, '') === att.phone.replace(/\D/g, '')) ||
            (att.contact && slot.booking.candidateContact && slot.booking.candidateContact.toLowerCase() === att.contact.toLowerCase()) ||
            (att.name && slot.booking.candidateName && slot.booking.candidateName.toLowerCase() === att.name.toLowerCase())
          )
        ) {
          currentBooking = slot;
        }
      });

      if (att.email) seenEmails.add(att.email.toLowerCase());
      if (att.name) seenNames.add(att.name.toLowerCase());

      list.push({
        ...att,
        isBooked: Boolean(currentBooking),
        bookedSlot: currentBooking
      });
    }
  });

  // Also include candidates directly from bookings to guarantee zero loss of candidate visibility
  const bookings = getRawBookings();
  Object.entries(bookings).forEach(([key, b]) => {
    if (!key.startsWith(`${sessionId}_`)) return;
    const bEmail = (b.candidateEmail || '').toLowerCase().trim();
    const bName = (b.candidateName || '').toLowerCase().trim();

    if ((bEmail && seenEmails.has(bEmail)) || (bName && seenNames.has(bName))) {
      return;
    }

    const allSlots = session?.allSlots || session?.slots || [];
    const matchedSlot = allSlots.find((s) => s.booking && (s.id === b.slotId || s.booking.candidateEmail === b.candidateEmail || s.booking.candidateName === b.candidateName));

    if (bEmail) seenEmails.add(bEmail);
    if (bName) seenNames.add(bName);

    list.push({
      id: `${sessionId}_${bEmail || bName}`,
      sessionId,
      name: b.candidateName,
      category: b.candidateCategory || 'Category A',
      email: b.candidateEmail || '',
      phone: b.candidatePhone || '',
      contact: b.candidateContact || (b.candidateEmail && b.candidatePhone ? `${b.candidateEmail} • ${b.candidatePhone}` : b.candidateEmail || b.candidatePhone || ''),
      editCount: 0,
      slotChangeCount: b.rescheduledFrom ? 1 : 0,
      device: 'Desktop',
      firstCheckedInAt: b.bookedAt,
      lastSeenAt: b.bookedAt,
      status: 'booked',
      bookedSlotId: b.slotId,
      isBooked: true,
      bookedSlot: matchedSlot || null
    });
  });

  return list.sort((a, b) => new Date(b.lastSeenAt || b.bookedAt || 0) - new Date(a.lastSeenAt || a.bookedAt || 0));
}

export function getAllAttendees() {
  const attendees = getRawAttendees();
  const sessions = getRawSessions();
  const sessionMap = {};
  sessions.forEach((s) => { sessionMap[s.id] = s; });

  const list = [];
  const seenKeys = new Set();

  Object.keys(attendees).forEach((key) => {
    const att = attendees[key];
    const session = sessionMap[att.sessionId];
    if (session) {
      const dedupe = `${att.sessionId}_${(att.email || att.contact || att.name).toLowerCase()}`;
      seenKeys.add(dedupe);
      list.push({
        ...att,
        sessionTitle: session.title,
        sessionDate: session.date
      });
    }
  });

  // Also include from bookings
  const bookings = getRawBookings();
  Object.entries(bookings).forEach(([key, b]) => {
    const bookingSessionId = b.sessionId || key.substring(0, key.lastIndexOf('_slot_'));
    const session = sessionMap[bookingSessionId];
    if (session) {
      const dedupe = `${session.id}_${(b.candidateEmail || b.candidatePhone || b.candidateName).toLowerCase()}`;
      if (!seenKeys.has(dedupe)) {
        seenKeys.add(dedupe);
        list.push({
          id: `${session.id}_${b.candidateEmail || b.candidateName}`,
          sessionId: session.id,
          name: b.candidateName,
          category: b.candidateCategory || 'Category A',
          email: b.candidateEmail || '',
          phone: b.candidatePhone || '',
          contact: b.candidateContact || (b.candidateEmail && b.candidatePhone ? `${b.candidateEmail} • ${b.candidatePhone}` : b.candidateEmail || b.candidatePhone || ''),
          firstCheckedInAt: b.bookedAt,
          lastSeenAt: b.bookedAt,
          status: 'booked',
          bookedSlotId: b.slotId,
          sessionTitle: session.title,
          sessionDate: session.date
        });
      }
    }
  });

  return list.sort((a, b) => new Date(b.lastSeenAt || b.bookedAt || 0) - new Date(a.lastSeenAt || a.bookedAt || 0));
}

// -------------------------------------------------------------
// Slot Change & 3-Hour Cutoff Verification
// -------------------------------------------------------------

export function checkSlotChangeEligibility(sessionId, slotId, participantProfile) {
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const attendees = getRawAttendees();
  const bookings = getRawBookings();

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

  // Rule 2: Minimum 3 Hours Before Meeting Start Time (evaluated on the slot's specific day date)
  if (session && slotId) {
    let slotDate = session.date;
    const days = normalizeSessionDays(session);
    const parsed = parseSlotId(slotId);
    if (parsed && parsed.dayId) {
      const matchDay = days.find((d) => d.id === parsed.dayId);
      if (matchDay && matchDay.date) slotDate = matchDay.date;
    }
    const booking = bookings[`${sessionId}_${slotId}`];
    if (booking && booking.slotDate) {
      slotDate = booking.slotDate;
    }

    const isWithin3Hours = isSlotWithinCutoff(slotDate, slotId, 3);
    const hoursRemaining = getHoursUntilSlot(slotDate, slotId);

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

export async function bookSlot(sessionId, slotId, { candidateName, candidateContact, candidateCategory = 'Category A', candidateEmail = '', candidatePhone = '' }) {
  const bookings = getRawBookings();
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const categories = session?.categories || ['Category A', 'Category B', 'Category C'];
  const resolvedCategory = resolveCategoryInSession(categories, candidateCategory);
  const days = normalizeSessionDays(session);

  const parsed = parseSlotId(slotId, resolvedCategory);
  const canonicalSlotId = parsed ? parsed.canonicalId : slotId;
  const key = `${sessionId}_${canonicalSlotId}`;

  // Find slot date & dayId
  let slotDate = session?.date;
  let dayId = parsed?.dayId || null;
  if (dayId) {
    const matchDay = days.find((d) => d.id === dayId);
    if (matchDay && matchDay.date) slotDate = matchDay.date;
  } else if (days.length > 0) {
    slotDate = days[0].date;
    dayId = days[0].id;
  }

  // Guard: Single booking per candidate (check existing bookings in session)
  const normalizedName = candidateName.trim().toLowerCase();
  const normalizedContact = candidateContact.trim().toLowerCase();
  const normalizedEmail = candidateEmail.trim().toLowerCase();
  const cleanPhone = candidatePhone.replace(/\D/g, '');

  for (const [k, b] of Object.entries(bookings)) {
    if (k.startsWith(`${sessionId}_`)) {
      const bEmail = (b.candidateEmail || '').trim().toLowerCase();
      const bContact = (b.candidateContact || '').trim().toLowerCase();
      const bName = (b.candidateName || '').trim().toLowerCase();
      const bCleanPhone = (b.candidatePhone || '').replace(/\D/g, '');

      const isSameEmail = normalizedEmail && bEmail && normalizedEmail === bEmail;
      const isSamePhone = cleanPhone && cleanPhone.length >= 10 && bCleanPhone && bCleanPhone.length >= 10 && cleanPhone === bCleanPhone;
      const isSameContact = normalizedContact && bContact && normalizedContact === bContact;
      const isSameName = normalizedName && bName && normalizedName === bName;

      if (isSameEmail || isSamePhone || isSameContact || (isSameName && (cleanPhone || normalizedEmail))) {
        return {
          success: false,
          alreadyReserved: true,
          error: `You already have an active reserved slot in this session. Each candidate may only book one slot. Please use Change Slot if you wish to choose a different time.`
        };
      }
    }
  }

  const blockedSlots = getRawBlockedSlots();
  const isBlocked = Boolean(
    blockedSlots[key] ||
    findBlockedForSlot(blockedSlots, sessionId, { id: canonicalSlotId, baseId: parsed?.baseId, dayId, date: slotDate, startMinutes: parsed?.startMinutes, endMinutes: parsed?.endMinutes }, resolvedCategory)
  );

  if (isBlocked) {
    return {
      success: false,
      conflict: true,
      error: 'This time slot has been marked unavailable by the session administrator.'
    };
  }

  const existingBooking = bookings[key] || findBookingForSlot(bookings, sessionId, { id: canonicalSlotId, baseId: parsed?.baseId, dayId, date: slotDate, startMinutes: parsed?.startMinutes, endMinutes: parsed?.endMinutes }, resolvedCategory);
  if (existingBooking) {
    logActivityEvent({
      type: 'BOOKING_CONFLICT',
      sessionId: sessionId,
      sessionTitle: session?.title || 'Session',
      actor: candidateName,
      details: `Attempted to book slot ${canonicalSlotId} which was already taken.`
    });
    return {
      success: false,
      conflict: true,
      error: `This slot was just reserved moments ago by another participant. Please select another open time slot.`
    };
  }

  const bookingRecord = {
    sessionId,
    slotId: canonicalSlotId,
    dayId: dayId,
    slotDate: slotDate,
    candidateName: candidateName.trim(),
    candidateContact: candidateContact.trim(),
    candidateCategory: resolvedCategory,
    candidateEmail: candidateEmail.trim(),
    candidatePhone: candidatePhone.trim(),
    startMinutes: parsed?.startMinutes,
    endMinutes: parsed?.endMinutes,
    bookedAt: new Date().toISOString()
  };

  const attKey = `${sessionId}_${(candidateEmail || candidateContact || candidateName).toLowerCase().trim()}`;
  const attendees = getRawAttendees();
  let attendeeRecord = attendees[attKey];
  if (attendeeRecord) {
    attendeeRecord = {
      ...attendeeRecord,
      status: 'booked',
      category: resolvedCategory,
      bookedSlotId: canonicalSlotId,
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
        details: `Concurrent booking collision detected on slot ${canonicalSlotId}`
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
    details: `Confirmed slot reservation on ${slotDate || session?.date} for Category ${bookingRecord.candidateCategory} (${bookingRecord.candidateEmail || bookingRecord.candidateContact})`
  });

  broadcast('SLOT_BOOKED', { sessionId, slotId: canonicalSlotId, booking: bookingRecord });

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
  const categories = session?.categories || ['Category A', 'Category B', 'Category C'];
  const resolvedCategory = resolveCategoryInSession(categories, candidateProfile?.category);
  const days = normalizeSessionDays(session);

  const parsedOld = parseSlotId(oldSlotId, resolvedCategory);
  const parsedNew = parseSlotId(newSlotId, resolvedCategory);
  const canonicalOldSlotId = parsedOld ? parsedOld.canonicalId : oldSlotId;
  const canonicalNewSlotId = parsedNew ? parsedNew.canonicalId : newSlotId;

  const newKey = `${sessionId}_${canonicalNewSlotId}`;

  let newSlotDate = session?.date;
  let newDayId = parsedNew?.dayId || null;
  if (newDayId) {
    const matchDay = days.find((d) => d.id === newDayId);
    if (matchDay && matchDay.date) newSlotDate = matchDay.date;
  } else if (days.length > 0) {
    newSlotDate = days[0].date;
    newDayId = days[0].id;
  }

  // Check if new slot is blocked
  const isNewBlocked = Boolean(
    blockedSlots[newKey] ||
    findBlockedForSlot(blockedSlots, sessionId, { id: canonicalNewSlotId, baseId: parsedNew?.baseId, dayId: newDayId, date: newSlotDate, startMinutes: parsedNew?.startMinutes, endMinutes: parsedNew?.endMinutes }, resolvedCategory)
  );

  if (isNewBlocked) {
    return {
      success: false,
      error: 'The selected new time slot has been marked unavailable by the session administrator.'
    };
  }

  const candidateEmail = (candidateProfile?.email || '').trim().toLowerCase();
  const candidateName = (candidateProfile?.name || '').trim();
  const candidatePhone = (candidateProfile?.phone || '').trim();
  const candidateContact = (candidateProfile?.contact || (candidateEmail && candidatePhone ? `${candidateEmail} • ${candidatePhone}` : candidateEmail || candidatePhone)).trim();
  const cleanPhone = candidatePhone.replace(/\D/g, '');

  // Check if taken by someone else
  const existingAtNew = bookings[newKey] || findBookingForSlot(bookings, sessionId, { id: canonicalNewSlotId, baseId: parsedNew?.baseId, dayId: newDayId, date: newSlotDate, startMinutes: parsedNew?.startMinutes, endMinutes: parsedNew?.endMinutes }, resolvedCategory);
  if (existingAtNew) {
    const isMe = (candidateEmail && existingAtNew.candidateEmail?.toLowerCase() === candidateEmail) ||
                 (cleanPhone && cleanPhone.length >= 7 && existingAtNew.candidatePhone?.replace(/\D/g, '') === cleanPhone);
    if (!isMe) {
      return {
        success: false,
        error: `The slot was just taken by another candidate (${existingAtNew.candidateName || 'another participant'}). Please pick another available time.`
      };
    }
  }

  // Find ALL existing booking keys for this candidate in this session to eliminate any duplicates
  const oldBookingKeys = new Set();
  if (bookings[`${sessionId}_${oldSlotId}`]) oldBookingKeys.add(`${sessionId}_${oldSlotId}`);
  if (bookings[`${sessionId}_${canonicalOldSlotId}`]) oldBookingKeys.add(`${sessionId}_${canonicalOldSlotId}`);

  Object.entries(bookings).forEach(([k, b]) => {
    if (!k.startsWith(`${sessionId}_`)) return;
    const bEmail = (b.candidateEmail || '').trim().toLowerCase();
    const bName = (b.candidateName || '').trim().toLowerCase();
    const bPhone = (b.candidatePhone || '').replace(/\D/g, '');
    const isSameEmail = candidateEmail && bEmail && candidateEmail === bEmail;
    const isSamePhone = cleanPhone && cleanPhone.length >= 10 && bPhone && bPhone.length >= 10 && cleanPhone === bPhone;
    const isSameName = candidateName && bName && candidateName.toLowerCase() === bName;
    const isOldSlotMatch = b.slotId === oldSlotId || b.slotId === canonicalOldSlotId || k.endsWith(oldSlotId) || k.endsWith(canonicalOldSlotId);

    if (isSameEmail || isSamePhone || (isSameName && (candidateEmail || cleanPhone)) || isOldSlotMatch) {
      oldBookingKeys.add(k);
    }
  });

  const newBookingRecord = {
    sessionId,
    slotId: canonicalNewSlotId,
    dayId: newDayId,
    slotDate: newSlotDate,
    candidateName: candidateName.trim(),
    candidateContact: candidateContact.trim(),
    candidateCategory: resolvedCategory,
    candidateEmail: candidateEmail.trim(),
    candidatePhone: candidatePhone.trim(),
    startMinutes: parsedNew?.startMinutes,
    endMinutes: parsedNew?.endMinutes,
    bookedAt: new Date().toISOString(),
    rescheduledFrom: canonicalOldSlotId,
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
      category: resolvedCategory,
      bookedSlotId: canonicalNewSlotId,
      slotChangeCount: nextSlotChangeCount,
      lastSeenAt: new Date().toISOString()
    };
  }

  const updatedProfile = {
    ...candidateProfile,
    category: resolvedCategory,
    slotChangeCount: nextSlotChangeCount
  };

  // ATOMIC FIRESTORE RESCHEDULE TRANSACTION (Delete ALL old candidate bookings + Insert new in single atomic commit)
  if (isFirebaseConfigured() && db) {
    try {
      await runTransaction(db, async (transaction) => {
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
          const isMe = (candidateEmail && existing.candidateEmail?.toLowerCase() === candidateEmail) ||
                       (cleanPhone && cleanPhone.length >= 7 && existing.candidatePhone?.replace(/\D/g, '') === cleanPhone);
          if (!isMe) {
            throw new Error(`The slot was just taken by another candidate (${existing.candidateName || 'another participant'}). Please pick another available time.`);
          }
        }

        // Delete all old booking documents for this candidate in Firestore
        oldBookingKeys.forEach((oldK) => {
          if (oldK !== newKey) {
            transaction.delete(doc(db, 'bookings', oldK));
          }
        });

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

  // Commit locally: Delete all old booking keys and write new one
  oldBookingKeys.forEach((oldK) => {
    delete bookings[oldK];
  });
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
    details: `Rescheduled slot from ${canonicalOldSlotId} to ${canonicalNewSlotId} on ${newSlotDate || session?.date} [Slot Change 1/1 Used]`
  });

  oldBookingKeys.forEach((oldK) => {
    const sId = oldK.replace(`${sessionId}_`, '');
    broadcast('SLOT_CANCELLED', { sessionId, slotId: sId });
  });
  broadcast('SLOT_BOOKED', { sessionId, slotId: canonicalNewSlotId, booking: newBookingRecord });
  broadcast('PARTICIPANT_UPDATED', { sessionId, profile: updatedProfile });

  return {
    success: true,
    booking: newBookingRecord,
    updatedProfile
  };
}

export async function cancelBooking(sessionId, slotOrSlotId, candidateProfile = null, isCandidateAction = false) {
  const slotObj = typeof slotOrSlotId === 'object' ? slotOrSlotId : null;
  const slotId = typeof slotOrSlotId === 'string' ? slotOrSlotId : (slotObj?.booking?.slotId || slotObj?.id);
  const slotBooking = slotObj?.booking || null;

  // For candidate self-cancel: only enforce the 3-hour cutoff, NOT the slot change limit
  if (isCandidateAction && (candidateProfile || slotBooking)) {
    const effectiveProfile = candidateProfile || slotBooking;
    const sessions = getRawSessions();
    const sess = sessions.find((s) => s.id === sessionId);
    if (sess) {
      const days = normalizeSessionDays(sess);
      const parsed = parseSlotId(slotId, effectiveProfile?.category);
      const canonicalSlotId = parsed?.canonicalId || slotId;
      let slotDate = sess.date;
      if (parsed?.dayId) {
        const matchDay = days.find((d) => d.id === parsed.dayId);
        if (matchDay?.date) slotDate = matchDay.date;
      }
      const bookings = getRawBookings();
      const bk = bookings[`${sessionId}_${slotId}`] || bookings[`${sessionId}_${canonicalSlotId}`] || slotBooking;
      if (bk?.slotDate) slotDate = bk.slotDate;

      const isWithin3Hours = isSlotWithinCutoff(slotDate, canonicalSlotId, 3);
      const hoursRemaining = getHoursUntilSlot(slotDate, canonicalSlotId);

      if (isWithin3Hours) {
        if (hoursRemaining <= 0) {
          return { success: false, error: 'This session time has already started or passed. Bookings cannot be cancelled after the scheduled start time.', reason: 'meeting_started' };
        }
        const totalMins = Math.max(1, Math.round(hoursRemaining * 60));
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        const timeLeftStr = h > 0 ? `${h}h ${m > 0 ? `${m}m` : ''}` : `${m} min`;
        return { success: false, error: `Cancellations must be made at least 3 hours before your scheduled time. There is only ${timeLeftStr} remaining.`, reason: 'within_cutoff' };
      }
    }
  }

  const bookings = getRawBookings();
  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);

  const parsed = parseSlotId(slotId, (candidateProfile || slotBooking)?.category);
  const canonicalSlotId = parsed ? parsed.canonicalId : slotId;

  // Find all booking keys matching this slot or this candidate
  const bookingKeysToDelete = new Set();
  if (slotId && bookings[`${sessionId}_${slotId}`]) bookingKeysToDelete.add(`${sessionId}_${slotId}`);
  if (canonicalSlotId && bookings[`${sessionId}_${canonicalSlotId}`]) bookingKeysToDelete.add(`${sessionId}_${canonicalSlotId}`);
  if (slotBooking?.slotId && bookings[`${sessionId}_${slotBooking.slotId}`]) bookingKeysToDelete.add(`${sessionId}_${slotBooking.slotId}`);

  let removedBooking = (slotId && bookings[`${sessionId}_${slotId}`]) || (canonicalSlotId && bookings[`${sessionId}_${canonicalSlotId}`]) || (slotBooking?.slotId && bookings[`${sessionId}_${slotBooking.slotId}`]) || slotBooking;

  if (!removedBooking || bookingKeysToDelete.size === 0) {
    const cEmail = (candidateProfile?.email || slotBooking?.candidateEmail || '').toLowerCase().trim();
    const cName = (candidateProfile?.name || slotBooking?.candidateName || '').toLowerCase().trim();
    const cPhone = (candidateProfile?.phone || slotBooking?.candidatePhone || '').replace(/\D/g, '');
    const startMins = slotObj?.startMinutes !== undefined ? slotObj.startMinutes : slotBooking?.startMinutes;
    const endMins = slotObj?.endMinutes !== undefined ? slotObj.endMinutes : slotBooking?.endMinutes;

    Object.entries(bookings).forEach(([k, b]) => {
      if (!k.startsWith(`${sessionId}_`)) return;
      const bEmail = (b.candidateEmail || '').toLowerCase().trim();
      const bName = (b.candidateName || '').toLowerCase().trim();
      const bPhone = (b.candidatePhone || '').replace(/\D/g, '');

      const isSlotMatch = b.slotId === slotId || (canonicalSlotId && b.slotId === canonicalSlotId) || (slotBooking?.slotId && b.slotId === slotBooking.slotId);
      const isCandidateMatch = (cEmail && bEmail && cEmail === bEmail) || (cPhone && cPhone.length >= 7 && bPhone === cPhone) || (cName && bName && cName === bName);
      const isTimeMatch = startMins !== undefined && endMins !== undefined && b.startMinutes === startMins && b.endMinutes === endMins;

      if (isSlotMatch || isCandidateMatch || isTimeMatch) {
        bookingKeysToDelete.add(k);
        if (!removedBooking) removedBooking = b;
      }
    });
  }

  // Cloud fallback: If local keys wasn't found, search Firestore
  if (bookingKeysToDelete.size === 0 && isFirebaseConfigured() && db) {
    try {
      const q = query(collection(db, 'bookings'), where('sessionId', '==', sessionId));
      const snap = await getDocs(q);
      const cEmail = (candidateProfile?.email || slotBooking?.candidateEmail || '').toLowerCase().trim();
      const cName = (candidateProfile?.name || slotBooking?.candidateName || '').toLowerCase().trim();

      snap.forEach((d) => {
        const b = d.data();
        const bEmail = (b.candidateEmail || '').toLowerCase().trim();
        const bName = (b.candidateName || '').toLowerCase().trim();
        if (
          (slotId && (d.id === `${sessionId}_${slotId}` || b.slotId === slotId)) ||
          (slotBooking?.slotId && (d.id === `${sessionId}_${slotBooking.slotId}` || b.slotId === slotBooking.slotId)) ||
          (cEmail && bEmail && cEmail === bEmail) ||
          (cName && bName && cName === bName)
        ) {
          bookingKeysToDelete.add(d.id);
          if (!removedBooking) removedBooking = b;
        }
      });
    } catch (err) {
      console.warn('Firestore cancel booking search error:', err);
    }
  }

  if (bookingKeysToDelete.size === 0) {
    return { success: false, error: 'Booking not found.' };
  }

  const candidateIdentifier = (removedBooking?.candidateEmail || removedBooking?.candidatePhone || removedBooking?.candidateContact || removedBooking?.candidateName || '').toLowerCase().trim();
  const attKey = `${sessionId}_${candidateIdentifier}`;
  const attendees = getRawAttendees();
  let attendeeRecord = attendees[attKey];

  if (attendeeRecord) {
    attendeeRecord = {
      ...attendeeRecord,
      status: 'checked_in',
      bookedSlotId: null,
      lastSeenAt: new Date().toISOString()
    };
  }

  // ATOMIC FIRESTORE DELETION
  if (isFirebaseConfigured() && db) {
    try {
      await runTransaction(db, async (transaction) => {
        bookingKeysToDelete.forEach((key) => {
          transaction.delete(doc(db, 'bookings', key));
        });

        if (attendeeRecord) {
          transaction.set(doc(db, 'attendees', attKey), attendeeRecord, { merge: true });
        }
      });
    } catch (err) {
      console.warn('Firestore cancel transaction failed:', err);
    }
  }

  bookingKeysToDelete.forEach((key) => {
    delete bookings[key];
  });
  saveRawBookings(bookings);

  if (attendeeRecord) {
    attendees[attKey] = attendeeRecord;
    saveRawAttendees(attendees);
  }

  logActivityEvent({
    type: 'SLOT_CANCELLED',
    sessionId,
    sessionTitle: session?.title || 'Session',
    actor: isCandidateAction ? (candidateProfile?.name || 'Candidate') : 'Admin',
    details: `Cancelled booking on slot ${canonicalSlotId} for ${removedBooking?.candidateName || 'candidate'}`
  });

  bookingKeysToDelete.forEach((key) => {
    const sId = key.replace(`${sessionId}_`, '');
    broadcast('SLOT_CANCELLED', { sessionId, slotId: sId });
  });

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
  const seenCandidates = new Set();

  Object.keys(bookings).forEach((key) => {
    const booking = bookings[key];
    const [sessionId, ...slotParts] = key.split('_');
    const slotId = booking.slotId || slotParts.join('_');
    const session = sessionMap[sessionId];

    if (session) {
      const category = booking.candidateCategory || 'Category A';
      const parsed = parseSlotId(slotId, category);
      const startMins = parsed?.startMinutes !== undefined ? parsed.startMinutes : booking.startMinutes;
      const endMins = parsed?.endMinutes !== undefined ? parsed.endMinutes : booking.endMinutes;
      const timeLabel = startMins !== undefined && endMins !== undefined
        ? `${minutesTo12Hour(startMins)} – ${minutesTo12Hour(endMins)}`
        : (booking.slotTimeLabel || 'Scheduled Time');

      const dedupeKey = `${sessionId}_${(booking.candidateEmail || booking.candidatePhone || booking.candidateName || key).toLowerCase().trim()}`;
      if (seenCandidates.has(dedupeKey)) return;
      seenCandidates.add(dedupeKey);

      const days = normalizeSessionDays(session);
      let dayLabel = null;
      if (booking.dayId) {
        const foundDay = days.find((d) => d.id === booking.dayId);
        if (foundDay) dayLabel = foundDay.label;
      }

      candidateList.push({
        id: key,
        candidateName: booking.candidateName,
        candidateCategory: category,
        candidateEmail: booking.candidateEmail || '',
        candidatePhone: booking.candidatePhone || '',
        candidateContact: booking.candidateContact || (booking.candidateEmail && booking.candidatePhone ? `${booking.candidateEmail} • ${booking.candidatePhone}` : booking.candidateEmail || booking.candidatePhone || ''),
        bookedAt: booking.bookedAt,
        sessionId: session.id,
        sessionTitle: session.title,
        sessionDate: booking.slotDate || session.date,
        dayId: booking.dayId || null,
        dayLabel: dayLabel,
        slotTimeLabel: timeLabel,
        slotId: slotId
      });
    }
  });

  return candidateList.sort((a, b) => new Date(b.bookedAt) - new Date(a.bookedAt));
}

// -------------------------------------------------------------
// Participant Local Identity / Gate Cache (Strictly Event-Scoped)
// -------------------------------------------------------------

export function getParticipantProfile(sessionId) {
  try {
    if (!sessionId) return null;
    let data = localStorage.getItem(`${PARTICIPANT_KEY}_${sessionId}`);
    if (!data) {
      data = localStorage.getItem(`viewme_participant_${sessionId}`) ||
             localStorage.getItem(`viewme_participant_profile_${sessionId}`) ||
             localStorage.getItem('viewme_participant_profile');
    }
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (!parsed) return null;

    // Check if there is an attendee record for this specific session to get authoritative session-scoped counts
    const attendees = getRawAttendees();
    const cleanEmail = (parsed.email || '').toLowerCase().trim();
    const cleanContact = (parsed.contact || '').toLowerCase().trim();
    const cleanName = (parsed.name || '').toLowerCase().trim();
    const attKey = `${sessionId}_${cleanEmail || cleanContact || cleanName}`;
    const att = attendees[attKey];

    return {
      ...parsed,
      editCount: att?.editCount !== undefined ? Number(att.editCount) : (Number(parsed.editCount) || 0),
      slotChangeCount: att?.slotChangeCount !== undefined ? Number(att.slotChangeCount) : (Number(parsed.slotChangeCount) || 0)
    };
  } catch { return null; }
}

export function saveParticipantProfile(sessionId, profile) {
  try {
    if (sessionId && profile) {
      localStorage.setItem(`${PARTICIPANT_KEY}_${sessionId}`, JSON.stringify(profile));
    }
  } catch (e) {
    console.error('Could not save participant profile:', e);
  }
}

export function clearParticipantProfile(sessionId) {
  try {
    if (sessionId) {
      localStorage.removeItem(`${PARTICIPANT_KEY}_${sessionId}`);
      localStorage.removeItem(`viewme_participant_${sessionId}`);
    }
    // Also clear obsolete global fallback key if present
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

  const sessions = getRawSessions();
  const session = sessions.find((s) => s.id === sessionId);
  const categories = session?.categories || ['Category A', 'Category B', 'Category C'];

  const newName = (newProfile.name || '').trim();
  const newCategory = resolveCategoryInSession(categories, newProfile.category || oldProfile?.category || 'Category A');
  const newEmail = (newProfile.email || '').trim();
  const newPhone = (newProfile.phone || '').trim();
  const newContact = (newProfile.contact || (newEmail && newPhone ? `${newEmail} • ${newPhone}` : newEmail || newPhone)).trim();
  const nextEditCount = currentEdits + 1;

  const oldName = oldProfile?.name ? oldProfile.name.trim() : '';
  const oldEmail = oldProfile?.email ? oldProfile.email.trim() : '';
  const oldPhone = oldProfile?.phone ? oldProfile.phone.trim() : '';
  const oldCleanPhone = oldPhone.replace(/\D/g, '');
  const oldContact = oldProfile?.contact ? oldProfile.contact.trim() : '';
  const oldCategory = resolveCategoryInSession(categories, oldProfile?.category || 'Category A');

  const categoryChanged = !matchCategory(oldCategory, newCategory);

  // Look up existing attendee first
  const attendees = getRawAttendees();
  const oldKey = `${sessionId}_${(oldEmail || oldContact).toLowerCase()}`;
  const newKey = `${sessionId}_${(newEmail || newContact).toLowerCase()}`;

  let existingAtt = null;
  Object.entries(attendees).forEach(([k, a]) => {
    if (!k.startsWith(`${sessionId}_`)) return;
    const aEmail = (a.email || '').trim().toLowerCase();
    const aPhone = (a.phone || '').replace(/\D/g, '');
    const aName = (a.name || '').trim().toLowerCase();
    if (
      (oldEmail && aEmail && oldEmail.toLowerCase() === aEmail) ||
      (oldCleanPhone && oldCleanPhone.length >= 7 && aPhone && oldCleanPhone === aPhone) ||
      (oldName && aName && oldName.toLowerCase() === aName)
    ) {
      existingAtt = a;
    }
  });
  if (!existingAtt) {
    existingAtt = attendees[oldKey] || attendees[newKey];
  }

  const slotChangeCount = existingAtt?.slotChangeCount !== undefined
    ? existingAtt.slotChangeCount
    : (oldProfile?.slotChangeCount !== undefined ? oldProfile.slotChangeCount : 0);

  const bookings = getRawBookings();
  const blockedSlots = getRawBlockedSlots();

  // Find candidate's current booking
  let candidateBookingKey = null;
  let candidateBooking = null;
  Object.entries(bookings).forEach(([k, b]) => {
    if (!k.startsWith(`${sessionId}_`)) return;
    const bEmail = (b.candidateEmail || '').trim().toLowerCase();
    const bPhone = (b.candidatePhone || '').replace(/\D/g, '');
    const bName = (b.candidateName || '').trim().toLowerCase();
    if (
      (oldEmail && bEmail && oldEmail.toLowerCase() === bEmail) ||
      (oldCleanPhone && oldCleanPhone.length >= 7 && bPhone && oldCleanPhone === bPhone) ||
      (oldName && bName && oldName.toLowerCase() === bName)
    ) {
      candidateBookingKey = k;
      candidateBooking = b;
    }
  });

  // If category changed and candidate has an active booking:
  let migratedSlotId = null;
  if (categoryChanged && candidateBooking) {
    const parsed = parseSlotId(candidateBooking.slotId, oldCategory);
    const startMins = parsed?.startMinutes !== undefined ? parsed.startMinutes : candidateBooking.startMinutes;
    const endMins = parsed?.endMinutes !== undefined ? parsed.endMinutes : candidateBooking.endMinutes;

    if (startMins !== undefined && endMins !== undefined) {
      const newCanonicalSlug = getCanonicalCategorySlug(newCategory);
      const targetSlotId = `slot_${newCanonicalSlug}_${startMins}_${endMins}`;
      const targetKey = `${sessionId}_${targetSlotId}`;

      // Check if target slot in new category is available
      const isTargetBlocked = Boolean(blockedSlots[targetKey] || findBlockedForSlot(blockedSlots, sessionId, { id: targetSlotId, startMinutes: startMins, endMinutes: endMins }, newCategory));
      const existingAtTarget = bookings[targetKey] || findBookingForSlot(bookings, sessionId, { id: targetSlotId, startMinutes: startMins, endMinutes: endMins }, newCategory);

      if (isTargetBlocked || (existingAtTarget && existingAtTarget !== candidateBooking)) {
        const timeLabel = `${minutesTo12Hour(startMins)} – ${minutesTo12Hour(endMins)}`;
        throw new Error(`Cannot change to ${newCategory}: The ${timeLabel} slot in ${newCategory} is already reserved by another candidate. Please use 'Change Slot' on the schedule board to select an open time.`);
      }

      // Migrate booking to new category slot
      delete bookings[candidateBookingKey];
      if (isFirebaseConfigured() && db) {
        deleteDoc(doc(db, 'bookings', candidateBookingKey)).catch(() => {});
      }

      const migratedBookingRecord = {
        ...candidateBooking,
        slotId: targetSlotId,
        candidateName: newName,
        candidateCategory: newCategory,
        candidateEmail: newEmail,
        candidatePhone: newPhone,
        candidateContact: newContact,
        startMinutes: startMins,
        endMinutes: endMins
      };

      bookings[targetKey] = migratedBookingRecord;
      saveRawBookings(bookings);

      if (isFirebaseConfigured() && db) {
        setDoc(doc(db, 'bookings', targetKey), migratedBookingRecord).catch(() => {});
      }

      migratedSlotId = targetSlotId;
      broadcast('SLOT_CANCELLED', { sessionId, slotId: candidateBooking.slotId });
      broadcast('SLOT_BOOKED', { sessionId, slotId: targetSlotId, booking: migratedBookingRecord });
    }
  } else if (candidateBooking && candidateBookingKey) {
    // Only name/contact updated
    bookings[candidateBookingKey] = {
      ...candidateBooking,
      candidateName: newName,
      candidateCategory: newCategory,
      candidateEmail: newEmail,
      candidatePhone: newPhone,
      candidateContact: newContact
    };
    saveRawBookings(bookings);
    if (isFirebaseConfigured() && db) {
      setDoc(doc(db, 'bookings', candidateBookingKey), bookings[candidateBookingKey], { merge: true }).catch(() => {});
    }
  }

  const finalBookedSlotId = migratedSlotId || existingAtt?.bookedSlotId || (candidateBooking ? candidateBooking.slotId : null);

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

  saveParticipantProfile(sessionId, profileRecord);

  // Update attendees list
  if (existingAtt) {
    const updatedAttRecord = {
      ...existingAtt,
      id: newKey,
      name: newName,
      category: newCategory,
      email: newEmail,
      phone: newPhone,
      contact: newContact,
      bookedSlotId: finalBookedSlotId,
      editCount: nextEditCount,
      slotChangeCount: existingAtt.slotChangeCount !== undefined ? existingAtt.slotChangeCount : slotChangeCount,
      lastSeenAt: new Date().toISOString()
    };

    if (oldKey !== newKey) {
      delete attendees[oldKey];
    }
    attendees[newKey] = updatedAttRecord;
    saveRawAttendees(attendees);

    if (isFirebaseConfigured() && db) {
      if (oldKey !== newKey) {
        deleteDoc(doc(db, 'attendees', oldKey)).catch(() => {});
      }
      setDoc(doc(db, 'attendees', newKey), { ...updatedAttRecord, sessionId }, { merge: true }).catch(() => {});
    }
  } else {
    recordSessionAttendee(sessionId, profileRecord);
  }

  logActivityEvent({
    type: 'USER_UPDATED_INFO',
    sessionId: sessionId,
    sessionTitle: session?.title || 'Session',
    actor: newName,
    details: `Updated info (Category: ${newCategory}, ${newEmail}, ${newPhone}) [Edit ${nextEditCount}/2]`
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



