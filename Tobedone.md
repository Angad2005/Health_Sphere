# Health Sphere - LLM Integration Guide

## Project Overview

Health Sphere is an AI-powered healthcare application that provides diagnostic assistance, daily health monitoring, and medical report analysis. This guide explains how to integrate a local LLM (via LM Studio) to replace the current Google Gemini integration and enhance the system's capabilities.

## Current Architecture

### Frontend (React + Vite)
- **Location**: `frontend/` directory
- **Tech Stack**: React 18, Tailwind CSS, Firebase Auth
- **Key Pages**: Dashboard, Daily Check-in, Upload Report, Chatbot Console

### Backend (Flask/Python)
- **Location**: `backend/` directory  
- **Tech Stack**: Flask, SQLite database, Session-based auth
- **Key Features**: API endpoints, data storage, authentication

### AI/ML Layer (Python FastAPI)
- **Location**: `backend/models/` directory
- **Tech Stack**: FastAPI, PyTorch, Captum, SHAP
- **Purpose**: Diagnosis models, risk assessment, explainable AI

## LLM Integration Points

### 1. Daily Check-in Questions Generation

**Current State**: Static questions in `frontend/src/pages/DailyCheckin.jsx`
- 12 predefined questions (ns_q1 to ns_q12)
- Fixed question format and options

**LLM Integration Needed**:
```python
# New endpoint: /api/generate-checkin-questions
# Input: user_id, previous_checkins, health_history
# Output: personalized questions for the day

def generate_daily_questions(user_id, context):
    """
    Generate personalized daily check-in questions based on:
    - User's health history
    - Previous check-in responses
    - Current symptoms or concerns
    - Seasonal factors
    - Risk factors
    """
    prompt = f"""
    Generate 8-12 personalized health check-in questions for user {user_id}.
    
    Context:
    - Previous responses: {context.get('previous_responses', [])}
    - Health history: {context.get('health_history', {})}
    - Current concerns: {context.get('current_concerns', [])}
    
    Format each question as:
    {{
        "id": "q1",
        "question": "How is your energy level today?",
        "type": "scale",
        "options": ["Very Low", "Low", "Normal", "High", "Very High"],
        "required": true,
        "category": "energy"
    }}
    """
    
    # Call your LM Studio LLM here
    response = call_lm_studio(prompt)
    return parse_questions(response)
```

**Database Schema Update**:
```sql
-- Add to daily_checkins table
ALTER TABLE daily_checkins ADD COLUMN questions TEXT; -- JSON of generated questions
ALTER TABLE daily_checkins ADD COLUMN question_version TEXT; -- Version of question set
```

### 2. Data Storage and Analysis

**Current State**: Data stored in SQLite with basic analysis
- Check-in responses stored as JSON in `answers` column
- Basic risk scoring in `analyzeCheckin` endpoint

**LLM Integration Needed**:
```python
# Enhanced analysis endpoint
def analyze_checkin_with_llm(user_id, checkin_data):
    """
    Use LLM to analyze check-in responses and provide insights
    """
    prompt = f"""
    Analyze this daily health check-in data:
    
    User: {user_id}
    Date: {checkin_data['date']}
    Responses: {checkin_data['answers']}
    Notes: {checkin_data.get('notes', '')}
    
    Previous check-ins: {get_recent_checkins(user_id, 7)}
    
    Provide:
    1. Risk assessment (0-1 scale)
    2. Key concerns or red flags
    3. Trend analysis compared to previous days
    4. Personalized recommendations
    5. Suggested follow-up actions
    """
    
    analysis = call_lm_studio(prompt)
    
    # Store enhanced analysis
    store_analysis(user_id, checkin_data['id'], analysis)
    
    return {
        "risk_score": analysis['risk_score'],
        "concerns": analysis['concerns'],
        "trends": analysis['trends'],
        "recommendations": analysis['recommendations']
    }
```

### 3. Report Upload and OCR Processing

**Current State**: Basic file upload with mock OCR
- Files uploaded to `/functions/processReport`
- Mock analysis returned

**LLM Integration Needed**:
```python
# Enhanced report processing
def process_report_with_llm(file, user_id):
    """
    Process uploaded medical reports using LLM
    """
    # Step 1: OCR extraction (existing)
    ocr_text = extract_text_from_file(file)
    
    # Step 2: LLM analysis
    prompt = f"""
    Analyze this medical report for user {user_id}:
    
    OCR Text: {ocr_text}
    
    Extract and analyze:
    1. Key findings and abnormalities
    2. Lab values and their significance
    3. Diagnoses mentioned
    4. Medications prescribed
    5. Risk factors identified
    6. Recommendations for follow-up
    7. Urgency level (1-5 scale)
    
    Format as structured JSON with clear categories.
    """
    
    analysis = call_lm_studio(prompt)
    
    # Step 3: Store in database
    store_report_analysis(user_id, file.filename, ocr_text, analysis)
    
    return {
        "summary": analysis['summary'],
        "findings": analysis['findings'],
        "lab_values": analysis['lab_values'],
        "diagnoses": analysis['diagnoses'],
        "medications": analysis['medications'],
        "urgency": analysis['urgency'],
        "recommendations": analysis['recommendations']
    }
```

### 4. Chatbot and Conversational AI

**Current State**: Mock chatbot responses
- Basic chat interface in `ChatbotConsole.jsx`
- Mock responses from `/functions/chat`

