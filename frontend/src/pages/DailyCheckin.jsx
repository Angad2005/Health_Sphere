import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Button from '../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import Textarea from '../components/ui/Textarea';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/ToastProvider';
import { useAuth } from '../context/AuthContext';
import RiskChart from '../components/RiskChart';
import { analyzeCheckinApi, aiHealth, fetchRiskSeries, fetchCheckins, generateQuestionsApi } from '../services/api';

export default function DailyCheckin() {
  const { notify: originalNotify } = useToast();
  const { user, loading: authLoading } = useAuth();

  // Use ref to avoid re-creating callbacks on every notify change
  const notify = useRef(originalNotify);
  useEffect(() => {
    notify.current = originalNotify;
  }, [originalNotify]);

  // State...
  const [questions, setQuestions] = useState([]);
  const [questionVersion, setQuestionVersion] = useState('');
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [answers, setAnswers] = useState({});
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

  const safeParseLLMAnalysis = (analysis) => {
    if (!analysis) return null;
    if (typeof analysis === 'string') {
      try {
        return JSON.parse(analysis);
      } catch (e) {
        console.error('Failed to parse llm_analysis:', e);
        return null;
      }
    }
    return analysis;
  };

  const getFallbackQuestions = () => [/* ... same as before ... */];
  const getFallbackAnswers = () => ({/* ... same as before ... */});

  // ✅ Stable fetchQuestions using notify ref
  const fetchQuestions = useCallback(async (userId) => {
    if (!userId) return;
    try {
      setLoadingQuestions(true);
      const result = await generateQuestionsApi(userId);
      if (result.ok && Array.isArray(result.questions)) {
        const { questions: fetchedQuestions, question_version } = result;
        const validQuestions = fetchedQuestions.filter(q =>
          q.id && q.question && q.type === 'scale' && Array.isArray(q.options) && q.options.length > 0
        );
        const finalQuestions = validQuestions.length > 0 ? validQuestions : getFallbackQuestions();
        setQuestions(finalQuestions);
        setQuestionVersion(question_version || '1.0');
        const initialAnswers = {};
        finalQuestions.forEach(q => { initialAnswers[q.id] = ''; });
        setAnswers(initialAnswers);
      } else {
        notify.current('Failed to load personalized questions. Using default set.', 'warning');
        setQuestions(getFallbackQuestions());
        setAnswers(getFallbackAnswers());
        setQuestionVersion('fallback');
      }
    } catch (err) {
      console.error('[DailyCheckin] fetchQuestions error:', err);
      notify.current('Error fetching questions. Using default set.', 'error');
      setQuestions(getFallbackQuestions());
      setAnswers(getFallbackAnswers());
      setQuestionVersion('fallback');
    } finally {
      setLoadingQuestions(false);
    }
  }, []); // ✅ No deps — uses notify ref

  const isValid = useMemo(() => {
    return questions.every(q => !q.required || answers[q.id]);
  }, [questions, answers]);

  const checkSubmittedToday = useCallback(async (userId) => {
    try {
      const items = await fetchCheckins(userId, 1);
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
      notify.current('Error checking today’s submission status.', 'error');
      return false;
    }
  }, []); // ✅ Stable

  const loadHistory = useCallback(async (userId) => {
    try {
      const items = await fetchCheckins(userId, 30);
      setHistory(items);

      try {
        const r = await fetchRiskSeries(userId);
        if (r.ok && Array.isArray(r.points) && r.points.length > 0) {
          setPoints(r.points);
          setLabels(r.labels.map(s => {
            try { return new Date(s).toLocaleDateString(); } catch { return s; }
          }));
        }
      } catch (_) {
        console.error('[DailyCheckin] fetchRiskSeries error');
      }

      if (items.length > 0 && items[0].llm_analysis) {
        const analysis = safeParseLLMAnalysis(items[0].llm_analysis);
        setTrendLabel(analysis?.trends?.length > 0 ? analysis.trends[0] : 'Stable');
      } else {
        setTrendLabel('Stable');
      }
    } catch (err) {
      console.error('[DailyCheckin] loadHistory error:', err);
    }
  }, []); // ✅ Stable

  // ✅ Main effect: only runs when user or authLoading changes
  useEffect(() => {
    const userId = user?.uid || 'demo';
    if (!userId || authLoading) return;

    fetchQuestions(userId);
    checkSubmittedToday(userId);
    loadHistory(userId);
  }, [user?.uid, authLoading]); // ✅ Only these deps

  // AI Health check (runs once on mount)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setAiLoading(true);
        const r = await aiHealth();
        if (mounted) setAiStatus(r);
      } catch (err) {
        console.error('[DailyCheckin] aiHealth error:', err);
        if (mounted) {
          setAiStatus({ ok: false, error: 'AI service unavailable' });
          notify.current('AI service is currently unavailable. Using default questions.', 'warning');
        }
      } finally {
        if (mounted) setAiLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []); // ✅ Runs once

  const setField = useCallback((name, value) => {
    setAnswers(prev => ({ ...prev, [name]: value }));
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    const userId = user?.uid || 'demo';

    if (!userId || authLoading) {
      notify.current('Please sign in to submit a check-in.', 'error');
      return;
    }
    if (submittedToday) {
      notify.current("You've already completed today's check-in.", 'info');
      return;
    }
    if (!isValid) {
      notify.current('Please answer all required questions.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        user_id: userId,
        answers,
        notes: notes || null,
        questions,
        question_version: questionVersion,
      };

      await analyzeCheckinApi(payload);

      notify.current('Daily check-in saved with AI analysis!', 'success');
      setSubmittedToday(true);
      await checkSubmittedToday(userId);
      // loadHistory intentionally not called here
    } catch (err) {
      console.error('[DailyCheckin] Submit error:', err);
      const msg = err?.message || 'Failed to save check-in. Please try again.';
      notify.current(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loadingQuestions || authLoading) {
    return (
      <div className="relative bg-[radial-gradient(ellipse_at_top_left,rgba(125,211,252,0.22),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(167,139,250,0.18),transparent_60%)] min-h-[600px] flex items-center justify-center">
        <div className="text-center">
          <Spinner size={32} />
          <p className="mt-4 text-slate-600 dark:text-slate-300">Generating your personalized questions...</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            AI is analyzing your health history for today's check-in
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative bg-[radial-gradient(ellipse_at_top_left,rgba(125,211,252,0.22),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(167,139,250,0.18),transparent_60%)]">
      <div className="pointer-events-none absolute -top-20 -right-10 h-56 w-56 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-10 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-6 text-slate-900 dark:text-slate-100 flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-tr from-brand-600 to-blue-500 text-white text-sm shadow ring-1 ring-brand-500/30">✨</span>
        Daily Check-in
      </h1>

      {/* AI Status and Question Version */}
      <div className="mb-6 flex items-center justify-between">
        <div className="text-sm text-slate-600 dark:text-slate-300">
          {aiLoading ? (
            <span>Loading AI status...</span>
          ) : aiStatus?.ok ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Health AI · Online (v{questionVersion})
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              AI Offline - Using default questions
            </span>
          )}
        </div>
      </div>

      {/* Why this matters */}
      <div className="grid grid-cols-1 gap-6">
        <Card className="border-0 ring-1 ring-slate-900/5 shadow-md bg-white/85 dark:bg-slate-900/85 rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20l9-5-9-5-9 5 9 5z"/><path d="M12 12l9-5-9-5-9 5 9 5z"/></svg>
              Personalized for You
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-slate-600 dark:text-slate-300 space-y-2 leading-relaxed">
              <p><strong>AI-Powered:</strong> These questions (v{questionVersion}) are customized based on your health history and recent trends.</p>
              <p>Your responses help the AI track patterns and provide smarter insights over time.</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Recent check-ins */}
          <Card className="border-0 ring-1 ring-slate-900/5 shadow-md bg-white/85 dark:bg-slate-900/85 rounded-2xl md:order-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/></svg>
                Your Recent Trends
              </CardTitle>
            </CardHeader>
            <CardContent>
              {points.length > 0 ? (
                <div className="space-y-4">
                  <div className="text-sm text-slate-600 dark:text-slate-300">
                    AI Risk Trend: <span className={`font-medium ${trendLabel === 'Worsening' ? 'text-red-600' : trendLabel === 'Improving' ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-200'}`}>{trendLabel}</span>
                  </div>
                  <div className="bg-white dark:bg-slate-950 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <RiskChart points={points} labels={labels} title="AI Risk Score" yRange={{ min: 0, max: 1 }} />
                  </div>
                  <ul className="divide-y divide-slate-200 dark:divide-slate-800 text-sm rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800">
                    {history.slice(0, 10).map((h, i) => (
                      <li key={h.id || i} className="py-2 px-3 flex items-center justify-between hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                        <span className="text-slate-600 dark:text-slate-300">{new Date(h.date).toLocaleDateString()}</span>
                        <span className="font-medium tabular-nums">
                          {h.llm_analysis ? safeParseLLMAnalysis(h.llm_analysis)?.risk_score?.toFixed(3) || '—' : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-sm text-slate-600 dark:text-slate-300">No history yet. Your first check-in will start the trend!</div>
              )}
            </CardContent>
          </Card>

          {/* Today's Check-in */}
          <Card className="border-0 ring-1 ring-slate-900/5 shadow-md bg-white/85 dark:bg-slate-900/85 rounded-2xl md:order-2">
            <CardHeader>
              <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 2v4M16 2v4M3 10h18M5 22h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"/></svg>
                Today's Personalized Check-in
              </CardTitle>
            </CardHeader>
            <CardContent>
              {submittedToday ? (
                <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
                  <p className="font-medium flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 text-sm font-mono">✓</span>
                    Today's check-in completed
                  </p>
                  {latestSubmission && latestSubmission.llm_analysis && (
                    <div className="mt-6 p-4 rounded-xl bg-gradient-to-r from-emerald-50/80 to-blue-50/80 dark:from-emerald-950/20 dark:to-blue-950/20 border border-emerald-200/60 dark:border-emerald-800/50">
                      {(() => {
                        const analysis = safeParseLLMAnalysis(latestSubmission.llm_analysis);
                        if (!analysis) return <p className="text-xs text-slate-500">No AI analysis available.</p>;
                        return (
                          <>
                            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300 mb-2">
                              AI Summary: {analysis.summary || 'Analysis complete'}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Risk Score: <span className="font-mono font-medium">{analysis.risk_score?.toFixed(3)}</span>
                            </p>
                            {analysis.concerns?.length > 0 && (
                              <div className="mt-2">
                                <strong>Concerns:</strong>
                                <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-slate-300">
                                  {analysis.concerns.map((concern, idx) => (
                                    <li key={idx}>{concern}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {analysis.recommendations?.length > 0 && (
                              <div className="mt-2">
                                <strong>Recommendations:</strong>
                                <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-slate-300">
                                  {analysis.recommendations.map((rec, idx) => (
                                    <li key={idx}>{rec}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={onSubmit} className="space-y-10">
                  <div className="inline-flex items-center gap-2 rounded-full border border-blue-200/60 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-900/20 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                    <span className="inline-block h-2 w-2 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 animate-pulse" />
                    <span>AI-Generated Questions (v{questionVersion}, {questions.length} questions)</span>
                  </div>

                  <div className="space-y-6">
                    {questions.map((q, idx) => (
                      <div key={q.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-slate-900/60 p-5 md:p-6 transition hover:shadow-md hover:scale-[1.01] group">
                        <div className="flex items-center gap-3 mb-3">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-tr from-brand-600 to-blue-500 text-white text-[11px] shadow ring-1 ring-brand-500/30">
                            {idx + 1}
                          </span>
                          <label className="block text-sm md:text-base font-medium text-slate-800 dark:text-slate-100 leading-snug">
                            {q.question}
                            {q.required && <span className="text-red-500 ml-1">*</span>}
                          </label>
                          {q.category && (
                            <span className="ml-auto px-2 py-1 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {q.category}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-3">
                          {q.options.map(opt => (
                            <button
                              type="button"
                              key={opt}
                              onClick={() => setField(q.id, opt)}
                              className={`px-4 py-3 rounded-xl border text-sm text-left transition transform focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900 group-hover:-translate-y-[1px] ${
                                answers[q.id] === opt
                                  ? 'bg-gradient-to-tr from-brand-600 to-blue-500 text-white border-transparent shadow-md ring-brand-500/40'
                                  : 'bg-white/80 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Additional notes (optional)</label>
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-slate-900/60 p-3">
                      <Textarea
                        value={notes}
                        onChange={e => setNotes(e.target.value.slice(0, 1000))}
                        placeholder="Anything else about your health today? New symptoms, medications, etc..."
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <div className="text-xs text-slate-500">
                      {Object.values(answers).filter(Boolean).length}/{questions.length} questions completed
                    </div>
                    <Button
                      type="submit"
                      disabled={isSubmitting || !isValid || authLoading}
                      className="shadow-md"
                    >
                      {isSubmitting ? (
                        <span className="inline-flex items-center gap-2">
                          <Spinner size={16} />
                          Saving with AI Analysis...
                        </span>
                      ) : (
                        `Save Today's Check-in (${questions.length} questions)`
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