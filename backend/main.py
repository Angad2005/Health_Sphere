import os
import json
import sqlite3
import uuid
from datetime import datetime
from functools import wraps
from flask import Flask, request, jsonify, session
from flask_cors import CORS
import bcrypt
import re

# Initialize Flask app
app = Flask(__name__)

# --- Security & Session Configuration ---
app.secret_key = os.getenv('SECRET_KEY', 'change-this-in-production-very-secret-key-123!')

# Critical: Configure session cookies for modern browsers
app.config.update(
    SESSION_COOKIE_NAME='health_session',
    SESSION_COOKIE_SAMESITE='Lax',      # Use 'None' if frontend/backend on different domains (requires HTTPS)
    SESSION_COOKIE_SECURE=False,        # Set to True in production with HTTPS
    SESSION_COOKIE_HTTPONLY=True,       # Prevent XSS attacks
    PERMANENT_SESSION_LIFETIME=604800,  # 7 days in seconds
)

# Enable CORS with credentials for session-based auth
# Allow frontend on localhost:5173 (Vite dev server) and localhost:3000
CORS(app, 
     supports_credentials=True,
     origins=['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000'],
     allow_headers=['Content-Type', 'Authorization'],
     methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])

# --- Database Configuration ---
AUTH_DB_PATH = os.getenv('AUTH_DATABASE_PATH', 'data/auth.db')
APP_DB_PATH = os.getenv('APP_DATABASE_PATH', 'data/app.db')

# Ensure data directory exists
os.makedirs(os.path.dirname(AUTH_DB_PATH), exist_ok=True)
os.makedirs(os.path.dirname(APP_DB_PATH), exist_ok=True)

# --- Auth DB ---
def get_auth_db():
    conn = sqlite3.connect(AUTH_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_auth_db():
    with get_auth_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        ''')

# --- App DB (health data) ---
def get_app_db():
    conn = sqlite3.connect(APP_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_app_db():
    with get_app_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS daily_checkins (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                date TEXT NOT NULL,
                answers TEXT NOT NULL,
                notes TEXT,
                topK INTEGER,
                explainMethod TEXT,
                useScipyWinsorize BOOLEAN,
                forceLocal BOOLEAN
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS feedback (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                feedback TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS uploads (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                message_preview TEXT,
                created_at TEXT NOT NULL
            )
        ''')

# Initialize databases
init_auth_db()
init_app_db()

# --- Auth Helpers ---
def hash_password(password: str) -> bytes:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())

def verify_password(password: str, hashed: bytes) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed)

def validate_email(email: str) -> bool:
    return re.match(r"^[^@]+@[^@]+\.[^@]+$", email.strip()) is not None

