'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const v = require('../middleware/validate');
const meetingService = require('../services/meetingService');

const router = express.Router();

/**
 * POST /answer  (desktop HTTP fallback for the socket "answer" event)
 * body: { question, answer, summary[], transcript?, meetingId?, latencyMs?, model? }
 * Persists then fans out to every socket in the user's room.
 */
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const question = v.str(req.body.question, 'question', { required: false, max: 2000 });
    const answer = v.str(req.body.answer, 'answer', { max: 8000 });
    const summary = v.strArray(req.body.summary, 'summary', { max: 10 });
    const transcript = v.str(req.body.transcript, 'transcript', { required: false, max: 8000 });

    const meeting = await meetingService.ensureMeeting({
      userId: req.user.id,
      deviceId: req.deviceId,
      meetingId: req.body.meetingId,
    });

    const saved = await meetingService.saveAnswer({
      userId: req.user.id,
      meetingId: meeting.id,
      deviceId: req.deviceId,
      question,
      answer,
      summary,
      transcript,
      latencyMs: req.body.latencyMs,
      model: req.body.model,
    });

    const io = req.app.get('io');
    if (io) io.to(`user:${req.user.id}`).emit('answer', saved);

    res.status(201).json(saved);
  })
);

/** POST /answer/transcript - persist a transcript line (socket has the same event). */
router.post(
  '/transcript',
  requireAuth,
  asyncHandler(async (req, res) => {
    const text = v.str(req.body.text, 'text', { max: 8000 });
    const meeting = await meetingService.ensureMeeting({
      userId: req.user.id,
      deviceId: req.deviceId,
      meetingId: req.body.meetingId,
    });

    const saved = await meetingService.saveTranscript({
      userId: req.user.id,
      meetingId: meeting.id,
      deviceId: req.deviceId,
      text,
      isQuestion: Boolean(req.body.isQuestion),
    });

    const io = req.app.get('io');
    if (io && saved) io.to(`user:${req.user.id}`).emit('transcript', saved);

    res.status(201).json(saved || { skipped: true });
  })
);

module.exports = router;
