async function fetchCases() {
    try {
        const response = await fetch('/api/cases');
        const cases = await response.json();
        updateDashboard(cases);
    } catch (error) {
        console.error('Error fetching cases:', error);
    }
}

function updateDashboard(cases) {
    // Stats elements
    const totalCasesEl = document.getElementById('total-cases');
    const pendingCountEl = document.getElementById('pending-count');
    const approvalRateEl = document.getElementById('approval-rate');
    const rejectedCountEl = document.getElementById('rejected-count');
    const avgConfidenceEl = document.getElementById('avg-confidence');
    const speedToLeadEl = document.getElementById('speed-to-lead');
    const solRiskCountEl = document.getElementById('sol-risk-count');
    const casesBody = document.getElementById('cases-body');

    // Reset table
    casesBody.innerHTML = '';

    // Calculations
    const total = cases.length;
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let totalConfidence = 0;
    let totalSpeed = 0;
    let approvedWithTime = 0;
    let solRisk = 0;

    const now = new Date();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;

    cases.forEach(c => {
        if (c.status === 'pending') pending++;
        if (c.status === 'approved') approved++;
        if (c.status === 'rejected') rejected++;

        totalConfidence += c.confidence_score || 0;

        // Speed to lead (created_at to approved_at)
        if (c.status === 'approved' && c.created_at && c.approved_at) {
            const start = new Date(c.created_at);
            const end = new Date(c.approved_at);
            totalSpeed += (end - start);
            approvedWithTime++;
        }

        // SOL Risk (< 90 days)
        if (c.sol_date) {
            const solDate = new Date(c.sol_date);
            if (solDate - now < ninetyDays && solDate > now) {
                solRisk++;
            }
        }

        // Add row to table
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>#${c.case_id.substring(0, 6)}</td>
            <td><strong>${c.client_plate_number || 'Unknown'}</strong></td>
            <td>${c.accident_date || 'N/A'}</td>
            <td>
                <div style="display:flex; align-items:center; gap:10px;">
                    <progress value="${c.confidence_score}" max="100" style="width: 50px;"></progress>
                    <span>${c.confidence_score}%</span>
                </div>
            </td>
            <td><span class="badge badge-${c.status}">${c.status.toUpperCase()}</span></td>
            <td>${new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
            <td>
                ${c.status === 'pending' ?
                `<a href="/verify.html?id=${c.case_id}" class="badge badge-approved" style="text-decoration:none;">VERIFY</a>` :
                `<button class="badge" disabled>VIEW</button>`
            }
            </td>
        `;
        casesBody.appendChild(row);
    });

    // Update stats
    totalCasesEl.innerText = total;
    pendingCountEl.innerText = pending;
    approvalRateEl.innerText = total > 0 ? Math.round((approved / (total - pending || 1)) * 100) + '%' : '0%';
    rejectedCountEl.innerText = `${rejected} Rejected`;
    avgConfidenceEl.innerText = total > 0 ? Math.round(totalConfidence / total) + '%' : '0%';

    const avgSpeedMinutes = approvedWithTime > 0 ? Math.round((totalSpeed / approvedWithTime) / 60000) : 0;
    speedToLeadEl.innerText = avgSpeedMinutes > 60 ? Math.round(avgSpeedMinutes / 60) + 'h' : avgSpeedMinutes + 'm';

    solRiskCountEl.innerText = solRisk;

    // Pulse effect if pending count > 0
    if (pending > 0) {
        pendingCountEl.parentElement.classList.add('urgent');
    } else {
        pendingCountEl.parentElement.classList.remove('urgent');
    }
}

function refreshDashboard() {
    fetchCases();
}

// Initial fetch
fetchCases();

// Poll every 5 seconds for real-time updates from webhooks
setInterval(fetchCases, 5000);
