export const ui = {
    renderStats(results, thresholds) {
        // thresholds가 정의되지 않았을 경우를 대비한 기본값 설정
        const safeThresholds = thresholds || { normal: 2000, slow: 5000 };
        
        const total = results.length;
        const online = results.filter(r => r.online && r.responseTime < safeThresholds.slow).length;
        const slow = results.filter(r => r.online && r.responseTime >= safeThresholds.slow).length;
        const offline = results.filter(r => !r.online && r.status !== 'pending').length;

        document.querySelector('#stat-total .value').textContent = total;
        document.querySelector('#stat-online .value').textContent = online;
        document.querySelector('#stat-slow .value').textContent = slow;
        document.querySelector('#stat-offline .value').textContent = offline;
    },

    renderSiteGrid(sites, results, thresholds, siteLogsMap = {}) {
        const grid = document.getElementById('site-grid');
        grid.innerHTML = '';

        if (sites.length === 0) {
            grid.innerHTML = `
                <div class="loading-state">
                    <p>등록된 사이트가 없습니다. 로그인을 하거나 사이트를 추가해주세요.</p>
                </div>
            `;
            return;
        }

        sites.forEach(site => {
            const result = results.find(r => r.id === site.id) || { online: false, status: 'pending' };
            const card = this.createSiteCard(site, result, thresholds, siteLogsMap[site.id] || null);
            grid.appendChild(card);
        });
    },

    createSiteCard(site, result, thresholds, recentLogs = null) {
        // thresholds가 정의되지 않았을 경우를 대비한 기본값 설정
        const safeThresholds = thresholds || { normal: 2000, slow: 5000 };
        
        const card = document.createElement('div');
        card.className = 'site-card';
        card.dataset.id = site.id;

        let statusClass = 'status-offline';
        let statusText = 'OFFLINE';

        if (result.online) {
            if (result.responseTime >= safeThresholds.slow) {
                statusClass = 'status-slow';
                statusText = 'SLOW';
            } else {
                statusClass = 'status-online';
                statusText = 'ONLINE';
            }
        } else if (result.status === 'pending') {
            statusText = 'PENDING';
            statusClass = 'status-outline';
        }

        const resultsList = (result.checkResults || []);
        
        // 텍스트(WEB)와 API 결과 분류
        const textChecks = resultsList.filter(c => c.type === 'text');
        const apiChecks = resultsList.filter(c => c.type === 'api');

        const renderCheckItem = (check) => {
            const isApi = check.type === 'api';
            const statusType = check.status === 'pending' ? 'pending' : (check.exists ? 'success' : 'danger');
            const statusLabel = statusType === 'pending' ? '체크 중' : (statusType === 'success' ? '정상' : '에러');
            
            let iconClass = '';
            if (statusType === 'pending') iconClass = 'ri-loader-4-line spin';
            else if (isApi) iconClass = statusType === 'success' ? 'ri-plug-fill' : 'ri-plug-line';
            else iconClass = statusType === 'success' ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill';

            return `
                <div class="check-item-container ${isApi ? 'api-item' : 'text-item'}">
                    <div class="check-item-header">
                        <span class="check-name">
                            <i class="${isApi ? 'ri-terminal-box-line' : 'ri-file-list-3-line'}"></i>
                            ${check.name}
                        </span>
                        <span class="check-status-pill status-${statusType}">
                            <i class="${iconClass}"></i> ${statusLabel}
                        </span>
                    </div>
                    <div class="check-item-details">
                        ${isApi ? 
                            `<span class="detail-tag api-tag"><i class="ri-link"></i> API 주소 접속 상태</span>` :
                            `<span class="detail-tag text-tag"><i class="ri-key-2-line"></i> "${check.keyword}" 키워드 체크</span>`
                        }
                        ${check.status && check.status !== 'pending' ? `<span class="status-code">HTTP ${check.status}</span>` : ''}
                    </div>
                </div>
            `;
        };

        // 텍스트(WEB) 섹션 구성
        const textSectionHtml = `
            <div class="check-section text-section">
                <div class="group-title"><i class="ri-global-line"></i> WEB 페이지</div>
                ${textChecks.length > 0 ? 
                    textChecks.map(renderCheckItem).join('') : 
                    `<div class="empty-mini"><i class="ri-ghost-line"></i> 미설정</div>`
                }
            </div>
        `;

        // API 섹션 구성
        const apiSectionHtml = `
            <div class="check-section api-section">
                <div class="group-title"><i class="ri-api-line"></i> API 접속</div>
                ${apiChecks.length > 0 ? 
                    apiChecks.map(renderCheckItem).join('') : 
                    `<div class="empty-mini"><i class="ri-ghost-line"></i> 미설정</div>`
                }
            </div>
        `;

        const timeStr = result.lastChecked ? new Date(result.lastChecked).toLocaleTimeString() : '--:--:--';

        // 미니 그래프: 서버 로그 기반 "최근 1시간" 고정 창 (5분 단위 12칸)
        // 로그가 없으면(비로그인 등) 기존 히스토리 방식으로 폴백
        const fmtShortTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const buildBar = (online, value, title) => {
            let barClass = 'bar-empty';
            let height = '4px';
            if (online !== null) {
                if (!online) {
                    barClass = 'bar-error';
                    height = '100%';
                } else {
                    if (value < safeThresholds.normal) barClass = 'bar-normal';
                    else if (value < safeThresholds.slow) barClass = 'bar-warning';
                    else barClass = 'bar-danger';
                    // 최대 slow 기준(기본 5000ms)으로 높이 계산 (최소 15% ~ 최대 100%)
                    height = `${Math.min(Math.max((value / safeThresholds.slow) * 100, 15), 100)}%`;
                }
            }
            return `<div class="spark-bar ${barClass}" style="height: ${height}" title="${title}"></div>`;
        };

        let sparklineHtml = '';
        let timeRangeHtml = '';
        let trendLabel = '';

        if (recentLogs && recentLogs.length > 0) {
            // 최근 1시간을 5분 슬롯 12개로 나누고, 각 슬롯에 해당 시간대의 체크 결과 배치
            const WINDOW_MS = 60 * 60 * 1000;
            const SLOTS = 12;
            const slotMs = WINDOW_MS / SLOTS;
            const windowStart = Date.now() - WINDOW_MS;

            const buckets = new Array(SLOTS).fill(null);
            recentLogs.forEach(log => {
                const t = new Date(log.checked_at).getTime();
                const idx = Math.floor((t - windowStart) / slotMs);
                if (idx >= 0 && idx < SLOTS) buckets[idx] = log; // 같은 슬롯에 여러 건이면 최신 것
            });

            sparklineHtml = buckets.map(log => {
                if (!log) return buildBar(null, 0, '체크 없음');
                const title = `${fmtShortTime(log.checked_at)} · ${log.online ? log.response_time + 'ms' : '다운'}`;
                return buildBar(log.online, log.response_time, title);
            }).join('');

            trendLabel = '최근 1시간';
            timeRangeHtml = `
                <div class="sparkline-times">
                    <span>${fmtShortTime(windowStart)}</span>
                    <span>${fmtShortTime(windowStart + WINDOW_MS / 2)}</span>
                    <span>${fmtShortTime(Date.now())}</span>
                </div>
            `;
        } else {
            // 폴백: 로컬 히스토리 최근 15회
            const history = site.history || [];
            const maxHistory = 15;
            for (let i = 0; i < maxHistory; i++) {
                const data = history[i] || null;
                if (!data) {
                    sparklineHtml += buildBar(null, 0, 'No data');
                } else {
                    const barTime = data.time ? new Date(data.time).toLocaleTimeString() : '';
                    const barValue = data.online ? `${data.value}ms` : 'Error';
                    sparklineHtml += buildBar(data.online, data.value, barTime ? `${barTime} · ${barValue}` : barValue);
                }
            }

            const oldestEntry = history.find(h => h && h.time);
            const newestEntry = [...history].reverse().find(h => h && h.time);
            trendLabel = `최근 ${history.length}회`;
            timeRangeHtml = (oldestEntry && newestEntry) ? `
                <div class="sparkline-times">
                    <span>${fmtShortTime(oldestEntry.time)}</span>
                    <span>~</span>
                    <span>${fmtShortTime(newestEntry.time)}</span>
                </div>
            ` : '';
        }

        const currentResponseTime = result.responseTime ? `${result.responseTime}ms` : (result.status === 'pending' ? '...' : 'OFFLINE');
        const previewHtml = `
            <div class="sparkline-container">
                <div class="sparkline-header">
                    <span class="sparkline-title">RESPONSE TREND${trendLabel ? ` <em class="trend-label">· ${trendLabel}</em>` : ''}</span>
                    <span class="sparkline-value">${currentResponseTime}</span>
                </div>
                <div class="sparkline-bars">
                    ${sparklineHtml}
                </div>
                ${timeRangeHtml}
            </div>
        `;

        card.innerHTML = `
            <div class="site-actions">
                <button class="action-btn drag-handle" title="순서 변경"><i class="ri-drag-move-fill"></i></button>
                <button class="action-btn logs-btn" title="로그 보기"><i class="ri-bar-chart-2-line"></i></button>
                <button class="action-btn check-btn" title="체크"><i class="ri-refresh-line"></i></button>
                <button class="action-btn edit-btn" title="수정"><i class="ri-edit-line"></i></button>
                <button class="action-btn delete-btn" title="삭제"><i class="ri-delete-bin-line"></i></button>
            </div>
            <div class="site-preview history-mode">
                <div class="browser-dots"><span></span><span></span><span></span></div>
                ${previewHtml}
            </div>
            <div class="site-info">
                <div class="title-row">
                    <h3>${site.name}</h3>
                </div>
                <a href="${site.url}" target="_blank" class="site-url">${site.url}</a>
                
                <div class="site-metrics">
                    <div class="metric status-${statusClass}">
                        <i class="ri-pulse-line"></i> ${statusText}
                    </div>
                    ${result.responseTime ? `
                        <div class="metric">
                            <i class="ri-timer-line"></i> ${result.responseTime}ms
                        </div>
                    ` : ''}
                    <div class="metric">
                        <i class="ri-time-line"></i> ${timeStr}
                    </div>
                </div>
            </div>

            <div class="check-results">
                <div class="check-sections-wrapper">
                    ${textSectionHtml}
                    ${apiSectionHtml}
                </div>
            </div>
        `;

        return card;
    },

    showModal(site = null, modalId = 'modal-site') {
        const modal = document.getElementById(modalId);
        if (modalId === 'modal-site') {
            const title = document.getElementById('modal-title');
            const form = document.getElementById('site-form');
            const webList = document.getElementById('web-checks-list');
            const apiList = document.getElementById('api-checks-list');

            title.textContent = site ? '사이트 수정' : '사이트 추가';
            form.reset();
            if (webList) webList.innerHTML = '';
            if (apiList) apiList.innerHTML = '';
            document.getElementById('site-id').value = site ? site.id : '';

            if (site) {
                document.getElementById('site-name').value = site.name;
                document.getElementById('site-url').value = site.url;
                (site.checks || []).forEach(check => {
                    if (check.type === 'api') this.addApiCheckRow(check);
                    else this.addWebCheckRow(check);
                });
            } else {
                // 추가 모드일 때 기본 웹페이지 행 하나 추가
                this.addWebCheckRow();
            }
        }
        modal.classList.add('active');
    },

    hideModal(modalId = 'modal-site') {
        document.getElementById(modalId).classList.remove('active');
    },

    // 로그 모달 열기 (로딩 상태)
    showLogsModal(site) {
        document.getElementById('logs-title').textContent = `${site.name} 체크 로그`;
        document.getElementById('logs-body').innerHTML = `
            <div class="logs-empty"><div class="spinner"></div><p>로그를 불러오는 중...</p></div>
        `;
        document.getElementById('modal-logs').classList.add('active');
    },

    // 로그 데이터 렌더링 (통계 + 그래프 + 테이블)
    renderLogs(logs, hours, thresholds) {
        const body = document.getElementById('logs-body');
        const safeThresholds = thresholds || { normal: 2000, slow: 5000 };

        if (!logs || logs.length === 0) {
            body.innerHTML = `<div class="logs-empty"><i class="ri-ghost-line"></i><p>이 기간의 로그가 없습니다.<br>서버가 5분마다 체크하며 로그를 쌓습니다.</p></div>`;
            return;
        }

        // API는 최신순으로 내려주므로 그래프용은 시간순으로 뒤집기
        const asc = [...logs].reverse();

        // 통계 계산
        const total = logs.length;
        const onlineCount = logs.filter(l => l.online).length;
        const uptime = ((onlineCount / total) * 100).toFixed(1);
        const onlineTimes = logs.filter(l => l.online).map(l => l.response_time);
        const avg = onlineTimes.length ? Math.round(onlineTimes.reduce((a, b) => a + b, 0) / onlineTimes.length) : 0;
        const max = onlineTimes.length ? Math.max(...onlineTimes) : 0;

        // 응답 속도 그래프 (SVG)
        const W = 640, H = 150, PAD = 6;
        const n = asc.length;
        const maxVal = Math.max(...asc.map(l => l.online ? l.response_time : 0), safeThresholds.normal);
        const xPos = i => n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2);
        const yPos = v => H - PAD - (Math.min(v, maxVal) / maxVal) * (H - PAD * 2);

        const points = asc.map((l, i) => `${xPos(i).toFixed(1)},${yPos(l.online ? l.response_time : 0).toFixed(1)}`).join(' ');
        const areaPath = `M ${xPos(0).toFixed(1)},${H - PAD} L ${points.split(' ').join(' L ')} L ${xPos(n - 1).toFixed(1)},${H - PAD} Z`;
        const offlineMarks = asc.map((l, i) => !l.online
            ? `<line x1="${xPos(i).toFixed(1)}" y1="${PAD}" x2="${xPos(i).toFixed(1)}" y2="${H - PAD}" class="log-offline-line"></line>`
            : '').join('');
        const slowLine = safeThresholds.slow <= maxVal
            ? `<line x1="${PAD}" y1="${yPos(safeThresholds.slow).toFixed(1)}" x2="${W - PAD}" y2="${yPos(safeThresholds.slow).toFixed(1)}" class="log-slow-line"></line>`
            : '';

        const fmtRange = ts => new Date(ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        // 체크 이력 테이블 (최신순, 최대 100건)
        const rows = logs.slice(0, 100).map(l => {
            let pill, pillClass;
            if (!l.online) { pill = '다운'; pillClass = 'danger'; }
            else if (l.response_time >= safeThresholds.slow) { pill = '느림'; pillClass = 'warning'; }
            else { pill = '정상'; pillClass = 'success'; }
            return `
                <tr>
                    <td>${new Date(l.checked_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                    <td class="num">${l.online ? l.response_time + 'ms' : '-'}</td>
                    <td class="num">${l.status_code ?? '-'}</td>
                    <td><span class="log-pill ${pillClass}">${pill}</span></td>
                </tr>
            `;
        }).join('');

        body.innerHTML = `
            <div class="log-stats">
                <div class="log-stat">
                    <span class="value ${uptime >= 99 ? 'color-success' : (uptime >= 95 ? 'color-warning' : 'color-danger')}">${uptime}%</span>
                    <span class="label">업타임 (${total}회 체크)</span>
                </div>
                <div class="log-stat">
                    <span class="value">${avg}ms</span>
                    <span class="label">평균 응답</span>
                </div>
                <div class="log-stat">
                    <span class="value">${max}ms</span>
                    <span class="label">최대 응답</span>
                </div>
            </div>

            <svg viewBox="0 0 ${W} ${H}" class="log-chart" preserveAspectRatio="none">
                ${slowLine}
                <path d="${areaPath}" class="log-area"></path>
                <polyline points="${points}" class="log-line"></polyline>
                ${offlineMarks}
            </svg>
            <div class="sparkline-times log-chart-times">
                <span>${fmtRange(asc[0].checked_at)}</span>
                <span>${fmtRange(asc[n - 1].checked_at)}</span>
            </div>

            <div class="logs-table-wrap">
                <table class="logs-table">
                    <thead>
                        <tr><th>체크 시각</th><th class="num">응답</th><th class="num">HTTP</th><th>상태</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${logs.length > 100 ? `<p class="logs-more-hint">최근 100건만 표시 (그래프·통계는 전체 ${total}건 기준)</p>` : ''}
        `;
    },

    // WEB 페이지 체크 행 추가
    addWebCheckRow(check = { name: '', url: '', keyword: '' }) {
        const container = document.getElementById('web-checks-list');
        const row = document.createElement('div');
        row.className = 'check-page-row web-mode-row';
        row.dataset.id = check.id || '';
        
        row.innerHTML = `
            <div class="check-inputs-container">
                <div class="check-header-row">
                    <span class="mode-label web"><i class="ri-global-line"></i> WEB 페이지</span>
                    <button type="button" class="remove-check-btn"><i class="ri-delete-bin-line"></i></button>
                </div>
                <div class="check-fields text-mode">
                    <input type="text" placeholder="페이지명 (예: 로그인)" class="check-name" value="${check.name || ''}" required>
                    <input type="url" placeholder="URL (HTTPS)" class="check-url" value="${check.url || ''}" required>
                    <input type="text" placeholder="찾을 키워드" class="check-keyword full-width" value="${check.keyword || ''}" required>
                    <input type="hidden" class="check-type" value="text">
                </div>
            </div>
        `;
        container.appendChild(row);
        row.querySelector('.remove-check-btn').onclick = () => row.remove();
    },

    // API 접속 체크 행 추가
    addApiCheckRow(check = { url: '' }) {
        const container = document.getElementById('api-checks-list');
        const row = document.createElement('div');
        row.className = 'check-page-row api-mode-row';
        row.dataset.id = check.id || '';
        
        row.innerHTML = `
            <div class="check-inputs-container">
                <div class="check-header-row">
                    <span class="mode-label api"><i class="ri-api-line"></i> API 접속</span>
                    <button type="button" class="remove-check-btn"><i class="ri-delete-bin-line"></i></button>
                </div>
                <div class="check-fields api-mode">
                    <div class="field-label">API 주소 (HTTP 200 체크)</div>
                    <input type="url" placeholder="https://api.example.com/data" class="check-url full-width" value="${check.url || ''}" required>
                    <input type="hidden" class="check-type" value="api">
                    <input type="hidden" class="check-name" value="API Check">
                    <input type="hidden" class="check-keyword" value="OK_STATUS_CHECK">
                </div>
            </div>
        `;
        container.appendChild(row);
        row.querySelector('.remove-check-btn').onclick = () => row.remove();
    }
};
