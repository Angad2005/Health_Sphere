# backend/main.py

import requests
import json
import os
import logging
from dotenv import load_dotenv
from datetime import datetime, timezone  # ✅ For timezone-aware UTC

# Load environment variables from .env file
load_dotenv(dotenv_path='../.env') # Assumes .env is in the root, one level up

class LMStudioService:
    def __init__(self):
        # Get config from environment variables
        self.base_url = os.getenv("LM_STUDIO_URL", "http://192.168.96.1:1234")
        self.model_name = os.getenv("LM_STUDIO_MODEL", "yourmodel") # Change default if needed
        self.api_endpoint = f"{self.base_url}/v1/chat/completions"
        logging.info(f"Initializing LMStudioService for model: {self.model_name} at {self.base_url}")

    def call_llm(self, prompt, max_tokens=1000, temperature=0.7):
        """
        Calls the LM Studio OpenAI-compatible API.
        """
        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt}
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False # Ensure we get a complete response, not a stream
        }
        
        headers = {
            "Content-Type": "application/json"
        }
        
        try:
            response = requests.post(
                self.api_endpoint,
                json=payload,
                headers=headers,
                timeout=120  # Reduced from 999999 to 120 seconds
            )
            
            # Check for HTTP errors
            response.raise_for_status()
            
            # Parse the JSON response
            data = response.json()
            
            # Extract the content from the response
            if "choices" in data and len(data["choices"]) > 0:
                content = data["choices"][0]["message"]["content"]
                return content.strip()
            else:
                logging.error(f"LM Studio API response missing 'choices': {data}")
                return "Error: Invalid response structure from LLM."

        except requests.exceptions.RequestException as e:
            logging.error(f"Error calling LM Studio API: {e}")
            return f"Error: Could not connect to LLM service. {e}"
        except json.JSONDecodeError:
            logging.error(f"Failed to decode JSON response: {response.text}")
            return "Error: Failed to decode LLM response."


import os
import json
import sqlite3
import uuid
import logging
from datetime import datetime, timezone  # ✅ Import timezone
from functools import wraps
from flask import Flask, request, jsonify, session
from flask_cors import CORS
import bcrypt
import re
from dotenv import load_dotenv

# --- Import your new LLM service ---
# (Assumes llm_service.py is in 'backend/services/' directory)
try:
    from services.llm_service import LMStudioService
except ImportError:
    print("WARNING: 'services.llm_service' not found. LLM endpoints will fail.")
    # Define a mock class so the app can run for testing other routes
    class LMStudioService:
        def call_llm(self, prompt, max_tokens=100, temperature=0.1):
            logging.error("Using MOCK LMStudioService. 'services.llm_service' not found.")
            return json.dumps({"error": "LLM Service not configured"})

# --- App, Logging, and Service Initialization ---
load_dotenv()
app = Flask(__name__)
logging.basicConfig(level=logging.INFO)

# Initialize LLM Service
llm_service = LMStudioService()

# --- Security & Session Configuration ---
app.secret_key = os.getenv('SECRET_KEY', 'change-this-in-production-very-secret-key-123!')
app.config.update(
    SESSION_COOKIE_NAME='health_session',
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=False,
    SESSION_COOKIE_HTTPONLY=True,
    PERMANENT_SESSION_LIFETIME=604800,   # 7 days in seconds
)

