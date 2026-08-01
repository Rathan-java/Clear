'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const meetingService = require('../services/meetingService');

const router = express.Router();

/**
 * GET /history?limit=50&before=<ms>&meetingId=&search=
 * Answer feed for the phone's History tab (newest first, cursor paginated).
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const answers = await meetingService.listAnswers({
      userId: req.user.id,
      meetingId: req.query.meetingId,
      limit: req.query.limit,
      before: req.query.before,
      search: req.query.search,
    });

    const nextCursor = answers.length ? answers[answers.length - 1].createdAtMs : null;
    res.json({ answers, nextCursor, count: answers.length });
  })
);

/** GET /history/meetings */
router.get(
  '/meetings',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ meetings: await meetingService.listMeetings({ userId: req.user.id, limit: req.query.limit }) });
  })
);

/** GET /history/meetings/:meetingId - full transcript + answers for one meeting. */
router.get(
  '/meetings/:meetingId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [transcripts, answers] = await Promise.all([
      meetingService.listTranscripts({ userId: req.user.id, meetingId: req.params.meetingId }),
      meetingService.listAnswers({ userId: req.user.id, meetingId: req.params.meetingId, limit: 200 }),
    ]);
    res.json({ meetingId: req.params.meetingId, transcripts, answers });
  })
);

module.exports = router;
