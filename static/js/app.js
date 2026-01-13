console.log('Script loaded successfully');
let deviceFingerprint = null;

// Generate device fingerprint (more consistent)
function generateDeviceFingerprint() {
    console.log('Generating new device fingerprint...');
    // Use more stable device characteristics
    const fingerprint = {
        screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
        platform: navigator.platform,
        userAgent: navigator.userAgent.substring(0, 200),
        pixelRatio: window.devicePixelRatio,
        cookieEnabled: navigator.cookieEnabled,
        onLine: navigator.onLine,
        randomSeed: Math.random().toString(36).substring(2, 15)
    };
    
    const fingerprintString = JSON.stringify(fingerprint);
    return btoa(fingerprintString).substring(0, 20);
}

// Get or create persistent device fingerprint
function getPersistentDeviceId() {
    console.log('Getting persistent device ID...');
    
    let storedDeviceId = localStorage.getItem('nfc_device_id');
    
    if (storedDeviceId) {
        console.log('Found existing device ID in storage:', storedDeviceId);
        return storedDeviceId;
    }
    
    console.log('No stored device ID found, generating new one...');
    const newDeviceId = generateDeviceFingerprint();
    
    try {
        localStorage.setItem('nfc_device_id', newDeviceId);
        console.log('Device ID saved to localStorage:', newDeviceId);
    } catch (e) {
        console.warn('Could not save to localStorage:', e);
    }
    
    return newDeviceId;
}

// Initialize device fingerprint
console.log('Initializing device fingerprint...');
deviceFingerprint = getPersistentDeviceId();
console.log('Final device fingerprint:', deviceFingerprint);

// Get location from URL parameter
const urlParams = new URLSearchParams(window.location.search);
const currentLocation = urlParams.get('location') || 'Unknown Location';
let userGPSCoords = null;
let validLocations = [];

// Fetch valid locations from backend
async function fetchValidLocations() {
    try {
        const response = await fetch('/api/locations');
        const data = await response.json();
        if (data.success) {
            validLocations = data.locations;
            console.log('Valid locations:', validLocations);
            return validLocations;
        }
    } catch (error) {
        console.error('Error fetching locations:', error);
    }
    return [];
}

// Request GPS location permission
function requestGPSLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject('Geolocation not supported by browser');
            return;
        }
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userGPSCoords = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy
                };
                console.log('GPS location obtained:', userGPSCoords);
                resolve(userGPSCoords);
            },
            (error) => {
                console.error('GPS error:', error);
                reject(`GPS error: ${error.message}`);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}

// Show device info
document.getElementById('deviceInfo').innerHTML = `
    Device ID: ${deviceFingerprint}<br>
    Location: ${currentLocation.toUpperCase()}<br>
    <small style="color: #999;">
        Device ID is stored in browser and persists across sessions.
    </small>
`;
document.getElementById('deviceInfo').classList.remove('hidden');

// Auto-check device and perform action
console.log('About to start autoCheckIn...');
autoCheckIn();

async function autoCheckIn() {
    try {
        console.log('Starting auto check-in...');
        
        // Fetch valid locations first
        await fetchValidLocations();
        
        // Check if location is provided
        if (!currentLocation || currentLocation === 'Unknown Location') {
            document.getElementById('autoCheckin').style.display = 'none';
            showStatus('⚠️ Location required! Please scan QR code with location parameter', 'error');
            return;
        }
        
        // Validate location is registered (case-insensitive)
        const matchedLocation = validLocations.find(loc => loc.toLowerCase() === currentLocation.toLowerCase());
        if (!matchedLocation) {
            document.getElementById('autoCheckin').style.display = 'none';
            showStatus(`🚫 Invalid location "${currentLocation}". Location not registered in system.`, 'error');
            return;
        }
                // Request GPS permission and verify location
        document.getElementById('autoCheckin').innerHTML = '<div class="loading">📍 Getting your location...</div>';
        
        try {
            await requestGPSLocation();
            
            // Verify location with backend
            const verifyResponse = await fetch('/api/verify-location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    latitude: userGPSCoords.latitude,
                    longitude: userGPSCoords.longitude,
                    location: currentLocation
                })
            });
            
            const verifyData = await verifyResponse.json();
            
            if (!verifyData.verified) {
                document.getElementById('autoCheckin').style.display = 'none';
                showStatus('🚫 ' + verifyData.message, 'error');
                return;
            }
            
            console.log('Location verified:', verifyData.message);
            document.getElementById('autoCheckin').innerHTML = '<div class="loading">🔄 Checking in...</div>';
            
        } catch (gpsError) {
            document.getElementById('autoCheckin').style.display = 'none';
            showStatus('📍 GPS location required! Please enable location services.', 'error');
            return;
        }
                const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch('/api/device/' + deviceFingerprint, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const data = await response.json();
        console.log('Device check result:', data);
        
        if (data.registered && data.name) {
            console.log('Device registered, performing check-in for:', data.name);
            await performCheckIn(data.name);
        } else {
            console.log('New device detected');
            document.getElementById('autoCheckin').style.display = 'none';
            document.getElementById('nameGroup').style.display = 'block';
            showStatus('New device detected - please register', 'error');
        }
    } catch (err) {
        console.error('Error in auto check-in:', err);
        document.getElementById('autoCheckin').style.display = 'none';
        document.getElementById('nameGroup').style.display = 'block';
        
        if (err.name === 'AbortError') {
            showStatus('Connection timeout - please try again', 'error');
        } else {
            showStatus('Device check failed - please register', 'error');
        }
    }
}