# --- CORS Configuration ---
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
        # Updated daily_checkins table
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
                forceLocal BOOLEAN,
                questions TEXT,
                question_version TEXT,
                llm_analysis TEXT
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
        # NEW: Table for report analysis
        conn.execute('''
            CREATE TABLE IF NOT EXISTS report_analyses (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                upload_id TEXT NOT NULL,
                ocr_text TEXT,
                llm_analysis TEXT,
                findings TEXT,
                urgency_level INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY (upload_id) REFERENCES uploads (id)
            )
        ''')
        # UPDATED: Enhanced chat_sessions table
        conn.execute('DROP TABLE IF EXISTS chat_sessions') # Drop old one
        conn.execute('''
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                message TEXT NOT NULL,
                response TEXT NOT NULL,
                context TEXT,
                confidence_score REAL,
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

def get_user_id():
    """Helper to get user_id from session"""
    return session.get('user_id')

# --- LLM & DB Helper Functions ---

def get_recent_checkins(user_id, days):
    """Get last 'days' check-ins for trend analysis."""
    logging.info(f"[DB] Fetching {days} recent check-ins for user {user_id}")
    with get_app_db() as conn:
        cur = conn.execute(
            'SELECT date, answers, notes, llm_analysis FROM daily_checkins WHERE user_id = ? ORDER BY date DESC LIMIT ?',
            (user_id, days)
        )
        rows = cur.fetchall()
        # Convert rows to dictionaries
        return [dict(row) for row in rows]

def get_user_context(user_id):
    """Get user health history, concerns, etc., from DB."""
    logging.info(f"[DB] Fetching context for user {user_id}")
    
    recent_checkins = get_recent_checkins(user_id, 7)
    
    chat_history = []
    with get_app_db() as conn:
        cur = conn.execute(
            'SELECT message, response FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
            (user_id,)
        )
        rows = cur.fetchall()
        chat_history = [f"User: {row['message']}\nAssistant: {row['response']}" for row in rows]
        chat_history.reverse() # Oldest to newest
        
    # TODO: Implement a 'user_profile' table to store these
    health_history = {"conditions": ["None specified"], "allergies": ["None specified"]}
    concerns = ["General wellness"]

    return {
        'recent_checkins': recent_checkins,
        'health_history': health_history,
        'concerns': concerns,
        'conversation_history': chat_history
    }

def store_analysis(user_id, checkin_id, analysis_json):
    """Store the LLM's analysis in the 'daily_checkins' table."""
    logging.info(f"[DB] Storing LLM analysis for checkin {checkin_id}")
    try:
        with get_app_db() as conn:
            conn.execute(
                'UPDATE daily_checkins SET llm_analysis = ? WHERE id = ? AND user_id = ?',
                (json.dumps(analysis_json), checkin_id, user_id)
            )
    except Exception as e:
        logging.error(f"Failed to store LLM analysis: {e}")

def store_report_analysis(user_id, upload_id, ocr_text, analysis_json):
    """Store report analysis in the 'report_analyses' table."""
    logging.info(f"[DB] Storing report analysis for upload {upload_id}")
    try:
        analysis_id = str(uuid.uuid4())
        with get_app_db() as conn:
            conn.execute(
                '''INSERT INTO report_analyses 
                   (id, user_id, upload_id, ocr_text, llm_analysis, findings, urgency_level, created_at) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    analysis_id,
                    user_id,
                    upload_id,
                    ocr_text,
                    json.dumps(analysis_json),
                    json.dumps(analysis_json.get('findings', [])),
                    analysis_json.get('urgency', 3),
                    datetime.now(timezone.utc).isoformat()  # ✅ Fixed deprecation
                )
            )
    except Exception as e:
        logging.error(f"Failed to store report analysis: {e}")

def extract_text_from_file(file_storage):
    """Real OCR: Extract text from uploaded medical documents."""
    import pytesseract
    from PIL import Image
    from pdf2image import convert_from_bytes
    import io
    
    # Optional: Try PyPDF2 for text-based PDFs first
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        PdfReader = None

    logging.info(f"[Real OCR] Extracting text from {file_storage.filename}")
    
    try:
        # Read file content
        file_content = file_storage.read()
        file_storage.seek(0)  # Reset file pointer
        
        # Get file extension
        filename = file_storage.filename.lower()
        
        if filename.endswith('.pdf'):
            # First, try direct text extraction (for non-scanned PDFs)
            if PdfReader is not None:
                try:
                    pdf_reader = PdfReader(io.BytesIO(file_content))
                    direct_text = ""
                    for page in pdf_reader.pages:
                        text = page.extract_text()
                        if text:
                            direct_text += text + "\n"
                    if direct_text.strip():
                        logging.info("✅ Extracted text directly from PDF (no OCR needed)")
                        return direct_text.strip()
                except Exception as e:
                    logging.warning(f"Direct PDF text extraction failed: {e}. Falling back to OCR.")
            
            # If direct extraction failed or gave no text, use OCR
            logging.info("🔄 Processing PDF file with OCR")
            images = convert_from_bytes(file_content, dpi=300)
            extracted_text = ""
            
            for i, image in enumerate(images):
                logging.info(f"Processing PDF page {i+1}/{len(images)}")
                # Convert PIL image to text using OCR
                page_text = pytesseract.image_to_string(image, lang='eng')
                extracted_text += f"\n--- Page {i+1} ---\n{page_text}\n"
            
            return extracted_text.strip() if extracted_text.strip() else None
            
        elif filename.endswith(('.png', '.jpg', '.jpeg', '.tiff', '.bmp')):
            # Handle image files
            logging.info("🔄 Processing image file with OCR")
            image = Image.open(io.BytesIO(file_content))
            
            # Convert image to text using OCR
            extracted_text = pytesseract.image_to_string(image, lang='eng')
            return extracted_text.strip() if extracted_text.strip() else None
            
        else:
            # Fallback for unsupported file types
            logging.warning(f"Unsupported file type: {filename}")
            return None
            
    except Exception as e:
        logging.error(f"OCR extraction failed: {e}")
        # ✅ DO NOT return fake data — return None to indicate failure
        return None

