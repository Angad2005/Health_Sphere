// src/pages/SignupPage.jsx
import React, { useEffect, useState } from 'react';
import Seo from '../components/Seo';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/ToastProvider';

export default function SignupPage() {
  const { user, signup } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { notify } = useToast();

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  async function handleEmailSignup(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      // Demo: require non-empty fields
      if (!name.trim() || !email.trim() || !password.trim()) {
        throw new Error('Please fill in all fields.');
      }
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters.');
      }

      await signup({ email, password, name });
      notify('Account created successfully!', 'success');
      navigate('/');
    } catch (err) {
      const message = err.message || 'Failed to create account. Please try again.';
      setError(message);
      notify(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (user) return null;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-brand-50 to-white dark:from-slate-900 dark:to-slate-950 grid place-items-center px-4">
      <Seo
        title="Create account | Health Sphere"
        description="Join Health Sphere to track wellness and get AI-powered report insights."
        url="https://evolveai-backend.onrender.com/signup"
        canonical="https://evolveai-backend.onrender.com/signup"
        noIndex={true}
      />
      <div className="w-full max-w-5xl">
        <div className="grid md:grid-cols-2 gap-6 items-stretch">
          <div className="hidden md:flex relative overflow-hidden rounded-xl border border-brand-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
            <div className="relative z-10 my-auto">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-200/70 dark:border-slate-700 px-3 py-1 text-xs text-brand-700 dark:text-blue-200 bg-brand-50/60 dark:bg-slate-800 mb-4">
                Create account in minutes
              </div>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Join Health Sphere</h2>
              <p className="mt-2 text-slate-600 dark:text-slate-400">Track reports, check-ins, and more with a modern, secure app.</p>
              <ul className="mt-6 space-y-3 text-slate-700 dark:text-slate-300">
                <li className="flex items-start gap-3">
                  <span className="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">✓</span>
                  Email-based sign up
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">✓</span>
                  Privacy-friendly by design
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">✓</span>
                  Clean, accessible UI
                </li>
              </ul>
            </div>
            <div className="pointer-events-none absolute -right-10 -bottom-10 h-64 w-64 rounded-full bg-gradient-to-tr from-brand-300/40 to-blue-300/40 blur-3xl" />
          </div>
          <div>
            <div className="mb-4">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Create your account</h1>
              <p className="mt-1 text-slate-600 dark:text-slate-400">Join us to track your health journey.</p>
            </div>
            <Card>
              <CardContent>
                {error && (
                  <div role="alert" className="mb-3 text-sm rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                    {error}
                  </div>
                )}
                <form className="space-y-4" onSubmit={handleEmailSignup}>
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="name">Full name</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-3-3.87"/><path d="M4 21v-2a4 4 0 0 1 3-3.87"/><circle cx="12" cy="7" r="4"/></svg>
                      </span>
                      <Input
                        id="name"
                        type="text"
                        placeholder="Jane Doe"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        autoComplete="name"
                        disabled={submitting}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="email">Email</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z" fill="none"></path><path d="M22 6l-10 7L2 6" /></svg>
                      </span>
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        autoComplete="email"
                        disabled={submitting}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="password">Password</label>
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                        disabled={submitting}
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M19 11V7a7 7 0 0 0-14 0v4"/><rect x="5" y="11" width="14" height="10" rx="2"/></svg>
                      </span>
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        autoComplete="new-password"
                        disabled={submitting}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-full inline-flex items-center justify-center gap-2" disabled={submitting}>
                    {submitting && (
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth="4"></circle>
                        <path className="opacity-75" d="M4 12a8 8 0 018-8" strokeWidth="4"></path>
                      </svg>
                    )}
                    {submitting ? 'Creating…' : 'Create account'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}