import React, { useEffect, useState } from 'react';
import { Button, Card, Empty, Field, Pill } from './ui.jsx';

/**
 * Interview mode: upload a CV once, and every answer is written in the first
 * person using the real projects and numbers on it.
 */
const ProfilePanel = ({ settings, onPatchSettings }) => {
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [draft, setDraft] = useState({ jobTitle: '', jobDescription: '', notes: '' });
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');

  const mode = settings?.ai?.mode || 'meeting';
  const interview = mode === 'interview';

  const load = async () => {
    const next = await window.clear.invoke('profile:get');
    setProfile(next);
    setDraft({
      jobTitle: next.jobTitle || '',
      jobDescription: next.jobDescription || '',
      notes: next.notes || '',
    });
  };

  useEffect(() => {
    load();
  }, []);

  const upload = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await window.clear.invoke('profile:import');
    if (result.ok) {
      setProfile(result.profile);
      setNotice(`Read ${result.profile.resumeWords} words from ${result.profile.resumeFileName} (${result.method})`);
    } else if (!result.cancelled) {
      setError(result.error);
    }
    setBusy(false);
  };

  const savePasted = async () => {
    if (pasted.trim().length < 50) {
      setError('That looks too short to be a CV.');
      return;
    }
    setBusy(true);
    const result = await window.clear.invoke('profile:patch', {
      resumeText: pasted.trim(),
      resumeFileName: 'Pasted text',
    });
    if (result.ok) {
      setProfile(result.profile);
      setPasting(false);
      setPasted('');
      setNotice('CV saved');
      setError(null);
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  const saveDraft = async () => {
    setBusy(true);
    const result = await window.clear.invoke('profile:patch', draft);
    if (result.ok) {
      setProfile(result.profile);
      setNotice('Saved');
    }
    setBusy(false);
  };

  const clearResume = async () => {
    const result = await window.clear.invoke('profile:clearResume');
    if (result.ok) setProfile(result.profile);
  };

  if (!profile) {
    return (
      <div className="profile">
        <Card title="Interview profile">
          <div className="thinking">
            <span className="spinner" /> Loading…
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="profile">
      <Card
        title="Answer mode"
        subtitle="Interview mode answers in your voice, using your CV. Meeting mode answers factually."
      >
        <div className="mode-switch">
          <button
            type="button"
            className={`mode-option${!interview ? ' is-active' : ''}`}
            onClick={() => onPatchSettings({ ai: { mode: 'meeting' } })}
          >
            <span className="mode-option__icon">💬</span>
            <strong>Meeting</strong>
            <span>Neutral, factual answers to questions asked in the call</span>
          </button>

          <button
            type="button"
            className={`mode-option${interview ? ' is-active' : ''}`}
            onClick={() => onPatchSettings({ ai: { mode: 'interview' } })}
          >
            <span className="mode-option__icon">🎯</span>
            <strong>Interview</strong>
            <span>First-person answers grounded in your CV below</span>
          </button>
        </div>

        {interview && !profile.hasResume && (
          <p className="alert alert--warn">
            Interview mode is on but there is no CV yet, so answers will be generic. Add one below.
          </p>
        )}
      </Card>

      <Card
        title="Your CV"
        subtitle="Stays on this PC. Sent only as part of the prompt to the model you chose."
        actions={
          profile.hasResume && (
            <Button variant="ghost" size="sm" onClick={clearResume}>
              Remove
            </Button>
          )
        }
      >
        {profile.hasResume ? (
          <>
            <div className="cv-meta">
              <Pill tone="good">{profile.resumeFileName}</Pill>
              <Pill tone="neutral">{profile.resumeWords} words</Pill>
              {profile.resumeUpdatedAt && (
                <Pill tone="neutral">{new Date(profile.resumeUpdatedAt).toLocaleDateString()}</Pill>
              )}
            </div>
            <pre className="cv-preview">{profile.resumeText}</pre>
            {profile.truncated && <p className="muted">Showing the first 4,000 characters.</p>}
          </>
        ) : (
          <Empty icon="📄" title="No CV yet">
            Upload a PDF, DOCX, TXT or Markdown file, or paste the text straight in.
          </Empty>
        )}

        <div className="cv-actions">
          <Button variant="primary" size="sm" onClick={upload} loading={busy} disabled={busy}>
            {profile.hasResume ? 'Replace file' : 'Upload CV'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPasting((value) => !value)}>
            {pasting ? 'Cancel' : 'Paste text instead'}
          </Button>
        </div>

        {pasting && (
          <>
            <textarea
              className="cv-input"
              rows={10}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder="Paste your CV here…"
            />
            <Button variant="primary" size="sm" onClick={savePasted} disabled={busy}>
              Save CV
            </Button>
          </>
        )}

        {notice && <p className="alert alert--good">{notice}</p>}
        {error && <p className="alert alert--error">{error}</p>}
      </Card>

      <Card title="The role" subtitle="Optional, but it makes answers noticeably more targeted">
        <Field label="Job title">
          <input
            value={draft.jobTitle}
            onChange={(event) => setDraft({ ...draft, jobTitle: event.target.value })}
            placeholder="Senior Backend Engineer"
          />
        </Field>

        <Field label="Job description" hint="Paste the posting - the model will mirror its language">
          <textarea
            className="cv-input"
            rows={6}
            value={draft.jobDescription}
            onChange={(event) => setDraft({ ...draft, jobDescription: event.target.value })}
            placeholder="Paste the job description…"
          />
        </Field>

        <Field label="Extra notes" hint="Anything not on the CV: salary expectations, why you are leaving, gaps">
          <textarea
            className="cv-input"
            rows={4}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            placeholder="I am looking for…"
          />
        </Field>

        <Button variant="primary" size="sm" onClick={saveDraft} disabled={busy}>
          Save role details
        </Button>
      </Card>
    </div>
  );
};

export default ProfilePanel;