def parse_questions(llm_response_text):
    """Safely parse the LLM's JSON-formatted question list."""
    logging.info("Parsing LLM question response")
    try:
        if "```json" in llm_response_text:
            llm_response_text = llm_response_text.split("```json\n")[1].split("\n```")[0]
        return json.loads(llm_response_text)
    except Exception as e:
        logging.error(f"Failed to parse questions JSON: {e} - Response was: {llm_response_text}")
        return [{"id": "q_error", "question": "Error: Could not generate dynamic questions. Please use the default.", "type": "scale", "options": [], "required": False, "category": "error"}]

def parse_json_response(llm_response_text):
    """Safely parse a generic JSON response from the LLM."""
    logging.info("Parsing generic LLM JSON response")
    try:
        if "```json" in llm_response_text:
            llm_response_text = llm_response_text.split("```json\n")[1].split("\n```")[0]
        return json.loads(llm_response_text)
    except Exception as e:
        logging.error(f"Failed to parse JSON: {e} - Response was: {llm_response_text}")
        return {"error": "Failed to parse LLM analysis."}

def extract_suggested_actions(response_text):
    """Mock: A placeholder to extract actions from chat text."""
    actions = []
    if "consult a healthcare provider" in response_text.lower():
        actions.append("Consult a healthcare provider")
    if "monitor your symptoms" in response_text.lower():
        actions.append("Monitor your symptoms")
    return actions

