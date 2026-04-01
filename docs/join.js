// Extract room ID from URL search param or URL path fallback
const pathParts = window.location.pathname.split('/');
const urlParams = new URLSearchParams(window.location.search);

// Get room from query param (GitHub Pages 404 hack) or from path (e.g. /join/icevox-abc)
const roomId = urlParams.get('room') || pathParts[pathParts.length - 1];

if (roomId && roomId !== 'join' && roomId !== 'join.html') {
    // Update UI with room ID
    document.getElementById('room-id-display').textContent = roomId;

    // Build protocol URL
    const protocolUrl = `icevox://join/${roomId}`;

    // Try to open the app automatically
    setTimeout(() => {
        window.location.href = protocolUrl;
    }, 500);

    // Show "download/manual options" button after 2 seconds (regardless of if app opened)
    setTimeout(() => {
        document.getElementById('join-action-area').style.display = 'block';
    }, 2000);

    // Manual "open" button
    document.getElementById('open-btn').href = protocolUrl;
} else {
    // Invalid URL structure, fallback
    document.getElementById('room-id-display').textContent = 'Unknown Room';
    document.querySelector('.join-spinner').style.display = 'none';
    document.getElementById('join-action-area').style.display = 'block';
}
