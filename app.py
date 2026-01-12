import os
import json
from datetime import datetime
from flask import Flask, render_template_string, request, jsonify
import hashlib
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

app = Flask(__name__)
app.secret_key = 'your-secret-key-here'

# Configuration
LOCAL_MODE = os.environ.get('LOCAL_MODE', 'True').lower() == 'true'
SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar']
CREDENTIALS_FILE = 'credentials.json'
TOKEN_FILE = 'token.json'
DATA_FILE = 'checkin_data.json'
DEVICES_FILE = 'devices.json'
SPREADSHEET_ID = os.environ.get('SPREADSHEET_ID')

def load_local_data():
    """Load data from local JSON files"""
    try:
        with open(DATA_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return []

def save_local_data(data):
    """Save data to local JSON file"""
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def load_devices():
    """Load device data from local JSON file"""
    try:
        with open(DEVICES_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_devices(devices):
    """Save device data to local JSON file"""
    with open(DEVICES_FILE, 'w') as f:
        json.dump(devices, f, indent=2)

def get_google_credentials():
    """Get Google API credentials"""
    creds = None
    
    # Load existing token
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    
    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = Flow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            flow.redirect_uri = 'http://localhost:5002/oauth2callback'
            
            # Generate authorization URL
            auth_url, _ = flow.authorization_url(prompt='consent')
            
            # For now, return None to indicate auth needed
            return None
            
        # Save the credentials for the next run
        with open(TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())
    
    return creds

def create_spreadsheet(service, title="NFC Check-in Data"):
    """Create a new Google Spreadsheet"""
    spreadsheet = {
        'properties': {
            'title': title
        },
        'sheets': [{
            'properties': {
                'title': 'Check-ins'
            }
        }]
    }
    
    sheet = service.spreadsheets().create(body=spreadsheet).execute()
    spreadsheet_id = sheet.get('spreadsheetId')
    
    # Add headers
    headers = [['Timestamp', 'Device ID', 'Name', 'Event']]
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range='A1:D1',
        valueInputOption='RAW',
        body={'values': headers}
    ).execute()
    
    return spreadsheet_id

def append_to_sheet(data):
    """Append data to Google Sheets"""
    if LOCAL_MODE:
        return True
        
    creds = get_google_credentials()
    if not creds:
        return False
    
    try:
        service = build('sheets', 'v4', credentials=creds)
        
        global SPREADSHEET_ID
        if not SPREADSHEET_ID:
            SPREADSHEET_ID = create_spreadsheet(service)
            print(f"Created new spreadsheet: {SPREADSHEET_ID}")
        
        values = [[
            data['timestamp'],
            data['device_id'],
            data['name'],
            data['event']
        ]]
        
        body = {'values': values}
        result = service.spreadsheets().values().append(
            spreadsheetId=SPREADSHEET_ID,
            range='A:D',
            valueInputOption='RAW',
            insertDataOption='INSERT_ROWS',
            body=body
        ).execute()
        
        return True
        
    except Exception as e:
        print(f"Error writing to sheets: {e}")
        return False

@app.route('/')
def index():
    return render_template_string('''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NFC Check-In System</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .container {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 15px 35px rgba(0, 0, 0, 0.1);
            text-align: center;
            max-width: 400px;
            width: 90%;
        }
        
        .logo {
            width: 80px;
            height: 80px;
            background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
            border-radius: 50%;
            margin: 0 auto 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 30px;
            color: white;
        }
        
        h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 24px;
        }
        
        .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 14px;
        }
        
        .form-group {
            margin-bottom: 20px;
            text-align: left;
        }
        
        label {
            display: block;
            margin-bottom: 5px;
            color: #333;
            font-weight: 500;
        }
        
        input[type="text"] {
            width: 100%;
            padding: 15px;
            border: 2px solid #e1e1e1;
            border-radius: 10px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        
        input[type="text"]:focus {
            outline: none;
            border-color: #667eea;
        }
        
        .btn-group {
            display: flex;
            gap: 10px;
            margin-top: 30px;
        }
        
        .btn {
            flex: 1;
            padding: 15px;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        .btn-checkin {
            background: linear-gradient(45deg, #4CAF50, #45a049);
            color: white;
        }
        
        .btn-checkout {
            background: linear-gradient(45deg, #ff6b6b, #ff5252);
            color: white;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
        }
        
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .status {
            margin-top: 20px;
            padding: 15px;
            border-radius: 10px;
            font-weight: 500;
        }
        
        .status.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .status.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .device-info {
            margin-top: 20px;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 10px;
            font-size: 12px;
            color: #666;
        }
        
        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">📱</div>
        <h1>NFC Check-In</h1>
        <p class="subtitle">Tap your device or enter your details</p>
        
        <div class="form-group">
            <label for="name">Your Name</label>
            <input type="text" id="name" placeholder="Enter your name" autocomplete="name">
        </div>
        
        <div class="btn-group">
            <button class="btn btn-checkin" onclick="handleAction('checkin')">
                Check In
            </button>
            <button class="btn btn-checkout" onclick="handleAction('checkout')">
                Check Out
            </button>
        </div>
        
        <div id="status" class="status hidden"></div>
        <div id="deviceInfo" class="device-info hidden"></div>
    </div>

    <script>
        let deviceFingerprint = null;
        
        // Generate device fingerprint
        function generateDeviceFingerprint() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Draw some text and shapes to create a unique fingerprint
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillText('Device fingerprint test', 2, 2);
            
            // Add more entropy
            const fingerprint = {
                canvas: canvas.toDataURL(),
                screen: `${screen.width}x${screen.height}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                language: navigator.language,
                platform: navigator.platform,
                userAgent: navigator.userAgent.slice(0, 100), // Truncate for privacy
                colorDepth: screen.colorDepth,
                pixelRatio: window.devicePixelRatio
            };
            
            // Create hash of fingerprint data
            const fingerprintString = JSON.stringify(fingerprint);
            return btoa(fingerprintString).substring(0, 16);
        }
        
        // Initialize device fingerprint
        deviceFingerprint = generateDeviceFingerprint();
        
        // Show device info
        document.getElementById('deviceInfo').innerHTML = `Device ID: ${deviceFingerprint}`;
        document.getElementById('deviceInfo').classList.remove('hidden');
        
        // Check if device is already registered
        fetch('/api/device/' + deviceFingerprint)
            .then(response => response.json())
            .then(data => {
                if (data.registered && data.name) {
                    document.getElementById('name').value = data.name;
                    document.getElementById('name').setAttribute('readonly', true);
                    showStatus('Device recognized: ' + data.name, 'success');
                }
            })
            .catch(err => console.log('Device not registered'));
        
        function showStatus(message, type) {
            const statusDiv = document.getElementById('status');
            statusDiv.textContent = message;
            statusDiv.className = `status ${type}`;
            statusDiv.classList.remove('hidden');
            
            setTimeout(() => {
                statusDiv.classList.add('hidden');
            }, 3000);
        }
        
        function handleAction(action) {
            const nameInput = document.getElementById('name');
            const name = nameInput.value.trim();
            
            if (!name) {
                showStatus('Please enter your name', 'error');
                nameInput.focus();
                return;
            }
            
            // Disable buttons during request
            const buttons = document.querySelectorAll('.btn');
            buttons.forEach(btn => btn.disabled = true);
            
            const data = {
                device_id: deviceFingerprint,
                name: name,
                event: action,
                timestamp: new Date().toISOString()
            };
            
            fetch('/api/checkin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    showStatus(`${action === 'checkin' ? 'Checked in' : 'Checked out'} successfully!`, 'success');
                    
                    // Register device if successful
                    if (!nameInput.hasAttribute('readonly')) {
                        nameInput.setAttribute('readonly', true);
                    }
                } else {
                    showStatus(result.error || 'An error occurred', 'error');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showStatus('Network error occurred', 'error');
            })
            .finally(() => {
                // Re-enable buttons
                buttons.forEach(btn => btn.disabled = false);
            });
        }
        
        // Handle Enter key in name input
        document.getElementById('name').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                handleAction('checkin');
            }
        });
    </script>
</body>
</html>
    ''')

@app.route('/api/checkin', methods=['POST'])
def api_checkin():
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['device_id', 'name', 'event', 'timestamp']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing field: {field}'}), 400
        
        # Register device if not already registered
        devices = load_devices()
        if data['device_id'] not in devices:
            devices[data['device_id']] = {
                'name': data['name'],
                'registered_at': data['timestamp']
            }
            save_devices(devices)
        
        # Save to local storage
        if LOCAL_MODE:
            checkin_data = load_local_data()
            checkin_data.append(data)
            save_local_data(checkin_data)
        
        # Try to save to Google Sheets
        if not LOCAL_MODE:
            sheet_success = append_to_sheet(data)
            if not sheet_success:
                return jsonify({'success': False, 'error': 'Failed to write to Google Sheets'}), 500
        
        return jsonify({'success': True, 'message': 'Check-in recorded successfully'})
        
    except Exception as e:
        print(f"Error in api_checkin: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/device/<device_id>')
def api_device(device_id):
    devices = load_devices()
    
    if device_id in devices:
        return jsonify({
            'registered': True,
            'name': devices[device_id]['name'],
            'registered_at': devices[device_id]['registered_at']
        })
    else:
        return jsonify({'registered': False})

@app.route('/api/data')
def api_data():
    if LOCAL_MODE:
        data = load_local_data()
        return jsonify(data)
    else:
        # Could implement Google Sheets reading here
        return jsonify({'error': 'Google Sheets reading not implemented'})

@app.route('/oauth2callback')
def oauth2callback():
    # Handle OAuth callback
    try:
        flow = Flow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
        flow.redirect_uri = 'http://localhost:5002/oauth2callback'
        
        authorization_response = request.url
        flow.fetch_token(authorization_response=authorization_response)
        
        # Save credentials
        creds = flow.credentials
        with open(TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())
            
        return '<h1>Authentication successful!</h1><p>You can now close this tab and return to the app.</p>'
        
    except Exception as e:
        return f'<h1>Authentication failed!</h1><p>Error: {e}</p>'

@app.route('/health')
def health():
    return jsonify({
        'status': 'healthy',
        'mode': 'local' if LOCAL_MODE else 'google',
        'timestamp': datetime.now().isoformat()
    })

if __name__ == '__main__':
    print("🚀 NFC Check-In System Starting...")
    print(f"📊 Mode: {'LOCAL' if LOCAL_MODE else 'GOOGLE SHEETS'}")
    print("🌐 Server running on http://localhost:5002")
    
    # Create data files if they don't exist
    if not os.path.exists(DATA_FILE):
        save_local_data([])
    if not os.path.exists(DEVICES_FILE):
        save_devices({})
    
    app.run(host='0.0.0.0', port=5002, debug=True)