async function performCheckIn(name) {
    try {
        console.log('Performing check-in for:', name);
        
        if (!userGPSCoords) {
            showStatus('GPS location required', 'error');
            return;
        }
        
        const data = {
            device_id: deviceFingerprint,
            name: name,
            event: 'checkin',
            location: currentLocation,
            timestamp: new Date().toISOString(),
            latitude: userGPSCoords.latitude,
            longitude: userGPSCoords.longitude
        };
        
        console.log('Sending check-in data:', data);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch('/api/checkin', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const result = await response.json();
        console.log('Check-in result:', result);
        
        if (result.success) {
            document.getElementById('autoCheckin').innerHTML = `
                <div class="loading">
                    ✅ Checked in at ${currentLocation.toUpperCase()}<br>
                </div>
            `;
        } else {
            showStatus('Check-in failed: ' + (result.error || 'Unknown error'), 'error');
            document.getElementById('autoCheckin').style.display = 'none';
        }
    } catch (error) {
        console.error('Check-in error:', error);
        if (error.name === 'AbortError') {
            showStatus('Check-in timeout - please try again', 'error');
        } else {
            showStatus('Network error during check-in', 'error');
        }
        document.getElementById('autoCheckin').style.display = 'none';
    }
}

async function registerAndCheckin() {
    const nameInput = document.getElementById('name');
    const name = nameInput.value.trim();
    
    if (!name) {
        showStatus('Please enter your name', 'error');
        nameInput.focus();
        return;
    }
    
    document.getElementById('registerBtn').disabled = true;
    document.getElementById('registerBtn').innerHTML = 'Getting location...';
    
    // Request GPS location if not already obtained
    if (!userGPSCoords) {
        try {
            await requestGPSLocation();
            
            // Verify location
            const verifyResponse = await fetch('/api/verify-location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    latitude: userGPSCoords.latitude,
                    longitude: userGPSCoords.longitude,
                    location: currentLocation
                })
            });
            
            const verifyData = await verifyResponse.json();
            
            if (!verifyData.verified) {
                showStatus('🚫 ' + verifyData.message, 'error');
                document.getElementById('registerBtn').disabled = false;
                document.getElementById('registerBtn').innerHTML = 'Register & Check In';
                return;
            }
        } catch (gpsError) {
            showStatus('📍 GPS location required! Please enable location services.', 'error');
            document.getElementById('registerBtn').disabled = false;
            document.getElementById('registerBtn').innerHTML = 'Register & Check In';
            return;
        }
    }
    
    document.getElementById('registerBtn').innerHTML = 'Registering...';
    await performCheckIn(name);
    
    document.getElementById('nameGroup').style.display = 'none';
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.classList.remove('hidden');
    console.log(`Status [${type}]:`, message);
    
    setTimeout(() => {
        statusDiv.classList.add('hidden');
    }, 5000);
}

// Show name update form
function showNameUpdate(currentName) {
    document.getElementById('autoCheckin').style.display = 'none';
    document.getElementById('updateNameGroup').style.display = 'block';
    document.getElementById('newName').value = currentName;
    document.getElementById('newName').focus();
}

// Cancel name update
function cancelNameUpdate() {
    document.getElementById('updateNameGroup').style.display = 'none';
    document.getElementById('autoCheckin').style.display = 'block';
    document.getElementById('passphrase').value = '';
}

// Update name function
async function updateName() {
    const newNameInput = document.getElementById('newName');
    const passphraseInput = document.getElementById('passphrase');
    const newName = newNameInput.value.trim();
    const passphrase = passphraseInput.value.trim();
    
    if (!newName) {
        showStatus('Please enter a name', 'error');
        newNameInput.focus();
        return;
    }
    
    if (!passphrase) {
        showStatus('Please enter passphrase', 'error');
        passphraseInput.focus();
        return;
    }
    
    document.getElementById('updateBtn').disabled = true;
    document.getElementById('updateBtn').innerHTML = 'Updating...';
    
    try {
        const response = await fetch('/api/device/' + deviceFingerprint + '/update-name', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                new_name: newName,
                passphrase: passphrase
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showStatus(`Name updated to: ${newName}`, 'success');
            document.getElementById('updateNameGroup').style.display = 'none';
            document.getElementById('passphrase').value = '';
            
            document.getElementById('autoCheckin').innerHTML = `
                <div class="loading">
                    ✅ Welcome ${newName}!<br>
                    ${currentLocation.toUpperCase()}
                </div>
            `;
            document.getElementById('autoCheckin').style.display = 'block';
        } else {
            showStatus('Failed to update name: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Name update error:', error);
        showStatus('Network error during name update', 'error');
    }
    
    document.getElementById('updateBtn').disabled = false;
    document.getElementById('updateBtn').innerHTML = '✅ Update';
}

// Handle Enter key in name input
document.getElementById('name').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        registerAndCheckin();
    }
});

// Handle Enter key in name update input
document.getElementById('newName').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        updateName();
    }
});