**LLM Integration Needed**:
```python
# Enhanced chatbot with context awareness
def chat_with_llm(user_id, message, context):
    """
    Provide intelligent health guidance using LLM
    """
    # Get user context
    user_context = get_user_context(user_id)
    
    prompt = f"""
    You are a helpful health assistant. Respond to this user's query:
    
    User Query: {message}
    
    User Context:
    - Recent check-ins: {user_context['recent_checkins']}
    - Health history: {user_context['health_history']}
    - Current concerns: {user_context['concerns']}
    - Previous conversations: {context.get('conversation_history', [])}
    
    Guidelines:
    - Provide helpful, accurate health information
    - Suggest when to consult a healthcare provider
    - Be empathetic and supportive
    - Do not provide specific medical diagnoses
    - Encourage professional medical advice when appropriate
    """
    
    response = call_lm_studio(prompt)
    
    # Store conversation
    store_conversation(user_id, message, response)
    
    return {
        "response": response,
        "suggested_actions": extract_suggested_actions(response),
        "confidence": assess_response_confidence(response)
    }
```

## Implementation Steps

### Step 1: Set up LM Studio Integration

1. **Install LM Studio** and load your preferred model
2. **Create LLM service wrapper**:
```python
# backend/services/llm_service.py
import requests
import json

class LMStudioService:
    def __init__(self, base_url="http://localhost:1234"):
        self.base_url = base_url
    
    def call_llm(self, prompt, max_tokens=1000, temperature=0.7):
        """
        Call LM Studio API
        """
        payload = {
            "model": "your-model-name",
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "max_tokens": max_tokens,
            "temperature": temperature
        }
        
        response = requests.post(
            f"{self.base_url}/v1/chat/completions",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        return response.json()["choices"][0]["message"]["content"]
```

### Step 2: Update Database Schema

```sql
-- Add LLM-related columns
ALTER TABLE daily_checkins ADD COLUMN llm_analysis TEXT;
ALTER TABLE daily_checkins ADD COLUMN questions TEXT;
ALTER TABLE daily_checkins ADD COLUMN question_version TEXT;

-- Create new tables for enhanced features
CREATE TABLE IF NOT EXISTS report_analyses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    upload_id TEXT NOT NULL,
    ocr_text TEXT,
    llm_analysis TEXT,
    findings TEXT,
    urgency_level INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions_enhanced (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    response TEXT NOT NULL,
    context TEXT,
    confidence_score REAL,
    created_at TEXT NOT NULL
);
```

### Step 3: Update API Endpoints

1. **Daily Check-in Questions**:
   - `GET /api/generate-questions` - Generate personalized questions
   - `POST /api/analyze-checkin-enhanced` - Enhanced analysis with LLM

2. **Report Processing**:
   - `POST /api/process-report-enhanced` - LLM-powered report analysis
   - `GET /api/report-analysis/{report_id}` - Get detailed analysis

3. **Chatbot**:
   - `POST /api/chat-enhanced` - Context-aware chatbot responses
   - `GET /api/chat-history` - Get conversation history

### Step 4: Frontend Updates

1. **Dynamic Question Generation**:
   - Update `DailyCheckin.jsx` to fetch questions from API
   - Add loading states for question generation
   - Implement question versioning

2. **Enhanced Report Analysis**:
   - Update `UploadReport.jsx` to show LLM analysis
   - Add structured display of findings
   - Implement confidence indicators

3. **Improved Chatbot**:
   - Update `ChatbotConsole.jsx` for context awareness
   - Add typing indicators
   - Implement conversation memory

## Configuration

### Environment Variables
```bash
# .env file
LM_STUDIO_URL=http://localhost:1234
LM_STUDIO_MODEL=your-model-name
LLM_MAX_TOKENS=1000
LLM_TEMPERATURE=0.7
```

### Model Selection Recommendations
- **For Health Analysis**: Use models trained on medical data
- **For General Chat**: Use general-purpose models with health knowledge
- **For Report Analysis**: Use models with strong text analysis capabilities

## Testing and Validation

### 1. Unit Tests
- Test LLM service integration
- Validate question generation
- Test analysis accuracy

### 2. Integration Tests
- End-to-end check-in flow
- Report processing pipeline
- Chatbot conversation flow

### 3. Performance Monitoring
- Response time tracking
- Token usage monitoring
- Error rate analysis

## Security and Privacy

### Data Protection
- Ensure all health data is encrypted
- Implement proper access controls
- Log all LLM interactions for audit

### LLM Safety
- Implement content filtering
- Add response validation
- Monitor for inappropriate medical advice

## Deployment Considerations

### 1. LLM Service Setup
- Run LM Studio as a service
- Configure proper resource allocation
- Set up monitoring and logging

### 2. Database Migration
- Plan schema updates carefully
- Backup existing data
- Test migration scripts

### 3. API Versioning
- Maintain backward compatibility
- Implement gradual rollout
- Monitor for issues

## Monitoring and Maintenance

### Key Metrics to Track
- LLM response quality
- User satisfaction with generated questions
- Analysis accuracy
- System performance

### Regular Maintenance
- Update LLM models
- Retrain on new data
- Monitor for drift
- Update prompts based on feedback

## Next Steps

1. **Immediate**: Set up LM Studio and basic integration
2. **Short-term**: Implement question generation
3. **Medium-term**: Add enhanced analysis and report processing
4. **Long-term**: Implement continuous learning and model updates

This guide provides a comprehensive roadmap for integrating your local LLM with the Health Sphere application. The modular approach allows for gradual implementation while maintaining system stability.
