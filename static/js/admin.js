// Fetch and display admin statistics
async function fetchStats() {
    try {
        const response = await fetch('/api/admin-stats');
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to load stats');
        }
        
        renderLocationStats(data.location_stats);
        renderUserStats(data.user_stats);
    } catch (err) {
        console.error('Error fetching stats:', err);
        document.getElementById('locationStats').innerHTML = `<div class="error">❌ ${err.message}</div>`;
        document.getElementById('userStats').innerHTML = `<div class="error">❌ ${err.message}</div>`;
    }
}

function renderLocationStats(locationStats) {
    const container = document.getElementById('locationStats');
    
    if (!locationStats || locationStats.length === 0) {
        container.innerHTML = '<div class="loading">No data available</div>';
        return;
    }
    
    let html = '<table class="stats-table"><thead><tr><th>Rank</th><th>Location</th><th>Visits</th></tr></thead><tbody>';
    
    locationStats.forEach((row, index) => {
        html += `
            <tr>
                <td class="rank">#${index + 1}</td>
                <td>${row.location}</td>
                <td class="count">${row.visits}</td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

function renderUserStats(userStats) {
    const container = document.getElementById('userStats');
    
    if (!userStats || userStats.length === 0) {
        container.innerHTML = '<div class="loading">No data available</div>';
        return;
    }
    
    let html = '<table class="stats-table"><thead><tr><th>Rank</th><th>Name</th><th>Check-Ins</th></tr></thead><tbody>';
    
    userStats.forEach((row, index) => {
        html += `
            <tr>
                <td class="rank">#${index + 1}</td>
                <td>${row.name}</td>
                <td class="count">${row.checkins}</td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

// Load stats on page load
fetchStats();
