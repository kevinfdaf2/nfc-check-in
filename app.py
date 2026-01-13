import os
import json
from datetime import datetime
from collections import Counter
from flask import Flask, render_template, request, jsonify
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

# Allow OAuth over HTTP for localhost development
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

app = Flask(__name__)

# Configuration
SCOPES           = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar']
CREDENTIALS_FILE = 'credentials.json'
TOKEN_FILE       = 'token.json'
SPREADSHEET_ID   = '1un4pQ3a_zjN6SdH80ikVEAqr1nDS5BnGw7-sRal64sY'

def get_allowed_locations():
    """Get allowed check-in locations from Google Sheets Location tab"""
    creds = get_google_credentials()
    if not creds:
        return {}
        
    try:
        service = build('sheets', 'v4', credentials=creds)
        
        # Read from 'Location' sheet
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range='Location!A:D'
        ).execute()
        
        values = result.get('values', [])
        locations = {}
        
        # Parse locations (skip header row)
        for row in values[1:]:
            if len(row) >= 4:
                name = row[0]
                try:
                    lat = float(row[1])
                    lng = float(row[2])
                    radius = float(row[3])
                    locations[name] = {'lat': lat, 'lng': lng, 'radius': radius}
                except (ValueError, IndexError) as e:
                    print(f"Invalid location data for {name}: {e}")
                    continue
        
        print(f"✅ Loaded {len(locations)} locations from sheet")
        return locations
        
    except Exception as e:
        print(f"Error reading locations from sheet: {e}")
        return {}

def calculate_distance(lat1, lng1, lat2, lng2):
    """Calculate distance between two GPS coordinates in meters using Haversine formula"""
    from math import radians, sin, cos, sqrt, atan2
    
    R = 6371000  # Earth's radius in meters
    
    lat1_rad = radians(lat1)
    lat2_rad = radians(lat2)
    delta_lat = radians(lat2 - lat1)
    delta_lng = radians(lng2 - lng1)
    
    a = sin(delta_lat / 2) ** 2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lng / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    
    return R * c

def get_device_from_sheets(device_id):
    """Get device info from Google Sheets Users tab"""
    creds = get_google_credentials()
    if not creds:
        return None
        
    try:
        service = build('sheets', 'v4', credentials=creds)
        
        # Read from 'Users' sheet
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range='Users!A:E'
        ).execute()
        
        values = result.get('values', [])
        
        # Find device by ID (Device ID is in column A, User Name in column B)
        for row in values[1:]:  # Skip header
            if len(row) > 0 and row[0] == device_id:
                return {
                    'name': row[1] if len(row) > 1 else '',
                    'registered_at': row[2] if len(row) > 2 else '',
                    'last_checkin': row[3] if len(row) > 3 else '',
                    'checkin_count': int(row[4]) if len(row) > 4 and row[4].isdigit() else 0
                }
        return None
        
    except Exception as e:
        print(f"Error reading devices from Users sheet: {e}")
        return None

def save_device_to_sheets(device_id, device_data):
    """Save device info to Google Sheets Users tab"""
    creds = get_google_credentials()
    if not creds:
        print(f"📊 Device data would be saved locally: {device_data['name']}")
        return True
        
    try:
        service = build('sheets', 'v4', credentials=creds)
        
        # Use existing Users sheet - no need to create
        # Check if device already exists
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range='Users!A:E'
        ).execute()
        
        values = result.get('values', [])
        device_row = None
        
        # Find existing device
        for i, row in enumerate(values[1:], start=2):  # Skip header, start from row 2
            if len(row) > 0 and row[0] == device_id:
                device_row = i
                break
        
        device_values = [
            device_id,
            device_data['name'],
            device_data.get('registered_at', ''),
            device_data.get('last_checkin', ''),
            str(device_data.get('checkin_count', 0))
        ]
        
        if device_row:
            # Update existing device
            service.spreadsheets().values().update(
                spreadsheetId=SPREADSHEET_ID,
                range=f'Users!A{device_row}:E{device_row}',
                valueInputOption='RAW',
                body={'values': [device_values]}
            ).execute()
        else:
            # Add new device
            service.spreadsheets().values().append(
                spreadsheetId=SPREADSHEET_ID,
                range='Users!A:E',
                valueInputOption='RAW',
                insertDataOption='INSERT_ROWS',
                body={'values': [device_values]}
            ).execute()
        
        print(f"✅ Device data saved to Users sheet: {device_data['name']} - {device_id}")
        return True
        
    except Exception as e:
        print(f"❌ Error saving device to Users sheet: {e}")
        return False

