import os
import json
import sqlite3
import uuid
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Database setup
DB_PATH = os.getenv('DATABASE_PATH', 'data/app.db')
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # Enable dict-like access
    return conn

def init_db():
    with get_db() as conn:
        # Create tables if they don't exist
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

# Initialize DB on startup
init_db()

# Helper: get user_id from header (dev mode)
def get_user_id():
    return request.headers.get('x-user-id', 'demo')

# --- Health & AI Endpoints ---
@app.route('/api/ai/health')
def ai_health():
    return jsonify({
        "ok": True,
        "python": {"available": True, "version": "3.11.9"}
    })

@app.route('/api/analyze', methods=['POST'])
def analyze():
    # Mock analysis result
    return jsonify({
        "risk_score": 0.32,
        "factors": ["Sleep quality", "Pain level"],
        "recommendation": "Consider light exercise and hydration."
    })

# --- PDF Extraction ---
@app.route('/api/pdf-extract', methods=['POST'])
def pdf_extract():
    data = request.get_json()
    url = data.get('url', '')
    use_ocr = data.get('useOcr', False)
    lang = data.get('lang', 'en')
    
    # Mock extracted text
    return jsonify({
        "text": f"Mock PDF content from {url}. OCR={'enabled' if use_ocr else 'disabled'}, lang={lang}.",
        "pages": 3
    })

# --- Functions Endpoints ---
@app.route('/functions/processReport', methods=['POST'])
def process_report():
    user_id = get_user_id()
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    # Save metadata to DB (not the file itself for simplicity)
    upload_id = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            'INSERT INTO uploads (id, user_id, filename, created_at) VALUES (?, ?, ?, ?)',
            (upload_id, user_id, file.filename, datetime.utcnow().isoformat())
        )

    # Mock processing result
    return jsonify({
        "ok": True,
        "reportId": upload_id,
        "summary": "Mock medical report processed successfully.",
        "findings": ["Mild inflammation", "Normal vitals"]
    })

@app.route('/functions/analyzeCheckin', methods=['POST'])
def analyze_checkin():
    user_id = get_user_id()
    payload = request.get_json().get('payload', {})
    
    # Save to DB
    checkin_id = str(uuid.uuid4())
    with get_db() as conn:
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

    # Mock analysis
    return jsonify({
        "ok": True,
        "risk_score": 0.28,
        "status": "analyzed"
    })

@app.route('/functions/findNearbyAmbulance')
def find_nearby_ambulance():
    lat = float(request.args.get('lat', 40.7128))
    lng = float(request.args.get('lng', -74.0060))
    radius = int(request.args.get('radiusMeters', 5000))
    
    # Mock ambulances
    return jsonify({
        "ambulances": [
            {"id": "amb-1", "name": "Downtown EMS", "distance": 1200, "eta_minutes": 8},
            {"id": "amb-2", "name": "City MedTrans", "distance": 2400, "eta_minutes": 15}
        ]
    })

@app.route('/functions/submitFeedback', methods=['POST'])
def submit_feedback():
    user_id = get_user_id()
    data = request.get_json()
    feedback = data.get('feedback', '')
    
    feedback_id = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            'INSERT INTO feedback (id, user_id, feedback, created_at) VALUES (?, ?, ?, ?)',
            (feedback_id, user_id, feedback, datetime.utcnow().isoformat())
        )
    
    return jsonify({"ok": True, "message": "Feedback received!"})

@app.route('/functions/chat', methods=['POST'])
def chat_with_gemini():
    # Mock AI response
    return jsonify({
        "response": "Based on your symptoms, I recommend rest and monitoring. If pain worsens, seek care.",
        "sources": ["CDC Guidelines", "Mayo Clinic"]
    })

@app.route('/functions/riskSeries')
def risk_series():
    user_id = request.args.get('userId', get_user_id())
    
    # Generate mock risk series (last 14 days)
    points = []
    labels = []
    base_date = datetime.utcnow()
    for i in range(14):
        date = base_date - timedelta(days=13 - i)
        labels.append(date.isoformat())
        # Simulate fluctuating risk
        risk = round(0.2 + 0.3 * (i % 5) / 5 + 0.1 * (i % 3), 3)
        points.append(min(1.0, max(0.0, risk)))
    
    return jsonify({
        "ok": True,
        "points": points,
        "labels": labels
    })

@app.route('/functions/generateReportSummary', methods=['POST'])
def generate_report_summary():
    # Mock summary
    return jsonify({
        "summary": "Patient shows stable vitals with mild fatigue. No acute concerns detected.",
        "keywords": ["fatigue", "stable", "monitor"]
    })


@app.route('/api/checkins')
def get_checkins():
    user_id = request.args.get('userId', get_user_id())
    limit = request.args.get('limit', 30, type=int)
    
    with get_db() as conn:
        cur = conn.execute(
            'SELECT * FROM daily_checkins WHERE user_id = ? ORDER BY date DESC LIMIT ?',
            (user_id, limit)
        )
        rows = cur.fetchall()
    
    # Convert to list of dicts
    checkins = [
        {
            "id": row["id"],
            "user_id": row["user_id"],
            "date": row["date"],
            "answers": json.loads(row["answers"]),
            "notes": row["notes"],
            "topK": row["topK"],
            "explainMethod": row["explainMethod"],
            "useScipyWinsorize": bool(row["useScipyWinsorize"]),
            "forceLocal": bool(row["forceLocal"])
        }
        for row in rows
    ]
    
    return jsonify(checkins)

    
# --- Optional: Serve static files or frontend (if needed) ---
@app.route('/')
def hello():
    return jsonify({"message": "Flask backend for React frontend - ready!"})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8080)