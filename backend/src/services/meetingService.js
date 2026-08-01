'use strict';

const env = require('../config/env');
const { getDb, COLLECTIONS } = require('../config/firebase');
const { id, now } = require('../utils/ids');

const startMeeting = async ({ userId, deviceId, title }) => {
  const db = getDb();
  const meetingId = id();
  const meeting = {
    userId,
    deviceId: deviceId || null,
    title: title || `Meeting ${new Date().toLocaleString()}`,
    startedAt: now(),
    endedAt: null,
    status: 'live',
    transcriptCount: 0,
    answerCount: 0,
  };
  await db.collection(COLLECTIONS.meetings).doc(meetingId).set(meeting);
  return { id: meetingId, ...meeting };
};

const endMeeting = async ({ userId, meetingId }) => {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.meetings).doc(meetingId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().userId !== userId) return null;
  await ref.update({ endedAt: now(), status: 'ended' });
  return { id: meetingId, ...snap.data(), endedAt: now(), status: 'ended' };
};

const getActiveMeeting = async (userId) => {
  const db = getDb();
  const snap = await db
    .collection(COLLECTIONS.meetings)
    .where('userId', '==', userId)
    .where('status', '==', 'live')
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
};

/** Returns the live meeting, creating one if the desktop did not start it explicitly. */
const ensureMeeting = async ({ userId, deviceId, meetingId }) => {
  const db = getDb();
  if (meetingId) {
    const snap = await db.collection(COLLECTIONS.meetings).doc(meetingId).get();
    if (snap.exists && snap.data().userId === userId) return { id: snap.id, ...snap.data() };
  }
  const active = await getActiveMeeting(userId);
  if (active) return active;
  return startMeeting({ userId, deviceId });
};

const bumpCounter = async (meetingId, field) => {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.meetings).doc(meetingId);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.update({ [field]: (snap.data()[field] || 0) + 1, updatedAt: now() });
};

const saveTranscript = async ({ userId, meetingId, deviceId, text, isQuestion, startedAt, endedAt }) => {
  const db = getDb();
  const docId = id();
  const record = {
    userId,
    meetingId,
    deviceId: deviceId || null,
    text: String(text || '').trim(),
    textLower: String(text || '').trim().toLowerCase(),
    isQuestion: Boolean(isQuestion),
    startedAt: startedAt || now(),
    endedAt: endedAt || now(),
    createdAt: now(),
    createdAtMs: Date.now(),
  };
  if (!record.text) return null;
  await db.collection(COLLECTIONS.transcripts).doc(docId).set(record);
  await bumpCounter(meetingId, 'transcriptCount');
  return { id: docId, ...record };
};

const saveAnswer = async ({
  userId,
  meetingId,
  deviceId,
  question,
  answer,
  summary,
  transcript,
  latencyMs,
  model,
}) => {
  const db = getDb();
  const docId = id();
  const record = {
    userId,
    meetingId: meetingId || null,
    deviceId: deviceId || null,
    question: String(question || '').trim(),
    answer: String(answer || '').trim(),
    summary: Array.isArray(summary) ? summary.slice(0, 10).map(String) : [],
    transcript: String(transcript || '').slice(0, 4000),
    searchText: `${question || ''} ${answer || ''}`.toLowerCase(),
    latencyMs: Number(latencyMs) || null,
    model: model || null,
    createdAt: now(),
    createdAtMs: Date.now(),
  };
  await db.collection(COLLECTIONS.answers).doc(docId).set(record);
  if (meetingId) await bumpCounter(meetingId, 'answerCount');
  return { id: docId, ...record };
};

const listAnswers = async ({ userId, meetingId, limit, before, search }) => {
  const db = getDb();
  let query = db.collection(COLLECTIONS.answers).where('userId', '==', userId);
  if (meetingId) query = query.where('meetingId', '==', meetingId);
  if (before) query = query.where('createdAtMs', '<', Number(before));

  const snap = await query
    .orderBy('createdAtMs', 'desc')
    .limit(Math.min(Number(limit) || env.historyPageSize, 200))
    .get();

  let rows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  if (search) {
    const needle = String(search).toLowerCase();
    rows = rows.filter((row) => (row.searchText || '').includes(needle));
  }

  return rows.map(({ searchText, ...rest }) => rest);
};

const listMeetings = async ({ userId, limit }) => {
  const db = getDb();
  const snap = await db
    .collection(COLLECTIONS.meetings)
    .where('userId', '==', userId)
    .orderBy('startedAt', 'desc')
    .limit(Math.min(Number(limit) || 30, 100))
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

const listTranscripts = async ({ userId, meetingId, limit }) => {
  const db = getDb();
  const snap = await db
    .collection(COLLECTIONS.transcripts)
    .where('userId', '==', userId)
    .where('meetingId', '==', meetingId)
    .orderBy('createdAtMs', 'asc')
    .limit(Math.min(Number(limit) || 500, 1000))
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

module.exports = {
  startMeeting,
  endMeeting,
  getActiveMeeting,
  ensureMeeting,
  saveTranscript,
  saveAnswer,
  listAnswers,
  listMeetings,
  listTranscripts,
};
