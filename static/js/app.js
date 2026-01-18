let deviceFingerprint = null;

// Generate a unique random component for this device
function generateRandomDeviceComponent() {
    // Generate a truly random UUID-like string
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Generate device fingerprint (unique per device, even same model)
function generateDeviceFingerprint() {
    console.log('Generating new device fingerprint...');

    // Get or create a unique random component for this specific device
    let randomComponent = localStorage.getItem('nfc_device_random');
    if (!randomComponent) {
        randomComponent = generateRandomDeviceComponent();
        try {
            localStorage.setItem('nfc_device_random', randomComponent);
            console.log('Generated new random component:', randomComponent);
        } catch (e) {
            console.warn('Could not save random component:', e);
        }
    } else {
        console.log('Using existing random component:', randomComponent);
    }

    // Canvas fingerprinting for additional uniqueness
    let canvasFingerprint = '';
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 200;
        canvas.height = 50;
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.fillText('Device ID', 2, 15);
        canvasFingerprint = canvas.toDataURL().substring(0, 50);
    } catch (e) {
        canvasFingerprint = 'canvas-error';
    }

    // WebGL fingerprinting
    let webglFingerprint = '';
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                webglFingerprint = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
            }
        }
    } catch (e) {
        webglFingerprint = 'webgl-error';
    }

    // Combine random component with device characteristics
    const fingerprint = {
        random: randomComponent, // Unique per device instance
        screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
        availScreen: `${screen.availWidth}x${screen.availHeight}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffset: new Date().getTimezoneOffset(),
        language: navigator.language,
        languages: navigator.languages ? navigator.languages.join(',') : '',
        platform: navigator.platform,
        userAgent: navigator.userAgent.substring(0, 200),
        pixelRatio: window.devicePixelRatio,
        cookieEnabled: navigator.cookieEnabled,
        doNotTrack: navigator.doNotTrack,
        hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
        deviceMemory: navigator.deviceMemory || 'unknown',
        maxTouchPoints: navigator.maxTouchPoints || 0,
        canvas: canvasFingerprint,
        webgl: webglFingerprint,
        vendor: navigator.vendor || '',
        product: navigator.product || '',
        productSub: navigator.productSub || ''
    };

    const fingerprintString = JSON.stringify(fingerprint);
    // Create a hash-like ID from the fingerprint
    let hash = 0;
    for (let i = 0; i < fingerprintString.length; i++) {
        const char = fingerprintString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return 'dev' + Math.abs(hash).toString(36) + btoa(fingerprintString).substring(0, 15);
}

// Get or create persistent device fingerprint
function getPersistentDeviceId() {
    console.log('Getting persistent device ID...');

    let storedDeviceId = localStorage.getItem('nfc_device_id');

    if (storedDeviceId) {
        console.log('Found existing device ID in storage.');
        return storedDeviceId;
    }

    console.log('No stored device ID found, generating new one...');
    const newDeviceId = generateDeviceFingerprint();

    try {
        localStorage.setItem('nfc_device_id', newDeviceId);
        console.log('Device ID saved to localStorage.');
    } catch (e) {
        console.warn('Could not save to localStorage:', e);
    }

    return newDeviceId;
}

// Reset device ID and generate a new one
function resetDeviceId() {
    if (!confirm('Reset your device ID? You will need to register again with your name.')) {
        return;
    }

    console.log('Resetting device ID...');

    // Clear stored device data
    localStorage.removeItem('nfc_device_id');
    localStorage.removeItem('nfc_device_random');

    // Generate new device ID
    deviceFingerprint = generateDeviceFingerprint();

    try {
        localStorage.setItem('nfc_device_id', deviceFingerprint);
        console.log('New device ID generated:', deviceFingerprint);
    } catch (e) {
        console.warn('Could not save new device ID:', e);
    }

    // Reload page to restart registration
    location.reload();
}

// Reset user name (uses update-name endpoint with new name input)
async function resetUserName() {
    const passphrase = prompt('Enter passphrase to reset your name:');
    
    if (!passphrase) {
        return;
    }
    
    const newName = prompt('Enter your new name:');
    
    if (!newName || !newName.trim()) {
        alert('Name is required');
        return;
    }
    
    console.log('Resetting user name...');
    
    try {
        const response = await fetch('/api/device/' + deviceFingerprint + '/update-name', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                new_name: newName.trim(),
                passphrase: passphrase
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`Name updated to: ${newName}`);
            location.reload();
        } else {
            alert('Failed to update name: ' + (result.error || 'Invalid passphrase'));
        }
        
    } catch (error) {
        console.error('Reset name error:', error);
        alert('Network error during name update');
    }
}

// Initialize device fingerprint
console.log('Initializing device fingerprint...');
deviceFingerprint = getPersistentDeviceId();
// console.log('Final device fingerprint:', deviceFingerprint);

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
            // console.log('Valid locations:', validLocations);
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
    <small style="color: #999;">
        Device ID is stored in browser and persists across sessions.<br>
        <a href="#" onclick="resetDeviceId(); return false;" style="color: #666; text-decoration: underline;">Reset Device ID</a>
        <span style="color: #999;"> | </span>
        <a href="#" onclick="resetUserName(); return false;" style="color: #666; text-decoration: underline;">Reset Name</a>
    </small>
`;
document.getElementById('deviceInfo').classList.remove('hidden');

// Auto-check device and perform action
// console.log('About to start autoCheckIn...');
autoCheckIn();

async function autoCheckIn() {
    try {
        // console.log('Starting auto check-in...');

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
            showStatus('📍 Please enable location services.', 'error');
            return;
        }
                const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch('/api/device/' + deviceFingerprint, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await response.json();
        // console.log('Device check result:', data);

        if (data.registered && data.name) {
            console.log('Device registered, performing check-in for:', data.name);
            await performCheckIn(data.name);
        } else {
            console.log('New device detected');
            document.getElementById('autoCheckin').style.display = 'none';
            document.getElementById('nameGroup').style.display = 'block';
            // showStatus('New device detected - please register', 'error');
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
            throw new Error('GPS location required');
        }

        // Format timestamp in Melbourne time (to minutes)
        const melbourneTime = new Date().toLocaleString('en-AU', {
            timeZone: 'Australia/Melbourne',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        const data = {
            device_id: deviceFingerprint,
            name: name,
            event: 'checkin',
            location: currentLocation,
            timestamp: melbourneTime,
            latitude: userGPSCoords.latitude,
            longitude: userGPSCoords.longitude
        };

        // console.log('Sending check-in data:', data);

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
                    🍻 ${name}, 已签到.<br>
                </div>
            `;
            document.getElementById('autoCheckin').style.display = 'block';
        } else if (result.already_checked_in) {
            // Already checked in today
            document.getElementById('autoCheckin').innerHTML = `
                <div class="loading">
                    🫵🏽 ${name}, 明天再来!<br>
                </div>
            `;
            document.getElementById('autoCheckin').style.display = 'block';
        } else {
            throw new Error(result.error || 'Unknown error');
        }
    } catch (error) {
        console.error('Check-in error:', error);
        if (error.name === 'AbortError') {
            throw new Error('Check-in timeout - please try again');
        } else {
            throw error;
        }
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
    document.getElementById('registerBtn').innerHTML = '📍';

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
                document.getElementById('registerBtn').innerHTML = '✅';
                return;
            }
        } catch (gpsError) {
            console.error('GPS error during registration:', gpsError);
            showStatus('📍 Please enable location services.', 'error');
            document.getElementById('registerBtn').disabled = false;
            document.getElementById('registerBtn').innerHTML = '✅';
            return;
        }
    }

    document.getElementById('registerBtn').innerHTML = '⏳';

    try {
        // Perform check-in
        await performCheckIn(name);

        // Hide registration form and show success
        document.getElementById('nameGroup').style.display = 'none';
        document.getElementById('autoCheckin').style.display = 'block';
    } catch (error) {
        console.error('Registration error:', error);
        showStatus('Registration failed: ' + error.message, 'error');
        document.getElementById('registerBtn').disabled = false;
        document.getElementById('registerBtn').innerHTML = '✅';
    }
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.classList.remove('hidden');
    console.log(`Status [${type}]:`, message);

    setTimeout(() => {
        statusDiv.classList.add('hidden');
    }, 5001);
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