def assess_response_confidence(response_text):
    """Mock: A placeholder to assess confidence."""
    # A real implementation might look at token probabilities
    return 0.95

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
                (user_id, email, password_hash, datetime.now(timezone.utc).isoformat())  # ✅ Fixed
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
    user_id = get_user_id()
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
def format_relative_time(iso_str):
    try:
        # Handle both formats: with and without timezone
        if iso_str.endswith('Z'):
            dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(iso_str)
        # Make dt offset-naive for comparison
        dt = dt.replace(tzinfo=None)
        
        # Use timezone-aware UTC now
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        diff = now_utc - dt
        seconds = diff.total_seconds()
        
        if seconds < 0:
            return "Just now" # Clock skew
        elif seconds < 60:
            return "Just now"
        elif seconds < 3600:
            return f"{int(seconds // 60)} minutes ago"
        elif seconds < 86400:
            return f"{int(seconds // 3600)} hours ago"
        elif seconds < 172800:
            return "Yesterday"
        else:
            return f"{int(seconds // 86400)} days ago"
    except Exception as e:
        logging.warning(f"Error parsing time {iso_str}: {e}")
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
            'SELECT id, created_at, message FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 3',
            (user_id,)
        )
        for row in cur.fetchall():
            activities.append({
                "id": f"chat-{row['id']}",
                "type": "chat",
                "title": f"AI chat: '{row['message'][:30]}...'",
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

# --- NEW LLM-Powered Endpoints ---

@app.route('/api/generate-questions', methods=['GET'])
@require_auth
def generate_checkin_questions():
    """
    Integration Point 1: Generate personalized daily check-in questions.
    """
    user_id = get_user_id()
    context = get_user_context(user_id)
    
    prompt = f"""
    Generate 8-10 personalized health check-in questions for user {user_id}.
    
    Context:
    - Previous responses: {context.get('recent_checkins', [])}
    - Health history: {context.get('health_history', {})}
    - Current concerns: {context.get('concerns', [])}
    
    Format the output as a single, valid JSON list (e.g., [{{...}}, {{...}}]).
    Each question object must follow this exact format:
    {{
      "id": "q1",
      "question": "How is your energy level today?",
      "type": "scale",
      "options": ["Very Low", "Low", "Normal", "High", "Very High"],
      "required": true,
      "category": "energy"
    }}
    
    Generate questions relevant to the user's context.
    Ensure 'id' is unique for each question (e.g., "q1", "q2", "q3").
    """
    
    response_text = llm_service.call_llm(prompt, max_tokens=1500, temperature=0.5)
    questions_json = parse_questions(response_text)
    
    return jsonify(questions_json)


@app.route('/functions/analyzeCheckin', methods=['POST'])
@require_auth
def analyze_checkin():
    """
    Integration Point 2: Save check-in and then analyze it with LLM.
    """
    user_id = get_user_id()
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "Invalid JSON"}), 400
        
    checkin_data = payload.get('payload', {})
    checkin_id = str(uuid.uuid4())
    checkin_time = datetime.now(timezone.utc).isoformat()  # ✅ Fixed
    answers = json.dumps(checkin_data.get('answers', {}))
    notes = checkin_data.get('notes')
    
    # Step 1: Save the check-in data to the database
    with get_app_db() as conn:
        conn.execute(
            '''INSERT INTO daily_checkins 
               (id, user_id, date, answers, notes, topK, explainMethod, useScipyWinsorize, forceLocal, questions, question_version)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                checkin_id,
                user_id,
                checkin_time,
                answers,
                notes,
                checkin_data.get('topK', 3),
                checkin_data.get('explainMethod', 'auto'),
                checkin_data.get('useScipyWinsorize', True),
                checkin_data.get('forceLocal', False),
                json.dumps(checkin_data.get('questions', [])),
                checkin_data.get('question_version', '1.0')
            )
        )
    
    # Step 2: Now, generate the LLM analysis for the data just saved
    recent_checkins = get_recent_checkins(user_id, 7)
    
    prompt = f"""
    Analyze this daily health check-in data in a professional, clinical tone:
    
    User: {user_id}
    Date: {checkin_time}
    Responses: {answers}
    Notes: {notes}
    
    Previous check-ins for context: {recent_checkins}
    
    Provide a structured JSON output with the following keys:
    1. "risk_score": A float between 0.0 (low risk) and 1.0 (high risk).
    2. "concerns": A list of strings identifying key concerns or red flags (e.g., "Consistently low energy").
    3. "trends": A brief string analyzing trends (e.g., "Energy levels are trending downwards.").
    4. "recommendations": A list of 2-3 actionable, personalized recommendations (e.g., "Consider discussing your persistent low energy with a healthcare provider.").
    5. "summary": A one-paragraph summary of the check-in.
    
    Format as a single, valid JSON object.
    """
    
    analysis_text = llm_service.call_llm(prompt, max_tokens=1000)
    analysis_json = parse_json_response(analysis_text)
    
    if "error" not in analysis_json:
        store_analysis(user_id, checkin_id, analysis_json)
    
    return jsonify(analysis_json)


@app.route('/functions/processReport', methods=['POST'])
@require_auth
def process_report():
    """
    Integration Point 3: Process uploaded medical report with OCR and LLM.
    """
    user_id = get_user_id()
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    # Step 1: Save upload record
    upload_id = str(uuid.uuid4())
    with get_app_db() as conn:
        conn.execute(
            'INSERT INTO uploads (id, user_id, filename, created_at) VALUES (?, ?, ?, ?)',
            (upload_id, user_id, file.filename, datetime.now(timezone.utc).isoformat())  # ✅ Fixed
        )
    
    # Step 2: OCR extraction (real OCR)
    ocr_text = extract_text_from_file(file)
    
    # ✅ CRITICAL FIX: Check for OCR failure
    if ocr_text is None or ocr_text.strip() == "":
        error_msg = "OCR failed: Could not extract text from the document. Ensure the file is a valid PDF or image and that the server has Poppler installed."
        logging.error(f"[OCR] {error_msg} for upload {upload_id}")
        return jsonify({
            "error": error_msg,
            "code": "ocr_failed",
            "upload_id": upload_id
        }), 422  # Unprocessable Entity

    # Step 3: LLM analysis
    prompt = f"""
    Analyze this medical report text for user {user_id}:
    
    OCR Text: 
    ---
    {ocr_text}
    ---
    
    Extract and analyze the following information. Format the output as a single, valid JSON object.
    If a value is not present, use "N/A" or an empty list [].
    
    1. "summary": A brief, one-paragraph summary of the report's main points.
    2. "findings": A list of strings for key findings and abnormalities.
    3. "lab_values": A list of objects, each with "test_name", "value", and "significance" (e.g., "Normal", "High", "Low").
    4. "diagnoses": A list of strings for any diagnoses mentioned.
    5. "medications": A list of strings for medications prescribed.
    6. "urgency": An integer from 1 (Low) to 5 (Urgent) based on the findings.
    7. "recommendations": A list of strings for follow-up actions.
    """
    
    analysis_text = llm_service.call_llm(prompt, max_tokens=2000)
    analysis_json = parse_json_response(analysis_text)
    
    if "error" not in analysis_json:
        store_report_analysis(user_id, upload_id, ocr_text, analysis_json)
    
    # Return structured response with OCR text and analysis
    return jsonify({
        "ocr": ocr_text,
        "extracted": {
            "meta": {
                "filename": file.filename,
                "upload_id": upload_id,
                "processed_at": datetime.now(timezone.utc).isoformat()  # ✅ Fixed
            },
            "labs": analysis_json.get("lab_values", []),
            "diagnoses": analysis_json.get("diagnoses", []),
            "medications": analysis_json.get("medications", [])
        },
        "llm_analysis": analysis_json
    })


@app.route('/functions/chat', methods=['POST'])
@require_auth
def chat_with_llm():
    """
    Integration Point 4: Context-aware chatbot.
    """
    user_id = get_user_id()
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400
        
    message = data.get('message', '')
    if not message:
        return jsonify({"error": "message is required"}), 400

    # Step 1: Get user's full context
    user_context = get_user_context(user_id)
    
    # Step 2: Build the prompt
    prompt = f"""
    You are 'Health Sphere', a helpful and empathetic health assistant.
    Respond to the user's query.
    
    **Guidelines:**
    - Provide helpful, general health information.
    - Be empathetic and supportive.
    - **Crucially: Do not provide specific medical diagnoses or treatment plans.**
    - Always suggest consulting a healthcare provider for medical advice, diagnosis, or persistent symptoms.
    
    **User Context (For Your Information Only - Do Not Repeat to User):**
    - Health History: {user_context.get('health_history', {})}
    - Recent Concerns: {user_context.get('concerns', [])}
    
    **Conversation History (Oldest to Newest):**
    {user_context.get('conversation_history', [])}
    
    **User Query:**
    {message}
    
    **Your Response:**
    """
    
    # Step 3: Call LLM
    response_text = llm_service.call_llm(prompt, max_tokens=1000)
    
    # Step 4: Post-process and store
    suggested_actions = extract_suggested_actions(response_text)
    confidence = assess_response_confidence(response_text)
    chat_id = str(uuid.uuid4())
    
    with get_app_db() as conn:
        conn.execute(
            '''INSERT INTO chat_sessions 
               (id, user_id, message, response, context, confidence_score, created_at) 
               VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (
                chat_id, 
                user_id, 
                message, 
                response_text, 
                json.dumps(user_context),
                confidence, 
                datetime.now(timezone.utc).isoformat()  # ✅ Fixed
            )
        )
    
    return jsonify({
        "response": response_text,
        "suggested_actions": suggested_actions,
        "confidence": confidence,
        "chat_id": chat_id
    })