def require_auth(f):
    """Decorator to protect routes"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return wrapper

# --- Auth Routes ---
@app.route('/api/auth/signup', methods=['POST'])
def signup():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400
        
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    if not validate_email(email):
        return jsonify({"error": "Invalid email format"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    try:
        password_hash = hash_password(password)
        user_id = str(uuid.uuid4())

        with get_auth_db() as conn:
            conn.execute(
                'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
                (user_id, email, password_hash, datetime.utcnow().isoformat())
            )
        return jsonify({"ok": True, "user": {"id": user_id, "email": email}})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Email already registered"}), 409
    except Exception as e:
        app.logger.error(f"Signup error: {str(e)}")
        return jsonify({"error": "Signup failed"}), 500

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400
        
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    with get_auth_db() as conn:
        cur = conn.execute('SELECT id, email, password_hash FROM users WHERE email = ?', (email,))
        user = cur.fetchone()

    if user and verify_password(password, user['password_hash']):
        session.permanent = True  # Use configured lifetime
        session['user_id'] = user['id']
        return jsonify({"ok": True, "user": {"id": user['id'], "email": user['email']}})
    else:
        return jsonify({"error": "Invalid email or password"}), 401

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.pop('user_id', None)
    return jsonify({"ok": True})

@app.route('/api/auth/me')
def me():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
        
    with get_auth_db() as conn:
        cur = conn.execute('SELECT id, email FROM users WHERE id = ?', (user_id,))
        user = cur.fetchone()
        
    if user:
        return jsonify({"user": {"id": user['id'], "email": user['email']}})
    else:
        session.pop('user_id', None)
        return jsonify({"error": "User not found"}), 401

# --- Health & AI Endpoints (Protected) ---
def get_user_id():
    return session.get('user_id')

def format_relative_time(iso_str):
    try:
        # Handle both formats: with and without timezone
        if iso_str.endswith('Z'):
            dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(iso_str)
        diff = datetime.utcnow() - dt
        seconds = diff.total_seconds()
        if seconds < 60:
            return "Just now"
        elif seconds < 3600:
            return f"{int(seconds // 60)} minutes ago"
        elif seconds < 86400:
            return f"{int(seconds // 3600)} hours ago"
        elif seconds < 172800:
            return "Yesterday"
        else:
            return f"{int(seconds // 86400)} days ago"
    except Exception:
        return "Just now"

@app.route('/api/dashboard/recent-activity')
@require_auth
def get_recent_activity():
    user_id = get_user_id()
    activities = []

    with get_app_db() as conn:
        # Check-ins
        cur = conn.execute(
            'SELECT id, date FROM daily_checkins WHERE user_id = ? ORDER BY date DESC LIMIT 3',
            (user_id,)
        )
        for row in cur.fetchall():
            activities.append({
                "id": f"chk-{row['id']}",
                "type": "checkin",
                "title": "Daily check-in completed",
                "timestamp": format_relative_time(row['date'])
            })

        # Uploads
        cur = conn.execute(
            'SELECT id, filename, created_at FROM uploads WHERE user_id = ? ORDER BY created_at DESC LIMIT 3',
            (user_id,)
        )
        for row in cur.fetchall():
            activities.append({
                "id": f"rpt-{row['id']}",
                "type": "report",
                "title": f"Report analyzed: {row['filename']}",
                "timestamp": format_relative_time(row['created_at'])
            })

        # Chat sessions
        cur = conn.execute(
            'SELECT id, created_at FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 3',
            (user_id,)
        )
        for row in cur.fetchall():
            activities.append({
                "id": f"chat-{row['id']}",
                "type": "chat",
                "title": "AI chat session",
                "timestamp": format_relative_time(row['created_at'])
            })

    # Sort by recency (simplified: just take latest 5)
    return jsonify(activities[:5])

@app.route('/api/dashboard/health-insights')
@require_auth
def get_health_insights():
    user_id = get_user_id()
    with get_app_db() as conn:
        cur = conn.execute(
            'SELECT answers FROM daily_checkins WHERE user_id = ? ORDER BY date DESC LIMIT 7',
            (user_id,)
        )
        rows = cur.fetchall()

    if not rows:
        wellness_score = 0
        trend_desc = "No recent check-ins"
        rec_desc = "Complete your first daily check-in to get insights."
        label = "No data"
    else:
        total_score = 0
        count = 0
        for row in rows:
            try:
                answers = json.loads(row['answers'])
                for val in answers.values():
                    if isinstance(val, (int, float)) and 0 <= val <= 5:
                        total_score += val
                        count += 1
            except (json.JSONDecodeError, TypeError):
                continue
                
        avg = total_score / count if count else 3
        wellness_score = min(100, max(0, int((avg / 5) * 100)))
        label = "Good overall health" if wellness_score >= 80 else "Needs attention"

        if wellness_score >= 80:
            trend_desc = "Consistently good wellness trends"
            rec_desc = "Keep up the great habits!"
        elif wellness_score >= 60:
            trend_desc = "Stable with room for improvement"
            rec_desc = "Try adding a short walk daily to boost energy."
        else:
            trend_desc = "Recent dips in wellness indicators"
            rec_desc = "Review your check-in notes and consider adjusting sleep or stress habits."

    return jsonify({
        "wellnessScore": {
            "score": wellness_score,
            "total": 100,
            "label": label
        },
        "trendAnalysis": {
            "label": "Trend Analysis",
            "description": trend_desc
        },
        "recommendation": {
            "label": "Recommendation",
            "description": rec_desc
        }
    })

# --- Protected AI/Health Endpoints ---
@app.route('/api/ai/health')
def ai_health():
    return jsonify({
        "ok": True,
        "python": {"available": True, "version": "3.11.9"}
    })

@app.route('/api/analyze', methods=['POST'])
@require_auth
def analyze():
    return jsonify({
        "risk_score": 0.32,
        "factors": ["Sleep quality", "Pain level"],
        "recommendation": "Consider light exercise and hydration."
    })

@app.route('/api/pdf-extract', methods=['POST'])
@require_auth
def pdf_extract():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400
        
    url = data.get('url', '')
    use_ocr = data.get('useOcr', False)
    lang = data.get('lang', 'en')
    return jsonify({
        "text": f"Mock PDF content from {url}. OCR={'enabled' if use_ocr else 'disabled'}, lang={lang}.",
        "pages": 3
    })

@app.route('/functions/processReport', methods=['POST'])
@require_auth
def process_report():
    user_id = get_user_id()
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    upload_id = str(uuid.uuid4())
    with get_app_db() as conn:
        conn.execute(
            'INSERT INTO uploads (id, user_id, filename, created_at) VALUES (?, ?, ?, ?)',
            (upload_id, user_id, file.filename, datetime.utcnow().isoformat())
        )
    return jsonify({
        "ok": True,
        "reportId": upload_id,
        "summary": "Mock medical report processed successfully.",
        "findings": ["Mild inflammation", "Normal vitals"]
    })

@app.route('/functions/analyzeCheckin', methods=['POST'])
@require_auth
def analyze_checkin():
    user_id = get_user_id()
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "Invalid JSON"}), 400
        
    payload = payload.get('payload', {})
    checkin_id = str(uuid.uuid4())
    with get_app_db() as conn:
        conn.execute(
            '''INSERT INTO daily_checkins 
               (id, user_id, date, answers, notes, topK, explainMethod, useScipyWinsorize, forceLocal)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                checkin_id,
                user_id,
                datetime.utcnow().isoformat(),
                json.dumps(payload.get('answers', {})),
                payload.get('notes'),
                payload.get('topK', 3),
                payload.get('explainMethod', 'auto'),
                payload.get('useScipyWinsorize', True),
                payload.get('forceLocal', False)
            )
        )
    return jsonify({
        "ok": True,
        "risk_score": 0.28,
        "status": "analyzed"
    })

@app.route('/functions/chat', methods=['POST'])
@require_auth
def chat_with_gemini():
    user_id = get_user_id()
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400
        
    message = data.get('message', '')[:50]
    chat_id = str(uuid.uuid4())
    with get_app_db() as conn:
        conn.execute(
            'INSERT INTO chat_sessions (id, user_id, message_preview, created_at) VALUES (?, ?, ?, ?)',
            (chat_id, user_id, message, datetime.utcnow().isoformat())
        )
    return jsonify({
        "response": "Based on your symptoms, I recommend rest and monitoring. If pain worsens, seek care.",
        "sources": ["CDC Guidelines", "Mayo Clinic"]
    })

@app.route('/api/checkins')
@require_auth
def get_checkins():
    user_id = get_user_id()
    limit = request.args.get('limit', 30, type=int)
    with get_app_db() as conn:
        cur = conn.execute(
            'SELECT * FROM daily_checkins WHERE user_id = ? ORDER BY date DESC LIMIT ?',
            (user_id, limit)
        )
        rows = cur.fetchall()
    checkins = []
    for row in rows:
        try:
            checkins.append({
                "id": row["id"],
                "user_id": row["user_id"],
                "date": row["date"],
                "answers": json.loads(row["answers"]),
                "notes": row["notes"],
                "topK": row["topK"],
                "explainMethod": row["explainMethod"],
                "useScipyWinsorize": bool(row["useScipyWinsorize"]),
                "forceLocal": bool(row["forceLocal"])
            })
        except (json.JSONDecodeError, TypeError):
            continue
            
    return jsonify(checkins)

# --- Missing API Endpoints ---
@app.route('/functions/riskSeries')
@require_auth
def get_risk_series():
    user_id = get_user_id()
    with get_app_db() as conn:
        cur = conn.execute(
            'SELECT date, answers FROM daily_checkins WHERE user_id = ? ORDER BY date DESC LIMIT 30',
            (user_id,)
        )
        rows = cur.fetchall()
    
    risk_data = []
    for row in rows:
        try:
            answers = json.loads(row['answers'])
            # Calculate a simple risk score from answers
            score = 0
            count = 0
            for val in answers.values():
                if isinstance(val, (int, float)) and 0 <= val <= 5:
                    score += val
                    count += 1
            if count > 0:
                risk_data.append({
                    "date": row['date'],
                    "risk_score": min(100, max(0, int((score / count / 5) * 100)))
                })
        except (json.JSONDecodeError, TypeError):
            continue
    
    return jsonify(risk_data)

@app.route('/functions/submitFeedback', methods=['POST'])
@require_auth
def submit_feedback():
    user_id = get_user_id()
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400
        
    feedback = data.get('feedback', '')
    if not feedback.strip():
        return jsonify({"error": "Feedback is required"}), 400
    
    feedback_id = str(uuid.uuid4())
    with get_app_db() as conn:
        conn.execute(
            'INSERT INTO feedback (id, user_id, feedback, created_at) VALUES (?, ?, ?, ?)',
            (feedback_id, user_id, feedback, datetime.utcnow().isoformat())
        )
    
    return jsonify({"ok": True, "feedbackId": feedback_id})

@app.route('/functions/findNearbyAmbulance')
@require_auth
def find_nearby_ambulance():
    lat = request.args.get('lat', type=float)
    lng = request.args.get('lng', type=float)
    radius = request.args.get('radiusMeters', 5000, type=int)
    
    if not lat or not lng:
        return jsonify({"error": "Latitude and longitude are required"}), 400
    
    # Mock ambulance data - in real app, integrate with Google Maps API
    mock_ambulances = [
        {
            "id": "amb-1",
            "name": "City Emergency Services",
            "distance": "0.8 km",
            "phone": "+1-555-0123",
            "eta": "5-8 minutes"
        },
        {
            "id": "amb-2", 
            "name": "Metro Ambulance",
            "distance": "1.2 km",
            "phone": "+1-555-0456",
            "eta": "8-12 minutes"
        }
    ]
    
    return jsonify({
        "ambulances": mock_ambulances,
        "count": len(mock_ambulances)
    })

@app.route('/functions/generateReportSummary', methods=['POST'])
@require_auth
def generate_report_summary():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400
        
    extracted_data = data.get('extractedData', {})
    ocr_text = data.get('ocrText', '')
    
    # Mock AI analysis - in real app, integrate with AI service
    summary = {
        "summary": "Medical report analysis completed. Key findings include normal vital signs and minor inflammation markers.",
        "keyFindings": [
            "Blood pressure: 120/80 mmHg (normal)",
            "Heart rate: 72 bpm (normal)", 
            "Temperature: 98.6°F (normal)",
            "Mild inflammation detected in blood work"
        ],
        "recommendations": [
            "Continue current medication regimen",
            "Schedule follow-up in 3 months",
            "Monitor blood pressure weekly"
        ],
        "riskLevel": "Low",
        "confidence": 0.85
    }
    
    return jsonify(summary)

@app.route('/')
def hello():
    return jsonify({"message": "Flask backend ready with SQLite auth!"})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8080)