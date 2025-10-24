# backend/services/llm_service.py

import requests
import json
import os
import logging
from dotenv import load_dotenv

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
                timeout=999999  # 120-second timeout for potentially long responses
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