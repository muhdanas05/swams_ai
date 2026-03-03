async function fetchCases() {
    try {
        const response = await fetch('/api/cases');
        const data = await response.json();
        updateDashboard(data.cases, data.errorCount || 0);
    } catch (error) {
        console.error('Error fetching cases:', error);
    }
}

function updateDashboard(cases, errorCount) {
    // Stats elements
    const totalCasesEl = document.getElementById('total-cases');
    const pendingCountEl = document.getElementById('pending-count');
    const speedToLeadEl = document.getElementById('speed-to-lead');
    const errorCountEl = document.getElementById('error-logs-count') || { innerText: '' };
    const approvalRateEl = document.getElementById('approval-rate');
    const approvalCountsEl = document.getElementById('approval-counts');
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
    let actionApproved = 0;
    let actionRejected = 0;

    const now = new Date();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;

    cases.forEach(c => {
        if (c.status === 'pending') pending++;
        if (c.status === 'approved') approved++;
        if (c.status === 'rejected') rejected++;

        totalConfidence += c.confidence_score || 0;

        // Speed to lead (active/completed case saves 55 mins)
        if (c.status === 'approved' || c.status === 'completed') {
            totalSpeed += 55;
            approvedWithTime++;

            // Check action column mapping from server
            if (c.action_taken) {
                const act = c.action_taken.trim().toLowerCase();
                if (act === 'approved' || act === 'approve') actionApproved++;
                if (act === 'rejected' || act === 'reject') actionRejected++;
            }
        }

        // SOL Risk (< 90 days)
        if (c.sol_date) {
            const solDate = new Date(c.sol_date);
            if (solDate - now < ninetyDays && solDate > now) {
                solRisk++;
            }
        }

        // Determine Action Button
        let actionColumn = '';
        if (c.status === 'pending') {
            if (c.form_link) {
                actionColumn = `<a href="${c.form_link}" class="action-btn verify-btn"><i class="fas fa-share" style="color:var(--pending); margin-right:4px;"></i> Open</a>`;
            } else {
                actionColumn = `<span class="action-btn" style="color:var(--text-gray); border:none; padding:4px;">No form link</span>`;
            }
        } else {
            actionColumn = `<span class="action-btn" style="color:var(--text-gray); border:none; padding:4px;"><i class="fas fa-check"></i> Done</span>`;
        }

        // Add row to table
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div class="client-info">
                    <div class="client-avatar">${(c.client_plate_number || 'U').charAt(0).toUpperCase()}</div>
                    <div class="client-name">${c.client_plate_number || 'Unknown'}</div>
                </div>
            </td>
            <td style="color: var(--text-gray); font-size: 0.85rem;">#${c.case_id.substring(0, 6)}</td>
            <td class="date-text">${c.accident_date || 'N/A'}</td>
            <td>
                <div style="display:flex; align-items:center; gap:10px;">
                    <div class="confidence-bar"><div class="confidence-fill" style="width: ${c.confidence_score}%;"></div></div>
                    <span style="font-size:0.8rem; color:var(--text-gray);"><span style="color:var(--text-dark); font-weight:600;">${c.confidence_score}%</span></span>
                </div>
            </td>
            <td><span class="badge badge-${c.status}">${c.status.toUpperCase()}</span></td>
            <td>
                ${actionColumn}
            </td>
        `;
        casesBody.appendChild(row);
    });

    // Update stats
    totalCasesEl.innerText = total;
    pendingCountEl.innerText = pending;

    const timeSavedHours = approvedWithTime;
    speedToLeadEl.innerHTML = `${timeSavedHours}h <span style="font-size:0.6rem; color:var(--text-muted);">(est)</span>`;

    if (document.getElementById('error-logs-count')) {
        document.getElementById('error-logs-count').innerText = errorCount;
    }

    // Update Approval Rate
    const totalProcessedActions = actionApproved + actionRejected;
    if (totalProcessedActions > 0) {
        const rate = Math.round((actionApproved / totalProcessedActions) * 100);
        if (approvalRateEl) approvalRateEl.innerText = `${rate}%`;
        if (approvalCountsEl) approvalCountsEl.innerText = `${actionApproved} Approved / ${totalProcessedActions} Total`;
    } else {
        if (approvalRateEl) approvalRateEl.innerText = `0%`;
        if (approvalCountsEl) approvalCountsEl.innerText = `0 Approved / 0 Total`;
    }

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