# --- Other/Mock Endpoints ---

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
                "forceLocal": bool(row["forceLocal"]),
                "llm_analysis": json.loads(row["llm_analysis"]) if row["llm_analysis"] else None,
                "questions": json.loads(row["questions"]) if row["questions"] else None,
            })
        except (json.JSONDecodeError, TypeError):
            continue
            
    return jsonify(checkins)

@app.route('/functions/riskSeries')
@require_auth
def get_risk_series():
    user_id = get_user_id()
    with get_app_db() as conn:
        cur = conn.execute(
            'SELECT date, llm_analysis FROM daily_checkins WHERE user_id = ? AND llm_analysis IS NOT NULL ORDER BY date ASC LIMIT 30',
            (user_id,)
        )
        rows = cur.fetchall()
    
    risk_data = []
    for row in rows:
        try:
            analysis = json.loads(row['llm_analysis'])
            risk_score = analysis.get('risk_score')
            if risk_score is not None:
                risk_data.append({
                    "date": row['date'],
                    "risk_score": risk_score * 100
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
            (feedback_id, user_id, feedback, datetime.now(timezone.utc).isoformat())  # ✅ Fixed
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
    return jsonify({
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
    })

@app.route('/')
def hello():
    return jsonify({"message": "Flask backend ready with SQLite auth and LLM integration!"})

if __name__ == '__main__':
    port = int(os.getenv('PORT', 8080))
    
    print(f"🏥 Starting Health Sphere Flask Backend on port {port}")
    print(f"📊 Database: SQLite (auth.db, app.db)")
    print(f"🔐 Auth: Session-based with SQLite")
    print(f"🌐 CORS: Enabled for localhost:5173")
    
    app.run(debug=True, host='0.0.0.0', port=port)