def get_google_credentials():
    """Get Google API credentials using OAuth or environment variables"""
    creds = None
    
    # For cloud deployment, create credentials from environment variables
    if os.environ.get('GOOGLE_CLIENT_ID') and os.environ.get('GOOGLE_CLIENT_SECRET'):
        # Create credentials.json content from environment variables
        credentials_content = {
            "installed": {
                "client_id": os.environ.get('GOOGLE_CLIENT_ID'),
                "project_id": os.environ.get('GOOGLE_PROJECT_ID', 'nfc-check-in'),
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "client_secret": os.environ.get('GOOGLE_CLIENT_SECRET'),
                "redirect_uris": ["http://localhost"]
            }
        }
        
        # Save to temporary file for this session
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(credentials_content, f)
            temp_credentials_file = f.name
        
        CREDENTIALS_FILE_TO_USE = temp_credentials_file
    else:
        CREDENTIALS_FILE_TO_USE = CREDENTIALS_FILE
    
    # Load existing token from environment variable (for cloud) or file (for local)
    if os.environ.get('GOOGLE_TOKEN_JSON'):
        # Cloud deployment - load from environment variable
        token_data = json.loads(os.environ.get('GOOGLE_TOKEN_JSON'))
        creds = Credentials.from_authorized_user_info(token_data, SCOPES)
    elif os.path.exists(TOKEN_FILE):
        # Local development - load from file
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    
    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if os.path.exists(CREDENTIALS_FILE_TO_USE):
                flow = Flow.from_client_secrets_file(CREDENTIALS_FILE_TO_USE, SCOPES)
                # Use environment variable for redirect URI in cloud, localhost for local
                if os.environ.get('RAILWAY_PUBLIC_DOMAIN') or os.environ.get('RENDER_EXTERNAL_HOSTNAME'):
                    # Cloud deployment
                    domain = os.environ.get('RAILWAY_PUBLIC_DOMAIN') or os.environ.get('RENDER_EXTERNAL_HOSTNAME')
                    flow.redirect_uri = f'https://{domain}/oauth2callback'
                else:
                    # Local development
                    flow.redirect_uri = 'http://localhost:5002/oauth2callback'
                
                # Generate authorization URL
                auth_url, _ = flow.authorization_url(prompt='consent')
                print(f"🔐 Please visit this URL to authorize the application: {auth_url}")
                return None
            else:
                print("❌ No credentials found - set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables")
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
    headers = [['Timestamp', 'Device ID', 'Name', 'Event', 'Location']]
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range='A1:E1',
        valueInputOption='RAW',
        body={'values': headers}
    ).execute()
    
    return spreadsheet_id

def append_to_sheet(data):
    """Append data to Google Sheets"""
    # Try to use existing credentials (only for admin/owner)
    creds = get_google_credentials()
    if not creds:
        print(f"⚠️ No credentials available for {data['name']}: {data['event']} at {data['timestamp']}")
        return False
    
    try:
        service = build('sheets', 'v4', credentials=creds)
        
        values = [[
            data['timestamp'],
            data['device_id'],
            data['name'],
            data['event'],
            data['location']
        ]]
        
        body = {'values': values}
        result = service.spreadsheets().values().append(
            spreadsheetId=SPREADSHEET_ID,
            range='A:E',
            valueInputOption='RAW',
            insertDataOption='INSERT_ROWS',
            body=body
        ).execute()
        
        print(f"✅ Data saved to Google Sheets: {data['name']} - {data['event']}")
        return True
        
    except Exception as e:
        print(f"❌ Error writing to sheets: {e}")
        return False

