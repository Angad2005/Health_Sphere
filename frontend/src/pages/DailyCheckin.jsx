// src/pages/DailyCheckin.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { riskFromAnswersV2 } from '../utils/scoreHelpers';
import Button from '../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import Textarea from '../components/ui/Textarea';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/ToastProvider';
import { useAuth } from '../context/AuthContext';
import RiskChart from '../components/RiskChart';
import { analyzeCheckinApi, aiHealth, fetchRiskSeries, fetchCheckins } from '../services/api';

export default function DailyCheckin() {
  const { notify } = useToast();
  const { user, loading: authLoading } = useAuth();

  const [answers, setAnswers] = useState({
    ns_q1: '',
    ns_q2: '',
    ns_q3: '',
    ns_q4: '',
    ns_q5: '',
    ns_q6: '',
    ns_q7: '',
    ns_q8: '',
    ns_q9: '',
    ns_q10: '',
    ns_q11: '',
    ns_q12: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedToday, setSubmittedToday] = useState(false);
  const [latestSubmission, setLatestSubmission] = useState(null);
  const [history, setHistory] = useState([]);
  const [points, setPoints] = useState([]);
  const [trendLabel, setTrendLabel] = useState('');
  const [labels, setLabels] = useState([]);
  const [notes, setNotes] = useState('');
  const [aiStatus, setAiStatus] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [topK, setTopK] = useState(3);
  const [explainMethod, setExplainMethod] = useState('auto');
  const [useScipyWinsorize, setUseScipyWinsorize] = useState(true);
  const [forceLocal, setForceLocal] = useState(false);

  // Load analysis prefs
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('analysisPrefs') || '{}');
      if (saved && typeof saved === 'object') {
        if (saved.topK) setTopK(saved.topK);
        if (saved.explainMethod) setExplainMethod(saved.explainMethod);
        if (typeof saved.useScipyWinsorize === 'boolean') setUseScipyWinsorize(saved.useScipyWinsorize);
        if (typeof saved.forceLocal === 'boolean') setForceLocal(saved.forceLocal);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('analysisPrefs', JSON.stringify({ topK, explainMethod, useScipyWinsorize, forceLocal }));
    } catch (_) {}
  }, [topK, explainMethod, useScipyWinsorize, forceLocal]);

  const isValid = useMemo(() => {
    const requiredKeys = ['ns_q1','ns_q2','ns_q3','ns_q4','ns_q5','ns_q6','ns_q7','ns_q8','ns_q9','ns_q10','ns_q11','ns_q12'];
    return requiredKeys.every(k => answers[k]);
  }, [answers]);

  // Check if user submitted today
  async function checkSubmittedToday(userId) {
    try {
      const items = await fetchCheckins(userId, 1); // fetch latest
      if (items.length > 0) {
        const latest = items[0];
        const today = new Date();
        const checkinDate = new Date(latest.date);
        const isToday = checkinDate.toDateString() === today.toDateString();
        if (isToday) {
          setSubmittedToday(true);
          setLatestSubmission(latest);
          return true;
        }
      }
      setSubmittedToday(false);
      setLatestSubmission(null);
      return false;
    } catch (err) {
      console.error('[DailyCheckin] checkSubmittedToday error:', err);
      return false;
    }
  }

  // Load history and compute trend
  async function loadHistory(userId) {
    try {
      const items = await fetchCheckins(userId, 30);
      const reversed = items.slice().reverse();
      let pts = reversed.map(it => riskFromAnswersV2(it.answers));
      let lbls = reversed.map(it => new Date(it.date).toLocaleDateString());

      // Prefer backend risk series if AI is available
      try {
        if (aiStatus?.python?.available) {
          const r = await fetchRiskSeries(userId);
          if (r.ok && Array.isArray(r.points) && r.points.length > 0) {
            pts = r.points;
            lbls = r.labels.map(s => {
              try { return new Date(s).toLocaleDateString(); } catch { return s; }
            });
          }
        }
      } catch (_) {}

      const n = pts.length;
      let trend = '';
      if (n >= 6) {
        const prev = pts.slice(n - 6, n - 3).reduce((s, v) => s + v, 0) / 3;
        const last = pts.slice(n - 3).reduce((s, v) => s + v, 0) / 3;
        const delta = last - prev;
        if (delta > 0.06) trend = 'Worsening';
        else if (delta < -0.06) trend = 'Improving';
        else trend = 'Stable';
      }

      setHistory(items);
      setPoints(pts);
      setLabels(lbls);
      setTrendLabel(trend);
    } catch (err) {
      console.error('[DailyCheckin] loadHistory error:', err);
    }
  }

  // Initialize: check today + load history
  useEffect(() => {
    const userId = user?.uid || 'demo';
    if (!userId) return;

    checkSubmittedToday(userId);
    loadHistory(userId);
  }, [user?.uid]);

  // Check AI health
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setAiLoading(true);
        const r = await aiHealth();
        if (mounted) setAiStatus(r);
      } catch (_) {
        if (mounted) setAiStatus({ ok: true, python: { available: false } });
      } finally {
        if (mounted) setAiLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  function setField(name, value) {
    setAnswers(prev => ({ ...prev, [name]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    const userId = user?.uid || 'demo';

    if (!userId) {
      notify('User not authenticated', 'error');
      return;
    }
    if (submittedToday) {
      notify("You've already completed today's check-in.", 'info');
      return;
    }
    if (!isValid) {
      notify('Please answer all required questions.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        answers,
        notes: notes || null,
        topK: Number(topK),
        explainMethod,
        useScipyWinsorize,
        forceLocal,
      };

      // This calls Flask /functions/analyzeCheckin → saves to SQLite
      await analyzeCheckinApi({ payload });

      notify('Daily check-in saved!', 'success');
      setSubmittedToday(true);

      // Refresh data
      await checkSubmittedToday(userId);
      await loadHistory(userId);
    } catch (err) {
      console.error('[DailyCheckin] Submit error:', err);
      const msg = err?.message || 'Failed to save check-in. Please try again.';
      notify(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Scoring function (for display only)
  function scoreFromAnswers(a) {
    if (!a) return 0.5;
    const map4 = (v) => ({
      'None': 1.0,
      'Normal': 1.0,
      'Mild': 0.7,
      'Moderate': 0.4,
      'Severe': 0.2,
    })[v?.split(' –')?.[0]] ?? 0.5;

    const parts = [
      map4(a.ns_q1), map4(a.ns_q2), map4(a.ns_q3), map4(a.ns_q4), map4(a.ns_q5),
      map4(a.ns_q6), map4(a.ns_q7), map4(a.ns_q8), map4(a.ns_q9), map4(a.ns_q10),
      map4(a.ns_q11), map4(a.ns_q12)
    ];
    const avg = parts.reduce((s, v) => s + v, 0) / parts.length;
    return Math.max(0, Math.min(1, Number(avg.toFixed(3))));
  }

  return (
    <div className="relative bg-[radial-gradient(ellipse_at_top_left,rgba(125,211,252,0.22),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(167,139,250,0.18),transparent_60%)]">
      <div className="pointer-events-none absolute -top-20 -right-10 h-56 w-56 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-10 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-6 text-slate-900 dark:text-slate-100 flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-tr from-brand-600 to-blue-500 text-white text-sm shadow ring-1 ring-brand-500/30">✓</span>
        Daily Check-in
      </h1>

      {/* Why this matters */}
      <div className="grid grid-cols-1 gap-6">
        <Card className="border-0 ring-1 ring-slate-900/5 shadow-md bg-white/85 dark:bg-slate-900/85 rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20l9-5-9-5-9 5 9 5z"/><path d="M12 12l9-5-9-5-9 5 9 5z"/></svg>
              Why this matters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-slate-600 dark:text-slate-300 space-y-2 leading-relaxed">
              <p>Your daily responses help track trends in sleep, mood, pain, and lifestyle. If you report concerning symptoms, your clinician or AI assistant can prioritize guidance.</p>
              <p>We limit to one check-in per day to keep insights consistent. You can update tomorrow if anything changes.</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Recent check-ins */}
          <Card className="border-0 ring-1 ring-slate-900/5 shadow-md bg-white/85 dark:bg-slate-900/85 rounded-2xl md:order-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/></svg>
                Your recent check-ins
              </CardTitle>
            </CardHeader>
            <CardContent>
              {points.length > 0 ? (
                <div className="space-y-4">
                  <div className="text-sm text-slate-600 dark:text-slate-300">
                    Overall trend: <span className={`font-medium ${trendLabel === 'Worsening' ? 'text-red-600' : trendLabel === 'Improving' ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-200'}`}>{trendLabel || 'Not enough data'}</span>
                  </div>
                  <div className="bg-white dark:bg-slate-950 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <RiskChart points={points} labels={labels} title={aiStatus?.python?.available ? 'AI risk' : 'Risk'} yRange={{ min: 0, max: 1 }} />
                  </div>
                  <ul className="divide-y divide-slate-200 dark:divide-slate-800 text-sm rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800">
                    {history.slice(0, 10).map((h, i) => (
                      <li key={h.id || i} className="py-2 px-3 flex items-center justify-between hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                        <span className="text-slate-600 dark:text-slate-300">{new Date(h.date).toLocaleDateString()}</span>
                        <span className="font-medium tabular-nums">{scoreFromAnswers(h.answers)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-sm text-slate-600 dark:text-slate-300">No history yet.</div>
              )}
            </CardContent>
          </Card>

          {/* Today's Check-in */}
          <Card className="border-0 ring-1 ring-slate-900/5 shadow-md bg-white/85 dark:bg-slate-900/85 rounded-2xl md:order-2">
            <CardHeader>
              <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 2v4M16 2v4M3 10h18M5 22h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"/></svg>
                Today's Check-in
              </CardTitle>
            </CardHeader>
            <CardContent>
              {submittedToday ? (
                <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
                  <p className="font-medium">You've already submitted today's check-in.</p>
                  {latestSubmission && (
                    <div className="mt-4">
                      <p className="text-xs text-slate-500 mb-2">Your last responses:</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {Object.entries(latestSubmission.answers || {}).map(([key, value]) => (
                          <div key={key} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-white/70 dark:bg-slate-900/60">
                            <div className="text-[11px] uppercase tracking-wide text-slate-500">{key.replace('ns_q', 'Q')}</div>
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{value || '—'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={onSubmit} className="space-y-10">
                  <div className="inline-flex items-center gap-2 rounded-full border border-blue-200/60 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-900/20 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                    <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                    Daily Symptom Tracking MCQs
                  </div>

                  {[
                    { key: 'ns_q1', title: 'Stomach / Abdominal Pain Today', opts: ['None','Mild – occasional discomfort','Moderate – noticeable, affects tasks','Severe – persistent pain'] },
                    { key: 'ns_q2', title: 'Headache or Migraine Today', opts: ['None','Mild – didn’t interfere with work','Moderate – interfered with tasks','Severe – unable to perform daily activities'] },
                    { key: 'ns_q3', title: 'Nausea or Vomiting Today', opts: ['None','Mild – occasional queasiness','Moderate – affected meals','Severe – persistent vomiting'] },
                    { key: 'ns_q4', title: 'Fatigue or Weakness Today', opts: ['None – felt energetic','Mild – slightly tired','Moderate – noticeable fatigue','Severe – could barely perform activities'] },
                    { key: 'ns_q5', title: 'Fever or Chills Today', opts: ['None','Mild – slight temperature fluctuation','Moderate – measurable fever (100–102°F / 37.7–38.8°C)','Severe – high fever (>102°F / 38.8°C)'] },
                    { key: 'ns_q6', title: 'Cough or Shortness of Breath Today', opts: ['None','Mild – occasional cough or shortness of breath','Moderate – daily cough or breathing difficulty','Severe – persistent cough or severe breathing issues'] },
                    { key: 'ns_q7', title: 'Changes in Bowel Movements Today', opts: ['Normal','Slight irregularity – mild constipation/diarrhea','Moderate – frequent or loose stools','Severe – persistent diarrhea/constipation'] },
                    { key: 'ns_q8', title: 'Changes in Urination Today', opts: ['Normal','Slight – minor discomfort or frequency change','Moderate – frequent or painful urination','Severe – inability to urinate normally or severe discomfort'] },
                    { key: 'ns_q9', title: 'Skin Changes / Wounds Today', opts: ['None','Minor – small rashes, bruises, or pimples','Noticeable – persistent rash, sores, or swelling','Severe – bleeding, large lesions, or non-healing wounds'] },
                    { key: 'ns_q10', title: 'Dizziness or Fainting Today', opts: ['None','Mild – occasional lightheadedness','Moderate – dizziness affecting tasks','Severe – fainting or inability to stand'] },
                    { key: 'ns_q11', title: 'Sleep / Insomnia Today', opts: ['Slept well – no trouble falling or staying asleep','Mild difficulty – took longer than usual to fall asleep','Moderate difficulty – frequent waking or poor sleep quality','Severe – hardly slept or very restless night'] },
                    { key: 'ns_q12', title: 'Hot Flashes / Sudden Warmth Today', opts: ['None – no unusual warmth','Mild – occasional warmth or flushing','Moderate – noticeable episodes affecting comfort','Severe – frequent or intense hot flashes'] },
                  ].map((q, idx) => (
                    <div key={q.key} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-slate-900/60 p-5 md:p-6 transition hover:shadow-md hover:scale-[1.01]">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-tr from-brand-600 to-blue-500 text-white text-[11px] shadow ring-1 ring-brand-500/30">{idx + 1}</span>
                        <label className="block text-sm md:text-base font-medium text-slate-800 dark:text-slate-100 leading-snug">{q.title}</label>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-3">
                        {q.opts.map(opt => (
                          <button
                            type="button"
                            key={opt}
                            onClick={() => setField(q.key, opt)}
                            className={`px-4 py-3 rounded-xl border text-sm text-left transition transform focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${answers[q.key] === opt ? 'bg-gradient-to-tr from-brand-600 to-blue-500 text-white border-transparent shadow-md ring-brand-500/40' : 'bg-white/80 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:shadow-md hover:-translate-y-[1px]'}`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div className="pt-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Add notes for today (optional)</label>
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-slate-900/60 p-3">
                      <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Type anything noteworthy about your health today..." />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <div className="text-xs text-slate-500">Complete all sections to enable saving.</div>
                    <Button type="submit" disabled={isSubmitting || !isValid || authLoading} className="shadow-md">
                      {isSubmitting ? (
                        <span className="inline-flex items-center gap-2"><Spinner size={16} /> Saving...</span>
                      ) : (
                        "Save today's check-in"
                      )}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}