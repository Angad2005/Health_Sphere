import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Seo from '../components/Seo';
import { processReportWithProgress, pdfExtract } from '../services/api'; // ✅ REMOVED generateReportSummary
import Button from '../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/ToastProvider';
import StatCard from '../components/StatCard';
import RiskChart from '../components/RiskChart';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

export default function UploadReport() {
  const { notify } = useToast();
  const { user } = useAuth();
  const [file, setFile] = useState(null);
  const [ocr, setOcr] = useState(null);
  const [extracted, setExtracted] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [statusText, setStatusText] = useState('Idle');
  const abortRef = useRef(null);
  const [lastError, setLastError] = useState('');
  const [lastErrorDetail, setLastErrorDetail] = useState(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [forceOcr, setForceOcr] = useState(false);
  const [ocrLang, setOcrLang] = useState('eng');
  const [llmAnalysis, setLlmAnalysis] = useState(null);
  const [extractionQuality, setExtractionQuality] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [maxRetries] = useState(3);

  const calculateExtractionQuality = useCallback((extractedData) => {
    if (!extractedData) return { score: 0, issues: ['No data extracted'] };
    
    const labs = Array.isArray(extractedData?.labs) ? extractedData.labs : [];
    const meta = extractedData?.meta || {};
    const issues = [];
    let score = 1.0;
    
    if (labs.length === 0) {
      issues.push('No lab values extracted');
      score -= 0.4;
    } else {
      const highConfidenceLabs = labs.filter(lab => lab.confidence >= 0.7);
      const confidenceRatio = highConfidenceLabs.length / labs.length;
      
      if (confidenceRatio < 0.5) {
        issues.push('Low confidence in extracted lab values');
        score -= 0.2;
      }
      
      const validValues = labs.filter(lab => lab.value !== null && lab.value !== undefined);
      if (validValues.length < labs.length * 0.7) {
        issues.push('Many lab values missing or invalid');
        score -= 0.2;
      }
    }
    
    if (!meta.patientName && !meta.patientId) {
      issues.push('No patient identification found');
      score -= 0.1;
    }
    
    if (!meta.date) {
      issues.push('No report date found');
      score -= 0.1;
    }
    
    return {
      score: Math.max(0, Math.min(1, score)),
      issues: issues.length > 0 ? issues : ['Good extraction quality'],
      labCount: labs.length,
      highConfidenceCount: labs.filter(lab => lab.confidence >= 0.7).length
    };
  }, []);

  // ✅ FIXED: REMOVED generateLlmAnalysis - Now ONE CALL does EVERYTHING!

  // ✅ NEW: Urgency Badge Component
  const UrgencyBadge = ({ level }) => {
    const getUrgencyConfig = (level) => {
      switch (level) {
        case 1: return { color: 'emerald', text: 'Low', bg: 'bg-emerald-100', border: 'border-emerald-200', textColor: 'text-emerald-800' };
        case 2: return { color: 'blue', text: 'Normal', bg: 'bg-blue-100', border: 'border-blue-200', textColor: 'text-blue-800' };
        case 3: return { color: 'amber', text: 'Moderate', bg: 'bg-amber-100', border: 'border-amber-200', textColor: 'text-amber-800' };
        case 4: return { color: 'orange', text: 'High', bg: 'bg-orange-100', border: 'border-orange-200', textColor: 'text-orange-800' };
        case 5: return { color: 'red', text: 'Critical', bg: 'bg-red-100', border: 'border-red-200', textColor: 'text-red-800' };
        default: return { color: 'slate', text: 'Unknown', bg: 'bg-slate-100', border: 'border-slate-200', textColor: 'text-slate-800' };
      }
    };

    const config = getUrgencyConfig(level);
    return (
      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.border} ${config.textColor}`}>
        <div className={`h-2 w-2 rounded-full bg-${config.color}-600`} />
        {config.text}
      </span>
    );
  };

  // ✅ NEW: Findings List Component
  const FindingsList = ({ findings }) => (
    <div className="space-y-3">
      {findings.map((finding, index) => (
        <div key={index} className="flex items-start gap-3 p-4 rounded-lg bg-gradient-to-r from-blue-50/60 to-indigo-50/60 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200/60 dark:border-blue-800/60">
          <div className="flex-shrink-0 mt-0.5">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 text-sm font-medium">
              {index + 1}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-5">{finding}</p>
          </div>
        </div>
      ))}
    </div>
  );

  // ✅ NEW: Recommendations List Component
  const RecommendationsList = ({ recommendations }) => (
    <div className="grid gap-3">
      {recommendations.map((rec, index) => (
        <div key={index} className="group flex items-start gap-3 p-4 rounded-lg bg-gradient-to-r from-emerald-50/80 to-green-50/80 dark:from-emerald-900/20 dark:to-green-900/20 border border-emerald-200/60 dark:border-emerald-800/60 hover:shadow-sm hover:shadow-emerald-500/10 transition-all duration-200">
          <div className="flex-shrink-0 mt-1.5">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 text-sm font-semibold group-hover:scale-110 transition-transform duration-200">
              ✓
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-5">{rec}</p>
          </div>
        </div>
      ))}
    </div>
  );

  const acceptedTypes = useMemo(() => ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'], []);
  const maxSizeBytes = 10 * 1024 * 1024;

  const validateFile = useCallback((f) => {
    if (!f) return 'No file selected';
    if (!acceptedTypes.includes(f.type)) return 'Unsupported file type. Use PDF, JPG, or PNG.';
    if (f.size > maxSizeBytes) return 'File is too large. Max 10MB.';
    return null;
  }, [acceptedTypes]);

  const validateMultipleFiles = useCallback((files) => {
    if (!files || files.length === 0) return null;
    if (files.length > 1) {
      const pdfCount = Array.from(files).filter(f => f.type === 'application/pdf').length;
      if (pdfCount > 1) {
        return 'Multiple PDF files detected. Please upload only one PDF at a time.';
      }
      return 'Multiple files detected. Please upload only one file at a time.';
    }
    return null;
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (file) {
      notify('A file is already uploaded. Please remove it first before uploading a new one.', 'error');
      return;
    }
    
    const files = e.dataTransfer.files;
    const multipleFilesError = validateMultipleFiles(files);
    if (multipleFilesError) {
      notify(multipleFilesError, 'error');
      return;
    }
    
    const f = files?.[0];
    const err = validateFile(f);
    if (err) {
      notify(err, 'error');
      return;
    }
    setFile(f || null);
  }, [notify, validateFile, validateMultipleFiles, file]);

  const onBrowse = useCallback((e) => {
    const files = e.target.files;
    
    if (file) {
      notify('A file is already uploaded. Please remove it first before uploading a new one.', 'error');
      e.target.value = '';
      return;
    }
    
    const multipleFilesError = validateMultipleFiles(files);
    if (multipleFilesError) {
      notify(multipleFilesError, 'error');
      e.target.value = '';
      return;
    }
    
    const f = files?.[0];
    const err = validateFile(f);
    if (err) {
      notify(err, 'error');
      e.target.value = '';
      return;
    }
    setFile(f || null);
  }, [notify, validateFile, validateMultipleFiles, file]);

  useEffect(() => {
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl('');
  }, [file]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.multiple = false;
    }
  }, []);

  useEffect(() => {
    const onPaste = async (e) => {
      try {
        if (file) {
          notify('A file is already uploaded. Please remove it first before uploading a new one.', 'error');
          return;
        }
        
        const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
        if (!item) return;
        const blob = item.getAsFile();
        if (!blob) return;
        const err = validateFile(blob);
        if (err) {
          notify(err, 'error');
          return;
        }
        setFile(new File([blob], blob.name || 'pasted-image.png', { type: blob.type }));
        notify('Image pasted from clipboard', 'success');
      } catch (_) {}
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [notify, validateFile, file]);

  // ✅ FIXED: ONE CALL → FULL LLM ANALYSIS!
  async function submit(e) {
    e.preventDefault();
    if (!file) {
      notify('Please select a file to process.', 'error');
      return;
    }
    setIsLoading(true);
    setProgress(0);
    setLastError('');
    setStatusText('🔄 Uploading...');
    setRetryCount(0);
    setExtractionQuality(null);
    setLlmAnalysis(null);
    
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      
      // 🚀 ONE CALL GETS: ocr + extracted + llm_analysis!
      const res = await processReportWithProgress(file, {
        onProgress: (p) => {
          setProgress(p);
          if (p > 50) setStatusText('🤖 Generating LLM Analysis...');
        },
        signal: controller.signal
      });
      
      setProgress(100);
      setOcr(res?.ocr);
      setExtracted(res?.extracted);
      setLlmAnalysis(res?.llm_analysis); // ✅ DIRECT FROM BACKEND!
      
      const quality = calculateExtractionQuality(res?.extracted);
      setExtractionQuality(quality);
      setStatusText('✅ COMPLETE: LLM Analysis Ready!');
      
      // 🎉 Auto-save to Firestore
      if (user?.uid && res?.llm_analysis) {
        try {
          const col = collection(db, 'users', user.uid, 'reportAnalyses');
          await addDoc(col, {
            createdAt: serverTimestamp(),
            analysis: res.llm_analysis,
            extracted: res.extracted,
            meta: res.extracted?.meta || {},
            stats: {
              labCount: Array.isArray(res.extracted?.labs) ? res.extracted.labs.length : 0,
              urgency: res.llm_analysis?.urgency || 3,
            },
          });
          notify('🎉 Analysis saved to your health records!', 'success');
        } catch (saveErr) {
          console.error('Save failed:', saveErr);
        }
      }
      
      notify('🚀 LLM Analysis Complete!', 'success');
      
    } catch (err) {
      const message = err?.message || 'Failed to process the report.';
      setLastError(message);
      setLastErrorDetail(err && err.body ? err.body : null);
      setStatusText(message.toLowerCase().includes('canceled') ? '❌ Canceled' : '❌ Failed');
      
      if (retryCount < maxRetries && !message.toLowerCase().includes('canceled')) {
        notify(`${message} Retrying... (${retryCount + 1}/${maxRetries})`, 'warning');
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
          submit(e);
        }, 2000);
      } else {
        notify(message, 'error');
      }
    } finally {
      abortRef.current = null;
      setTimeout(() => setIsLoading(false), 200);
    }
  }

  async function submitUrl(e) {
    e.preventDefault();
    const url = (pdfUrl || '').trim();
    if (!url) {
      notify('Enter a PDF URL to process.', 'error');
      return;
    }
    setIsLoading(true);
    setProgress(0);
    setLastError('');
    setLastErrorDetail(null);
    setStatusText('Processing URL…');
    try {
      const res = await pdfExtract(url, { useOcr: forceOcr ? true : null, lang: ocrLang });
      setOcr(res?.ocr || res);
      setExtracted(res?.extracted || null);
      setLlmAnalysis(null); // URL doesn't get LLM analysis yet
      setStatusText('Completed');
      notify('PDF URL processed successfully.', 'success');
    } catch (err) {
      const message = err?.message || 'Failed to process the PDF URL.';
      setLastError(message);
      setLastErrorDetail(err && err.body ? err.body : null);
      setStatusText('Failed');
      notify(message, 'error');
    } finally {
      setTimeout(() => setIsLoading(false), 200);
    }
  }

  const cancelUpload = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  const retry = useCallback(() => {
    if (!file) return;
    setOcr(null);
    setProgress(0);
    setStatusText('Retrying…');
    const fakeEvent = { preventDefault: () => {} };
    submit(fakeEvent);
  }, [file]);

  // ✅ SIMPLIFIED: Show LLM analysis IMMEDIATELY after upload!
  const showLlmAnalysis = !!llmAnalysis;

  return (
    <div>
      <Seo
        title="Upload Report | Health Sphere"
        description="Upload medical reports for instant AI-powered LLM analysis with structured findings, urgency assessment, and personalized recommendations."
        url="/upload-report"
        canonical="/upload-report"
      />
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1 text-transparent bg-clip-text bg-gradient-to-r from-brand-600 via-blue-600 to-indigo-600">
          Upload & Analyze Report
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          <span className="font-mono bg-blue-100/60 dark:bg-blue-900/30 px-2 py-1 rounded text-blue-800 dark:text-blue-200">1-Click LLM Analysis</span> → OCR + Extraction + Structured Findings
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Upload Card */}
        <Card>
          <CardHeader className="bg-gradient-to-r from-blue-50/80 to-indigo-50/80 dark:from-slate-800/50 dark:to-slate-900/50 border-blue-100/50 dark:border-slate-700">
            <CardTitle className="text-blue-900 dark:text-slate-100">📁 Upload Report</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div
                className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-all duration-200 bg-gradient-to-br ${
                  file
                    ? 'from-emerald-50/80 via-emerald-50/80 to-emerald-50/80 dark:from-emerald-900/20 dark:via-emerald-900/20 dark:to-emerald-900/20 border-emerald-200/60 dark:border-emerald-700/60'
                    : isDragging
                    ? 'from-blue-50/90 via-indigo-50/90 to-purple-50/90 dark:from-blue-900/30 dark:via-indigo-900/30 dark:to-purple-900/30 border-blue-500/60 dark:border-blue-400/60 shadow-lg shadow-blue-500/10'
                    : 'from-slate-50/80 via-blue-50/80 to-indigo-50/80 dark:from-slate-800/50 dark:via-slate-800/50 dark:to-slate-800/50 border-slate-200/60 dark:border-slate-700/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 hover:shadow-md hover:shadow-blue-500/5'
                }`}
                onDragOver={(e) => { 
                  if (!file) {
                    e.preventDefault(); 
                    setIsDragging(true); 
                  }
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
              >
                {isDragging && (
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-indigo-500/20 rounded-lg backdrop-blur-sm animate-pulse" />
                )}
                <div className="flex flex-col items-center gap-3 z-10">
                  <div className="p-3 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-full">
                    <svg className="h-6 w-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 12l-4-4m4 4l4-4M7 20h10a2 2 0 002-2V6a2 2 0 00-2-2H7a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">
                      {file ? '✅ File Ready' : 'Drag & drop your report'}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      {file 
                        ? 'Click "Process Report" to analyze' 
                        : 'PDF, JPG, PNG (max 10MB) or paste with Cmd+V'
                      }
                    </div>
                  </div>
                </div>
                
                <div className="text-xs text-slate-500 dark:text-slate-400 my-3">or</div>
                
                <input
                  ref={inputRef}
                  type="file"
                  accept={acceptedTypes.join(',')}
                  onChange={onBrowse}
                  multiple={false}
                  className="hidden"
                />
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => inputRef.current?.click()} 
                  disabled={isLoading || !!file}
                  className="px-6"
                >
                  {file ? '✅ File Selected' : 'Browse Files'}
                </Button>

                {file && (
                  <div className="mt-4 w-full max-w-sm p-4 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-lg border border-emerald-200/60 dark:border-emerald-700/60 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {previewUrl ? (
                          <img src={previewUrl} alt="preview" className="h-12 w-12 object-cover rounded-lg border-2 border-emerald-200/60 dark:border-emerald-700/60" />
                        ) : (
                          <div className="h-12 w-12 bg-gradient-to-br from-rose-100 to-pink-100 dark:from-rose-900/30 dark:to-pink-900/30 rounded-lg flex items-center justify-center border-2 border-rose-200/60 dark:border-rose-700/60">
                            <span className="text-sm font-semibold text-rose-600 dark:text-rose-400">PDF</span>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate max-w-[140px]">{file.name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{(file.size / 1024).toFixed(1)} KB</div>
                        </div>
                      </div>
                      <UrgencyBadge level={3} />
                    </div>
                  </div>
                )}

                {isLoading && (
                  <div className="absolute inset-x-0 -bottom-6">
                    <div className="h-2 bg-gradient-to-r from-blue-100 to-indigo-100 dark:from-slate-700 dark:to-slate-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full shadow-lg" 
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-200/60 dark:border-slate-700/60">
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => { 
                    setFile(null); 
                    setOcr(null); 
                    setExtracted(null); 
                    setLlmAnalysis(null); 
                    setStatusText('Idle'); 
                    if (inputRef.current) inputRef.current.value = ''; 
                  }} 
                  disabled={isLoading}
                >
                  🗑️ Clear
                </Button>
                <Button 
                  type="button" 
                  variant="ghost" 
                  onClick={() => inputRef.current?.click()} 
                  disabled={isLoading || !file}
                >
                  🔄 Replace
                </Button>
                <div className="ml-auto flex items-center gap-3">
                  {isLoading ? (
                    <>
                      <Button type="button" variant="danger" onClick={cancelUpload}>
                        ⏹️ Cancel
                      </Button>
                      <Button type="button" variant="primary" disabled className="bg-gradient-to-r from-blue-600 to-indigo-600">
                        <span className="inline-flex items-center gap-2">
                          <Spinner size={16} />
                          <span>{statusText}</span>
                        </span>
                      </Button>
                    </>
                  ) : (
                    <Button type="submit" disabled={!file} className="bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-700 hover:to-blue-700 shadow-lg hover:shadow-xl px-8 py-3 text-lg font-semibold">
                      🚀 <span className="hidden sm:inline">Process with</span> LLM
                    </Button>
                  )}
                </div>
              </div>
            </form>

            {/* URL Processing */}
            <div className="mt-6 p-4 bg-gradient-to-r from-slate-50/50 to-slate-100/50 dark:from-slate-800/30 dark:to-slate-900/30 rounded-lg border border-slate-200/50 dark:border-slate-700/50">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-3 uppercase tracking-wider">🔗 Or Process PDF URL</div>
              <form onSubmit={submitUrl} className="flex items-stretch gap-3">
                <input
                  type="url"
                  placeholder="https://example.com/report.pdf"
                  className="flex-1 rounded-lg border px-4 py-3 text-sm border-slate-300/50 dark:border-slate-700/50 bg-white/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 placeholder-slate-400/70 dark:placeholder-slate-500/70 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-indigo-500/30 focus:border-blue-500/60 dark:focus:border-indigo-500/60"
                  value={pdfUrl}
                  onChange={(e) => setPdfUrl(e.target.value)}
                  disabled={isLoading}
                />
                <Button type="submit" variant="secondary" disabled={isLoading || !pdfUrl.trim()} className="px-6">
                  🚀 Analyze URL
                </Button>
              </form>
            </div>

            {/* Status */}
            <div className="mt-6 p-3 bg-gradient-to-r from-emerald-50/80 to-blue-50/80 dark:from-emerald-900/20 dark:to-blue-900/20 rounded-lg border border-emerald-200/60 dark:border-emerald-700/60">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  <span className={`inline-block w-2 h-2 mr-2 rounded-full ${
                    statusText.includes('COMPLETE') ? 'bg-emerald-500' : 
                    statusText.includes('Failed') || statusText.includes('Canceled') ? 'bg-red-500' : 
                    'bg-blue-500 animate-pulse'
                  }`} />
                  {statusText}
                </span>
                {lastError && !isLoading && (
                  <Button variant="ghost" size="sm" onClick={retry} className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 h-8 px-3">
                    🔄 Retry
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ✅ LLM ANALYSIS - SHOWS IMMEDIATELY! */}
        <Card className="md:col-span-2">
          <CardHeader className="bg-gradient-to-r from-indigo-50/80 to-purple-50/80 dark:from-indigo-900/20 dark:to-purple-900/20 border-indigo-200/60 dark:border-indigo-800/60">
            <CardTitle className="text-indigo-900 dark:text-slate-100 flex items-center gap-3">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-700/60">
                🤖 LM Studio LLM
              </span>
              Health Analysis
            </CardTitle>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Structured findings • Urgency assessment • Actionable recommendations
            </p>
          </CardHeader>
          
          <CardContent className="space-y-6">
            {!extracted ? (
              <div className="text-center py-12 bg-gradient-to-br from-slate-50/50 to-slate-100/50 dark:from-slate-800/30 dark:to-slate-900/30 rounded-xl border-2 border-dashed border-slate-200/60 dark:border-slate-700/60">
                <div className="mx-auto h-16 w-16 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-full flex items-center justify-center mb-6">
                  <svg className="h-8 w-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">Ready to Analyze</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
                  Upload your medical report for <strong>instant</strong> LLM-powered analysis
                </p>
              </div>
            ) : showLlmAnalysis ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Urgency & Key Stats */}
                <div className="space-y-6">
                  <div className="p-6 bg-gradient-to-br from-yellow-50/80 to-orange-50/80 dark:from-yellow-900/20 dark:to-orange-900/20 rounded-xl border border-yellow-200/60 dark:border-yellow-800/60">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 uppercase tracking-wider">Urgency Level</h3>
                      <UrgencyBadge level={llmAnalysis.urgency} />
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <StatCard 
                        label="Key Findings" 
                        value={llmAnalysis.findings?.length || 0} 
                        hint="Abnormal results" 
                        accent="yellow"
                      />
                      <StatCard 
                        label="Recommendations" 
                        value={llmAnalysis.recommendations?.length || 0} 
                        hint="Action items" 
                        accent="emerald"
                      />
                    </div>
                  </div>

                  {/* Findings */}
                  {llmAnalysis.findings?.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2 uppercase tracking-wider">
                        <span className="inline-flex items-center justify-center w-5 h-5 bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-full text-xs font-bold">!</span>
                        Key Findings
                      </h3>
                      <FindingsList findings={llmAnalysis.findings} />
                    </div>
                  )}
                </div>

                {/* Recommendations & Summary */}
                <div className="space-y-6">
                  {/* Recommendations */}
                  {llmAnalysis.recommendations?.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2 uppercase tracking-wider">
                        <span className="inline-flex items-center justify-center w-5 h-5 bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 rounded-full text-xs font-bold">✓</span>
                        Recommendations
                      </h3>
                      <RecommendationsList recommendations={llmAnalysis.recommendations} />
                    </div>
                  )}

                  {/* Executive Summary */}
                  <div className="p-6 bg-gradient-to-br from-indigo-50/80 to-purple-50/80 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl border border-indigo-200/60 dark:border-indigo-800/60">
                    <h3 className="text-sm font-semibold text-indigo-800 dark:text-indigo-200 mb-4 uppercase tracking-wider">Executive Summary</h3>
                    <div className="prose prose-sm max-w-none text-slate-700 dark:text-slate-300 leading-relaxed">
                      <p className="whitespace-pre-wrap">{llmAnalysis.summary}</p>
                    </div>
                    <div className="mt-6 p-4 bg-gradient-to-r from-amber-50/80 to-rose-50/80 dark:from-amber-900/20 dark:to-rose-900/20 rounded-lg border border-amber-200/60 dark:border-amber-800/60">
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          <span className="inline-flex items-center justify-center w-6 h-6 bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 rounded-full text-sm font-bold">⚠️</span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Medical Disclaimer</p>
                          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">
                            This AI analysis is for informational purposes only. Always consult your healthcare provider.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="mx-auto h-20 w-20 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800/60 dark:to-slate-700/60 rounded-full flex items-center justify-center mb-6">
                  <svg className="h-12 w-12 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.813 15.904L9 18.669c-.363 1.171-2.06 1.17-2.422 0l-.863-2.765c-.163-.523-.163-1.1 0-1.623l.863-2.765c-.362-1.17 2.059-1.17 2.422 0l.863 2.765c.163.523.163 1.1 0 1.623zM18.813 15.904L18 18.669c-.363 1.171-2.06 1.17-2.422 0l-.863-2.765c-.163-.523-.163-1.1 0-1.623l.863-2.765c.362-1.17 2.059-1.17 2.422 0l.863 2.765c.163.523.163 1.1 0 1.623zM10 14a2 2 0 100-4 2 2 0 000 4zM16 14a2 2 0 100-4 2 2 0 000 4zM7 13a1 1 0 100-2 1 1 0 000 2zM17 13a1 1 0 100-2 1 1 0 000 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">Upload to Begin</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
                  Click "Process with LLM" to get instant structured analysis
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Extracted Fields (collapsed) */}
        {extracted && (
          <Card>
            <CardHeader className="bg-gradient-to-r from-slate-50/80 to-slate-100/80 dark:from-slate-800/50 dark:to-slate-900/50 border-slate-200/60 dark:border-slate-700/60">
              <CardTitle className="text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-400 rounded-full text-xs font-mono">RAW</span>
                Extracted Fields
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-4">
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Meta</div>
                  <div className="space-y-3 text-sm">
                    <div><span className="text-slate-600 dark:text-slate-400">Patient:</span> <span className="font-mono bg-slate-100/50 dark:bg-slate-800/50 px-2 py-1 rounded text-slate-900 dark:text-slate-100">{extracted?.meta?.patientName || '—'}</span></div>
                    <div><span className="text-slate-600 dark:text-slate-400">ID:</span> <span className="font-mono bg-slate-100/50 dark:bg-slate-800/50 px-2 py-1 rounded text-slate-900 dark:text-slate-100">{extracted?.meta?.patientId || '—'}</span></div>
                    <div><span className="text-slate-600 dark:text-slate-400">Date:</span> <span className="font-mono bg-slate-100/50 dark:bg-slate-800/50 px-2 py-1 rounded text-slate-900 dark:text-slate-100">{extracted?.meta?.date || '—'}</span></div>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Labs Detected</div>
                  <div className="grid gap-3 max-h-60 overflow-y-auto pr-2">
                    {Array.isArray(extracted?.labs) && extracted.labs.slice(0, 8).map((lab, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-white/50 dark:bg-slate-800/50 rounded-lg border border-slate-200/50 dark:border-slate-700/50">
                        <span className="text-sm font-mono text-slate-900 dark:text-slate-100 capitalize">{lab.name}</span>
                        <span className="text-sm font-mono text-slate-900 dark:text-slate-100">
                          {lab.value ?? '—'} {lab.unit || ''}
                        </span>
                      </div>
                    ))}
                    {extracted.labs.length > 8 && (
                      <div className="text-center py-3 text-sm text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-800/50 rounded-lg">
                        +{extracted.labs.length - 8} more labs
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}