@app.route('/')
def index():
    location = request.args.get('location', 'Unknown Location')
    return render_template('index.html', location=location)

@app.route('/api/locations')
def api_locations():
    """Get list of valid location names"""
    try:
        allowed_locations = get_allowed_locations()
        return jsonify({
            'success': True,
            'locations': list(allowed_locations.keys())
        })
    except Exception as e:
        print(f"Error getting locations: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/verify-location', methods=['POST'])
def api_verify_location():
    """Verify if user's GPS coordinates are within allowed location radius"""
    try:
        data = request.get_json()
        user_lat = data.get('latitude')
        user_lng = data.get('longitude')
        location_name = data.get('location')
        
        if not all([user_lat, user_lng, location_name]):
            return jsonify({'success': False, 'error': 'Missing GPS coordinates or location'}), 400
        
        # Get allowed locations from Google Sheets
        allowed_locations = get_allowed_locations()
        
        # Check if location exists (case-insensitive)
        matched_location = None
        for loc_name, loc_data in allowed_locations.items():
            if loc_name.lower() == location_name.lower():
                matched_location = loc_name
                break
        
        if not matched_location:
            return jsonify({'success': False, 'error': f'Location "{location_name}" not configured in Location sheet'}), 400
        
        allowed = allowed_locations[matched_location]
        distance = calculate_distance(user_lat, user_lng, allowed['lat'], allowed['lng'])
        
        if distance <= allowed['radius']:
            return jsonify({
                'success': True,
                'verified': True,
                'distance': round(distance, 1),
                'message': f'Location verified - you are {round(distance, 1)}m from {location_name}'
            })
        else:
            return jsonify({
                'success': True,
                'verified': False,
                'distance': round(distance, 1),
                'message': f'Too far from {location_name} - you are {round(distance, 1)}m away (max {allowed["radius"]}m)'
            })
            
    except Exception as e:
        print(f"Error verifying location: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/checkin', methods=['POST'])
def api_checkin():
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['device_id', 'name', 'event', 'timestamp', 'latitude', 'longitude']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing field: {field}'}), 400
        
        # Validate location - reject if empty or 'Unknown Location'
        location = data.get('location', '').strip()
        if not location or location == 'Unknown Location':
            return jsonify({'success': False, 'error': 'Location is required for check-in'}), 400
        
        # Verify GPS location is within allowed radius (case-insensitive)
        allowed_locations = get_allowed_locations()
        matched_location = None
        for loc_name, loc_data in allowed_locations.items():
            if loc_name.lower() == location.lower():
                matched_location = loc_name
                break
        
        if matched_location:
            allowed = allowed_locations[matched_location]
            distance = calculate_distance(data['latitude'], data['longitude'], allowed['lat'], allowed['lng'])
            
            if distance > allowed['radius']:
                return jsonify({
                    'success': False,
                    'error': f'You are too far from {matched_location} ({round(distance, 1)}m away, max {allowed["radius"]}m allowed)'
                }), 403
        
        data['location'] = location
            
        # Register device if not already registered
        device_info = get_device_from_sheets(data['device_id'])
        
        if not device_info:
            # New device
            device_data = {
                'name': data['name'],
                'registered_at': data['timestamp'],
                'last_checkin': data['timestamp'],
                'checkin_count': 1
            }
            save_device_to_sheets(data['device_id'], device_data)
            print(f"🆔 New device registered: {data['name']} - {data['device_id']}")
        else:
            # Update existing device
            device_data = {
                'name': device_info['name'],
                'registered_at': device_info['registered_at'],
                'last_checkin': data['timestamp'],
                'checkin_count': device_info.get('checkin_count', 0) + 1
            }
            save_device_to_sheets(data['device_id'], device_data)
        
        # Try to save to Google Sheets
        sheet_success = append_to_sheet(data)
        if not sheet_success:
            return jsonify({'success': False, 'error': 'Failed to save data'}), 500
        
        return jsonify({'success': True, 'message': 'Check-in recorded successfully'})
        
    except Exception as e:
        print(f"Error in api_checkin: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/device/<device_id>')
def api_device(device_id):
    device_info = get_device_from_sheets(device_id)
    
    if device_info:
        return jsonify({
            'registered': True,
            'name': device_info['name'],
            'registered_at': device_info['registered_at']
        })
    else:
        return jsonify({'registered': False})

@app.route('/api/device/<device_id>/update-name', methods=['POST'])
def api_update_device_name(device_id):
    try:
        data = request.get_json()
        new_name = data.get('new_name', '').strip()
        passphrase = data.get('passphrase', '').strip()
        
        if not new_name:
            return jsonify({'success': False, 'error': 'Name is required'}), 400
        
        if passphrase != 'imsb':
            return jsonify({'success': False, 'error': 'WHY BABY WHY, you\'re sb'}), 403
        
        device_info = get_device_from_sheets(device_id)
        
        if not device_info:
            return jsonify({'success': False, 'error': 'Device not registered'}), 404
        
        old_name = device_info['name']
        
        # Update device with new name
        device_data = {
            'name': new_name,
            'registered_at': device_info['registered_at'],
            'last_checkin': device_info.get('last_checkin', ''),
            'checkin_count': device_info.get('checkin_count', 0),
            'name_updated_at': datetime.now().isoformat()
        }
        
        save_device_to_sheets(device_id, device_data)
        
        print(f"🔄 Device name updated: {device_id} - {old_name} → {new_name}")
        
        return jsonify({
            'success': True, 
            'message': f'Name updated from {old_name} to {new_name}',
            'old_name': old_name,
            'new_name': new_name
        })
        
    except Exception as e:
        print(f"Error updating device name: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/data')
def api_data():
    return jsonify({'error': 'Please use Google Sheets directly to view data', 'spreadsheet_id': SPREADSHEET_ID})

@app.route('/oauth2callback')
def oauth2callback():
    # Handle OAuth callback
    try:
        # Determine credentials file to use
        if os.environ.get('GOOGLE_CLIENT_ID') and os.environ.get('GOOGLE_CLIENT_SECRET'):
            # Create credentials from environment variables
            credentials_content = {
                "installed": {
                    "client_id": os.environ.get('GOOGLE_CLIENT_ID'),
                    "project_id": os.environ.get('GOOGLE_PROJECT_ID', 'nfc-check-in'),
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                    "client_secret": os.environ.get('GOOGLE_CLIENT_SECRET'),
                    "redirect_uris": ["http://localhost"]
                }
            }
            
            import tempfile
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                json.dump(credentials_content, f)
                temp_credentials_file = f.name
            
            flow = Flow.from_client_secrets_file(temp_credentials_file, SCOPES)
        else:
            flow = Flow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
        
        # Set redirect URI based on environment
        if os.environ.get('RAILWAY_PUBLIC_DOMAIN') or os.environ.get('RENDER_EXTERNAL_HOSTNAME'):
            domain = os.environ.get('RAILWAY_PUBLIC_DOMAIN') or os.environ.get('RENDER_EXTERNAL_HOSTNAME')
            flow.redirect_uri = f'https://{domain}/oauth2callback'
        else:
            flow.redirect_uri = 'http://localhost:5002/oauth2callback'
        
        # Use the current request URL for authorization response
        authorization_response = request.url
        flow.fetch_token(authorization_response=authorization_response)
        
        # Save credentials
        creds = flow.credentials
        with open(TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())
            
        print("✅ Google credentials saved successfully!")
        return '''
        <html>
        <head><title>Authentication Success</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px;">
            <h1>✅ Authentication Successful!</h1>
            <p>Google Sheets is now connected to your NFC check-in system.</p>
            <p><strong>You can close this tab and return to your app.</strong></p>
            <p>Future NFC check-ins will automatically save to your spreadsheet!</p>
        </body>
        </html>
        '''
        
    except Exception as e:
        print(f"❌ OAuth callback error: {e}")
        return f'''
        <html>
        <head><title>Authentication Failed</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px;">
            <h1>❌ Authentication Failed</h1>
            <p>Error: {e}</p>
            <p>Please try again or check the server logs.</p>
        </body>
        </html>
        '''

@app.route('/admin')
def admin():
    """Admin dashboard with statistics"""
    return render_template('admin.html')

@app.route('/api/admin-stats')
def api_admin_stats():
    """Get statistics for admin dashboard"""
    creds = get_google_credentials()
    if not creds:
        return jsonify({'error': 'No Google credentials available'}), 403
    
    try:
        service = build('sheets', 'v4', credentials=creds)
        
        # Get all check-ins from Check-ins sheet
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range='Check-ins!A:E'
        ).execute()
        
        values = result.get('values', [])
        
        # Skip header row and count locations and devices
        location_counter = Counter()
        device_checkins = {}  # device_id -> {count, most_recent_name, timestamp}
        
        for row in values[1:]:  # Skip header
            if len(row) >= 5:
                timestamp = row[0]  # Column A: Timestamp
                device_id = row[1]  # Column B: Device ID
                name = row[2]  # Column C: Name
                location = row[4].upper()  # Column E: Location (uppercase)
                
                location_counter[location] += 1
                
                # Track device check-ins with most recent name
                if device_id not in device_checkins:
                    device_checkins[device_id] = {'count': 0, 'most_recent_name': name, 'timestamp': timestamp}
                
                device_checkins[device_id]['count'] += 1
                
                # Update to most recent name based on timestamp
                if timestamp > device_checkins[device_id]['timestamp']:
                    device_checkins[device_id]['most_recent_name'] = name
                    device_checkins[device_id]['timestamp'] = timestamp
        
        # Format results as sorted lists
        location_stats = [
            {'location': loc, 'visits': count}
            for loc, count in location_counter.most_common()
        ]
        
        # Sort devices by check-in count and use most recent name
        user_stats = [
            {'name': data['most_recent_name'], 'checkins': data['count']}
            for device_id, data in sorted(device_checkins.items(), key=lambda x: x[1]['count'], reverse=True)
        ]
        
        return jsonify({
            'location_stats': location_stats,
            'user_stats': user_stats
        })
        
    except Exception as e:
        print(f"Error getting admin stats: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/user/<name>')
def user_devices(name):
    """Get user info - redirects to Google Sheets"""
    return jsonify({
        'message': f'Please use Google Sheets to view data for {name}',
        'spreadsheet_id': SPREADSHEET_ID,
        'sheets_url': f'https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}'
    })

@app.route('/health')
def health():
    return jsonify({
        'status': 'healthy',
        'mode': 'google',
        'timestamp': datetime.now().isoformat()
    })

if __name__ == '__main__':
    print("🚀 NFC Check-In System Starting...")
    print(f"📊 Mode: GOOGLE SHEETS")
    
    # Get port from environment variable for cloud deployment
    port = int(os.environ.get('PORT', 5002))
    
    if os.environ.get('RAILWAY_PUBLIC_DOMAIN') or os.environ.get('RENDER_EXTERNAL_HOSTNAME'):
        # Cloud deployment
        print(f"☁️ Cloud deployment detected")
        print(f"🌐 Server running on port {port}")
        app.run(host='0.0.0.0', port=port, debug=False)
    else:
        # Local development
        print(f"🌐 Server running on http://localhost:{port}")
        app.run(host='0.0.0.0', port=port, debug=True)