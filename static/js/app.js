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

// Show device info
document.getElementById('deviceInfo').innerHTML = `
    Device ID: ${deviceFingerprint}<br>
    Location: ${currentLocation}<br>
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
        
        const data = {
            device_id: deviceFingerprint,
            name: name,
            event: 'checkin',
            location: currentLocation,
            timestamp: new Date().toISOString()
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
                <div class="auto-success">
                    ✅ Welcome ${name}!<br>
                    Checked in at ${currentLocation}<br>
                    ${new Date().toLocaleTimeString()}<br><br>
                    <button class="btn" style="background: #6c757d; color: white; padding: 8px 16px; margin-top: 10px;" 
                            onclick="showNameUpdate('${name}')">
                        📝 Update Name
                    </button>
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
}

// Update name function
async function updateName() {
    const newNameInput = document.getElementById('newName');
    const newName = newNameInput.value.trim();
    
    if (!newName) {
        showStatus('Please enter a name', 'error');
        newNameInput.focus();
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
                new_name: newName
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showStatus(`Name updated to: ${newName}`, 'success');
            document.getElementById('updateNameGroup').style.display = 'none';
            
            document.getElementById('autoCheckin').innerHTML = `
                <div class="auto-success">
                    ✅ Welcome ${newName}! (Name Updated)<br>
                    Checked in at ${currentLocation}<br>
                    ${new Date().toLocaleTimeString()}<br><br>
                    <button class="btn" style="background: #6c757d; color: white; padding: 8px 16px; margin-top: 10px;" 
                            onclick="showNameUpdate('${newName}')">
                        📝 Update Name
                    </button>
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