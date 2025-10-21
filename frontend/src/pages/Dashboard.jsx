// src/pages/Dashboard.jsx
import React, { useEffect, useState } from 'react';
import Seo from '../components/Seo';
import { useNavigate } from 'react-router-dom';
import RiskChart from '../components/RiskChart';
import { findNearbyAmbulance, fetchRiskSeries, fetchCheckins } from '../services/api';
import Button from '../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/ToastProvider';
import Hero from '../components/Hero';
import StatCard from '../components/StatCard';
import { useAuth } from '../context/AuthContext';
import { riskFromAnswersV2 } from '../utils/scoreHelpers';

export default function Dashboard() {
  const { notify } = useToast();
  const { user } = useAuth(); // Ensure this provides a stable user ID (e.g., user.uid)
  const navigate = useNavigate();
  const [nearby, setNearby] = useState(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState(null);

  const [checkins, setCheckins] = useState([]);
  const [riskSeries, setRiskSeries] = useState([]);
  const [riskLabels, setRiskLabels] = useState([]);
  const [riskSummary, setRiskSummary] = useState({ level: 'Low', reason: 'No data yet.', score: 0 });

  // Rule-based scoring (same as before)
  function calculateRuleRisk(items) {
    let score = 0;
    let headacheDays = 0;
    let lowSleepDays = 0;
    let highStressStreak = 0;
    let currentStressStreak = 0;
    let clusterHighDays = 0;

    for (const it of items) {
      const a = it?.answers || {};
      const headache = a.ns_q2 && /mild|moderate|severe/i.test(a.ns_q2);
      const sleepLow = a.ns_q11 && /hardly|moderate difficulty/i.test(a.ns_q11);
      const stressHigh = a.ns_q5 && /(very low|low)/i.test(a.ns_q5);
      const nausea = a.ns_q3 && !/none/i.test(a.ns_q3);
      const weakness = a.ns_q4 && !/none/i.test(a.ns_q4);

      if (headache) { score += 2; headacheDays += 1; }
      if (sleepLow) { score += 3; lowSleepDays += 1; }
      if (stressHigh) { score += 4; currentStressStreak += 1; } else { currentStressStreak = 0; }
      if (currentStressStreak >= 5) highStressStreak = Math.max(highStressStreak, currentStressStreak);
      if ((nausea ? 1 : 0) + (weakness ? 1 : 0) >= 2) { score += 6; clusterHighDays += 1; }
    }

    let level = 'Low';
    let reason = 'No major recurring symptoms.';
    if (clusterHighDays >= 2) {
      level = 'High';
      reason = 'Multiple symptoms clustered (e.g., nausea + weakness) on several days.';
    } else if (highStressStreak >= 5) {
      level = 'Mid';
      reason = 'Sustained low mood/stress for 5+ days.';
    } else if (headacheDays >= 3 && lowSleepDays >= 3) {
      level = 'Mid';
      reason = 'Frequent headaches with low sleep across several days.';
    } else if (score >= 20) {
      level = 'High';
      reason = 'Multiple risk factors accumulated in recent logs.';
    } else if (score >= 10) {
      level = 'Mid';
      reason = 'Some recurring issues detected (sleep/mood/symptoms).';
    }
    return { level, reason, score };
  }

  // Load check-ins from Flask
  useEffect(() => {
    async function loadCheckins() {
      // For demo: fallback to 'demo' if no user
      const userId = user?.uid || 'demo';
      try {
        const items = await fetchCheckins(userId, 30);
        const reversed = items.slice().reverse();
        const series = reversed.map(it => riskFromAnswersV2(it.answers));
        const labels = reversed.map(it => new Date(it.date).toLocaleDateString());

        setCheckins(items);
        setRiskSeries(series);
        setRiskLabels(labels);

        // Try to override with backend risk series
        try {
          const r = await fetchRiskSeries(userId);
          if (r.ok && Array.isArray(r.points) && r.points.length > 0) {
            setRiskSeries(r.points);
            setRiskLabels(r.labels.map(s => {
              try { return new Date(s).toLocaleDateString(); } catch { return s; }
            }));
          }
        } catch (e) {
          console.warn('Using client-side risk series');
        }

        const rb = calculateRuleRisk(items);
        setRiskSummary(rb);
      } catch (err) {
        console.error('[Dashboard] loadCheckins error:', err);
        notify('Failed to load health data', 'error');
      }
    }
    loadCheckins();
  }, [user?.uid]);

  // Ambulance logic (fixed to use .ambulances)
  async function locateAmbulance() {
    try {
      setNearbyError(null);
      setNearbyLoading(true);
      if (!navigator.geolocation) {
        throw new Error('Geolocation not supported.');
      }
      notify('Finding nearby ambulance services...', 'info');
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          async pos => {
            try {
              const { latitude, longitude } = pos.coords;
              const r = await findNearbyAmbulance(latitude, longitude);
              setNearby(r); // r = { ambulances: [...] }
              const count = Array.isArray(r.ambulances) ? r.ambulances.length : 0;
              notify(`Found ${count} ambulance service${count === 1 ? '' : 's'}`, 'success');
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          err => reject(new Error(err.message || 'Location access denied')),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });
    } catch (e) {
      const message = e.message || 'Failed to locate ambulances';
      setNearbyError(message);
      notify(message, 'error');
    } finally {
      setNearbyLoading(false);
    }
  }

  // Rest of JSX remains mostly the same — only change: nearby?.ambulances
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Seo
        title="Dashboard | Health Sphere"
        description="View risk trends, recent activity, and take quick actions with AI-powered insights."
        url="https://evolveai-backend.onrender.com/dashboard"
        canonical="https://evolveai-backend.onrender.com/dashboard"
      />
      <Hero
        title="AI Diagnostic & Triage Dashboard"
        subtitle="Track your health, upload reports, and monitor trends with our AI-powered health monitoring system."
        cta={
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => navigate('/daily-checkin')} className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Daily Check-in
            </Button>
            <Button variant="secondary" onClick={() => navigate('/upload-report')} className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Upload Report
            </Button>
            <Button variant="secondary" onClick={locateAmbulance} className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Find Ambulance
            </Button>
          </div>
        }
      />

      {/* Risk Alert */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card className={`transition-all duration-300 transform hover:scale-[1.02] ${
          riskSummary.level === 'High' 
            ? 'bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/30 dark:to-rose-900/10 border-rose-200 dark:border-rose-800/50' 
            : riskSummary.level === 'Mid' 
              ? 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/30 dark:to-amber-900/10 border-amber-200 dark:border-amber-800/50' 
              : 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/30 dark:to-emerald-900/10 border-emerald-200 dark:border-emerald-800/50'
        }`}>
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Health Risk</div>
                <div className={`text-2xl font-bold ${
                  riskSummary.level === 'High' 
                    ? 'text-rose-700 dark:text-rose-300' 
                    : riskSummary.level === 'Mid' 
                      ? 'text-amber-700 dark:text-amber-300' 
                      : 'text-emerald-700 dark:text-emerald-300'
                }`}>
                  {riskSummary.level}
                </div>
              </div>
              <div className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                riskSummary.level === 'High' 
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' 
                  : riskSummary.level === 'Mid' 
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' 
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              }`}>
                Last 30 days
              </div>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              {riskSummary.reason}
            </p>
          </CardContent>
        </Card>
        
        <Card className="lg:col-span-2 transition-all duration-300 transform hover:scale-[1.01]">
          <CardHeader>
            <CardTitle className="flex items-center">
              <svg className="w-5 h-5 mr-2 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Risk Trend (last {riskLabels.length} check-ins)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {riskSeries.length > 0 ? (
              <div className="h-[220px] -mx-2 -mb-2">
                <RiskChart points={riskSeries} labels={riskLabels} yRange={{ min: 0, max: 1 }} title="Rule-based risk" />
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="text-slate-400 dark:text-slate-500 mb-2">
                  <svg className="w-12 h-12 mx-auto opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-slate-500 dark:text-slate-400">No check-ins yet.</p>
                <button 
                  onClick={() => navigate('/daily-checkin')}
                  className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors inline-flex items-center"
                >
                  Record your first check-in
                  <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard 
          label="Check-ins today" 
          value={checkins.filter(c => {
            const today = new Date();
            const checkinDate = new Date(c.date);
            return checkinDate.toDateString() === today.toDateString();
          }).length} 
          hint="Daily check-ins" 
          icon="calendar"
          accent="blue" 
        />
        <StatCard 
          label="Risk level" 
          value={riskSummary.level} 
          hint="Based on recent data" 
          icon="shield"
          accent={riskSummary.level === 'High' ? 'red' : riskSummary.level === 'Mid' ? 'amber' : 'green'} 
        />
        <StatCard 
          label="Total check-ins" 
          value={checkins.length} 
          hint="Last 30 days" 
          icon="chart"
          accent="purple" 
        />
      </div>
      
      {/* About Us section — unchanged */}
      <div className="grid grid-cols-1 gap-6">
        <Card className="relative overflow-hidden border-0 shadow-xl bg-white/80 dark:bg-slate-900/80 ring-1 ring-slate-900/5">
          <CardHeader>
            <CardTitle className="flex items-center text-xl md:text-2xl">
              <svg className="w-6 h-6 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
              </svg>
              About Us
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
              <div className="relative rounded-2xl p-6 md:p-8 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 border border-slate-200/70 dark:border-slate-800/70 shadow-xl">
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200/60 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-900/20 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                  Health Sphere
                </div>
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Your Partner in Proactive Health</h2>
                <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
                  Health Sphere is an AI-powered health monitoring and triage platform that helps you track symptoms,
                  understand risk trends, and take timely action. We’re building a privacy-first, reliable, and
                  clinician-informed experience to support everyday well-being.
                </p>

                <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-medium">
                      <svg className="w-5 h-5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      Daily check-ins
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Monitor well-being and symptoms over time.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-medium">
                      <svg className="w-5 h-5 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 3v18h18" />
                      </svg>
                      AI risk insights
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Clear summaries and trend visualizations.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-medium">
                      <svg className="w-5 h-5 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 8v4l3 3" />
                      </svg>
                      Rapid actions
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Find emergency services when you need them.</p>
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/50 p-4 text-center">
                    <div className="text-2xl font-bold">Privacy-first</div>
                    <div className="text-xs opacity-80 mt-1">Your data, your control</div>
                  </div>
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/50 p-4 text-center">
                    <div className="text-2xl font-bold">AI + Clinicians</div>
                    <div className="text-xs opacity-80 mt-1">Human-centered insights</div>
                  </div>
                  <div className="rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-200/60 dark:border-purple-800/50 p-4 text-center">
                    <div className="text-2xl font-bold">Actionable</div>
                    <div className="text-xs opacity-80 mt-1">Guidance you can use</div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Ambulance section — fixed to use .ambulances */}
      {(nearbyLoading || nearbyError || (nearby && Array.isArray(nearby.ambulances))) && (
        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <svg className="w-5 h-5 mr-2 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Nearby Ambulance Services
              </CardTitle>
            </CardHeader>
            <CardContent>
              {nearbyLoading && (
                <div className="flex items-center justify-center py-8">
                  <Spinner className="w-6 h-6 text-blue-500" />
                  <span className="ml-3 text-slate-600 dark:text-slate-300">Locating nearby services...</span>
                </div>
              )}
              {nearbyError && (
                <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300">
                  <div className="flex">
                    <svg className="w-5 h-5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <h4 className="font-medium">Unable to locate services</h4>
                      <p className="text-sm mt-1">{nearbyError}</p>
                    </div>
                  </div>
                </div>
              )}
              {!nearbyLoading && !nearbyError && (
                <div className="space-y-4">
                  {(nearby?.ambulances || []).slice(0, 3).map((n, i) => (
                    <div key={n.id || i} className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-medium text-slate-900 dark:text-slate-100">{n.name}</h4>
                          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                            {n.distance} m • ETA: {n.eta_minutes} min
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(nearby?.ambulances || []).length === 0 && (
                    <div className="text-center py-6 text-slate-500 dark:text-slate-400">
                      <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p>No ambulance services found nearby.</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}