# NFC Check-In System

A Flask-based NFC check-in system with device fingerprinting and Google Sheets integration.

## Features

- **Device Fingerprinting**: Automatically recognizes devices using canvas fingerprinting and browser characteristics
- **Dual Mode Operation**: 
  - Local mode with JSON file storage for development/testing
  - Google Sheets integration for production data storage
- **Responsive Web Interface**: Clean, modern UI that works on all devices
- **Real-time Check-in/Check-out**: Instant feedback and status updates
- **Automatic Device Registration**: First-time users are automatically registered

## Setup

### Prerequisites

- Python 3.9+
- Google Cloud Project (for Sheets integration)
- Google OAuth2 credentials

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/yourusername/nfc-check-in.git
cd nfc-check-in
```

2. Create a virtual environment:
```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. For Google Sheets integration:
   - Create a Google Cloud Project
   - Enable the Google Sheets API and Google Calendar API
   - Create OAuth2 credentials and download as `credentials.json`
   - Set `LOCAL_MODE=False` in environment or app.py

5. Run the application:
```bash
python app.py
```

6. Open your browser to `http://localhost:5002`

### Environment Variables

- `LOCAL_MODE`: Set to "True" for local JSON storage, "False" for Google Sheets
- `SPREADSHEET_ID`: Google Sheets ID (will auto-create if not provided)

### Deployment

#### Railway
1. Connect your GitHub repository to Railway
2. Set environment variables in Railway dashboard
3. Upload `credentials.json` as a Railway secret

#### Google Cloud App Engine
```bash
gcloud app deploy
```

#### Heroku
```bash
heroku create your-app-name
heroku config:set LOCAL_MODE=False
# Upload credentials.json via Heroku CLI or dashboard
git push heroku main
```

## API Endpoints

- `GET /` - Main check-in interface
- `POST /api/checkin` - Submit check-in/check-out
- `GET /api/device/{device_id}` - Check device registration
- `GET /api/data` - Get all check-in data (local mode only)
- `GET /health` - Health check endpoint

## Security

- Device fingerprinting uses non-invasive browser characteristics
- Google OAuth2 for secure API access
- Credentials and tokens excluded from version control
- HTTPS recommended for production deployment

## License

MIT License