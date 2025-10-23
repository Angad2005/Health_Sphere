#!/usr/bin/env python3
"""
Flask backend startup script for Health Sphere
"""
import os
import sys
from main import app

if __name__ == '__main__':
    # Set default port
    port = int(os.getenv('PORT', 8080))
    
    print(f"🏥 Starting Health Sphere Flask Backend on port {port}")
    print(f"📊 Database: SQLite (auth.db, app.db)")
    print(f"🔐 Auth: Session-based with SQLite")
    print(f"🌐 CORS: Enabled for localhost:5173")
    
    app.run(debug=True, host='0.0.0.0', port=port)

