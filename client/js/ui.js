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

    renderSiteGrid(sites, results, thresholds) {
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
            const card = this.createSiteCard(site, result, thresholds);
            grid.appendChild(card);
        });
    },

    createSiteCard(site, result, thresholds) {
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

        // 히스토리 그래프 렌더링 로직 (최대 15개 막대)
        const history = site.history || [];
        const maxHistory = 15;
        
        // 그래프 막대 생성
        let sparklineHtml = '';
        for (let i = 0; i < maxHistory; i++) {
            const data = history[i] || null;
            let barClass = 'bar-empty';
            let height = '4px'; // 데이터 없을 때 최소 높이
            
            if (data) {
                if (!data.online) {
                    barClass = 'bar-error';
                    height = '100%';
                } else {
                    if (data.value < safeThresholds.normal) barClass = 'bar-normal';
                    else if (data.value < safeThresholds.slow) barClass = 'bar-warning';
                    else barClass = 'bar-danger';
                    
                    // 최대 slow 기준(기본 5000ms)으로 높이 계산 (최소 15% ~ 최대 100%)
                    const percentage = Math.min(Math.max((data.value / safeThresholds.slow) * 100, 15), 100);
                    height = `${percentage}%`;
                }
            }
            
            sparklineHtml += `<div class="spark-bar ${barClass}" style="height: ${height}" title="${data ? (data.online ? data.value + 'ms' : 'Error') : 'No data'}"></div>`;
        }

        const currentResponseTime = result.responseTime ? `${result.responseTime}ms` : (result.status === 'pending' ? '...' : 'OFFLINE');
        const previewHtml = `
            <div class="sparkline-container">
                <div class="sparkline-header">
                    <span class="sparkline-title">RESPONSE TREND</span>
                    <span class="sparkline-value">${currentResponseTime}</span>
                </div>
                <div class="sparkline-bars">
                    ${sparklineHtml}
                </div>
            </div>
        `;

        card.innerHTML = `
            <div class="site-actions">
                <button class="action-btn drag-handle" title="순서 변경"><i class="ri-drag-move-fill"></i></button>
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
