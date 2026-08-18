import { storage } from './storage.js';
import { monitor } from './monitor.js';
import { ui } from './ui.js';
import { API_BASE } from './config.js';

let appData = {
    sites: [],
    settings: {},
    results: []
};
let refreshIntervalId = null;
let siteLogsMap = {}; // site_id → 최근 1시간 체크 로그 (오름차순) — 카드 미니 그래프용

/**
 * 전체 사이트의 최근 1시간 로그를 한 번에 조회 (5분 주기 서버 체크 기준)
 */
async function loadRecentLogs() {
    const auth = storage.getAuth();
    if (!auth) return;
    try {
        const res = await fetch(`${API_BASE}/api/logs?hours=1&limit=2000`, {
            headers: { 'Authorization': `Bearer ${auth.token}` }
        });
        if (!res.ok) return;
        const logs = await res.json(); // 최신순
        const map = {};
        for (const log of logs) {
            (map[log.site_id] = map[log.site_id] || []).push(log);
        }
        Object.values(map).forEach(arr => arr.reverse()); // 오름차순으로
        siteLogsMap = map;
    } catch (err) {
        console.warn('최근 로그 조회 실패:', err);
    }
}

/**
 * 앱 초기화
 */
async function init() {
    setupAuthUI();
    await refreshData(false); // 초기 로드 (자동 체크는 하지 않음)
    
    setupEventListeners();
    
    // 자동 새로고침 설정 (로그인 시에만)
    if (storage.getAuth()) {
        initNotifications();
        await loadRecentLogs();
        await checkAllSites();
        refreshIntervalId = setInterval(checkAllSites, (appData.settings.refreshInterval || 300) * 1000);
    } else {
        render(); // 비로그인 시 기본 렌더링
    }
}

// --- 브라우저 알림 (에러 발생/복구 시) ---

// 사이트·체크별로 마지막 에러 상태를 기억해서 상태가 바뀔 때만 알림 (5분마다 반복 알림 방지)
const notifiedErrors = new Map();

function initNotifications() {
    const btn = document.getElementById('notify-btn');
    if (!btn) return;

    // 브라우저가 알림을 지원하지 않거나 이미 허용/차단된 상태면 버튼 숨김
    if (!('Notification' in window) || Notification.permission !== 'default') {
        btn.classList.add('hidden');
        return;
    }

    // 권한이 미결정('default')일 때만 버튼 표시
    // (브라우저 정책상 권한 요청은 사용자 클릭 안에서 해야 프롬프트가 뜸)
    btn.classList.remove('hidden');
    btn.onclick = async () => {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            btn.classList.add('hidden');
            sendNotification('🔔 PingOwl 알림 켜짐', '사이트 에러가 발생하면 이렇게 알려드립니다.');
        } else if (permission === 'denied') {
            btn.classList.add('hidden');
            alert('알림이 차단되었습니다.\n다시 켜려면 주소창 왼쪽 자물쇠(사이트 설정) > 알림 > 허용으로 변경해주세요.');
        }
    };
}

function sendNotification(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        new Notification(title, { body, icon: '/favicon.ico', tag: title });
    } catch (e) {
        console.warn('알림 표시 실패:', e);
    }
}

function notifyCheckResult(site, result) {
    if (!result || result.status === 'pending') return;

    // 1. 사이트 자체 다운 / 복구
    const siteKey = `site:${site.id}`;
    if (!result.online) {
        if (!notifiedErrors.get(siteKey)) {
            notifiedErrors.set(siteKey, true);
            sendNotification(`🔴 ${site.name} 사이트 다운`, `${site.url} 에 접속할 수 없습니다.`);
        }
    } else if (notifiedErrors.get(siteKey)) {
        notifiedErrors.set(siteKey, false);
        sendNotification(`✅ ${site.name} 복구됨`, `사이트가 다시 정상 응답합니다. (${result.responseTime || '-'}ms)`);
    }

    // 2. WEB 페이지 / API 체크 에러 및 정상화
    (result.checkResults || []).forEach(check => {
        if (check.status === 'pending') return;
        const key = `check:${site.id}:${check.id || check.name}`;
        const isError = !check.exists;

        if (isError && !notifiedErrors.get(key)) {
            notifiedErrors.set(key, true);
            const detail = check.type === 'api'
                ? `API 응답 이상 (HTTP ${check.status || '접속 실패'})`
                : `"${check.keyword}" 키워드를 찾을 수 없습니다. (HTTP ${check.status || '접속 실패'})`;
            sendNotification(`⚠️ ${site.name} - ${check.name} 에러`, detail);
        } else if (!isError && notifiedErrors.get(key)) {
            notifiedErrors.set(key, false);
            sendNotification(`✅ ${site.name} - ${check.name} 정상화`, '체크가 다시 정상으로 돌아왔습니다.');
        }
    });
}

/**
 * 인증 UI 업데이트
 */
function setupAuthUI() {
    const auth = storage.getAuth();
    const userInfoArea = document.getElementById('user-info-area');
    const loginBtn = document.getElementById('login-btn');
    const registerBtn = document.getElementById('register-btn');
    const addSiteBtn = document.getElementById('add-site');
    const displayUsername = document.getElementById('display-username');

    if (auth) {
        userInfoArea.classList.remove('hidden');
        loginBtn.classList.add('hidden');
        if (registerBtn) registerBtn.classList.add('hidden');
        addSiteBtn.classList.remove('hidden');
        displayUsername.textContent = auth.username;
    } else {
        userInfoArea.classList.add('hidden');
        loginBtn.classList.remove('hidden');
        if (registerBtn) registerBtn.classList.remove('hidden');
        addSiteBtn.classList.add('hidden');
    }
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    // 사이트 추가 버튼 (헤더)
    const addSiteBtn = document.getElementById('add-site');
    if (addSiteBtn) {
        addSiteBtn.onclick = () => ui.showModal();
    }

    // 웹페이지 체크 추가 버튼 (모달 내부)
    const addWebBtn = document.getElementById('add-web-check');
    if (addWebBtn) {
        addWebBtn.onclick = () => ui.addWebCheckRow();
    }

    // API 체크 추가 버튼 (모달 내부)
    const addApiBtn = document.getElementById('add-api-check');
    if (addApiBtn) {
        addApiBtn.onclick = () => ui.addApiCheckRow();
    }
    
    // 전체 체크 버튼
    const refreshAllBtn = document.getElementById('refresh-all');
    if (refreshAllBtn) {
        refreshAllBtn.onclick = checkAllSites;
    }
    
    // 모달 닫기 (공통)
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.onclick = () => {
            ui.hideModal('modal-site');
            ui.hideModal('modal-auth');
            ui.hideModal('modal-logs');
        };
    });

    // 로그 모달 기간 탭 (24시간 / 3일 / 7일)
    document.querySelectorAll('.logs-tab').forEach(tab => {
        tab.onclick = () => {
            if (currentLogSite) openLogsModal(currentLogSite, Number(tab.dataset.hours));
        };
    });
    
    // 로그인 버튼
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.onclick = () => {
            ui.showModal(null, 'modal-auth');
            const loginTab = document.querySelector('.auth-tab[data-target="login-form"]');
            if (loginTab) loginTab.click();
        };
    }

    // 회원가입 버튼
    const registerBtn = document.getElementById('register-btn');
    if (registerBtn) {
        registerBtn.onclick = () => {
            ui.showModal(null, 'modal-auth');
            const registerTab = document.querySelector('.auth-tab[data-target="register-form"]');
            if (registerTab) registerTab.click();
        };
    }

    // 로그아웃 버튼
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            if (refreshIntervalId) clearInterval(refreshIntervalId);
            appData.sites = [];
            appData.results = [];
            storage.clearAll();
            window.location.reload();
        };
    }

    // 인증 탭 전환
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.onclick = (e) => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const targetId = e.currentTarget.dataset.target;
            const targetForm = document.getElementById(targetId);
            if (targetForm) targetForm.classList.add('active');
        };
    });

    // 회원가입 제출
    document.getElementById('register-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        
        if (data.password !== data.passwordConfirm) {
            alert('비밀번호가 일치하지 않습니다. 다시 확인해주세요.');
            return;
        }

        // 비밀번호 확인용 데이터는 서버로 보내기 전에 제거
        delete data.passwordConfirm;
        
        try {
            const res = await fetch(`${API_BASE}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (res.ok) {
                alert('회원가입 완료! 로그인해주세요.');
                document.querySelector('.auth-tab[data-target="login-form"]').click();
            } else {
                alert(result.error);
            }
        } catch (err) { alert('통신 오류'); }
    };

    // 로그인 제출
    document.getElementById('login-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        
        try {
            const res = await fetch(`${API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (res.ok) {
                storage.setAuth({ token: result.token, username: result.username });
                window.location.reload();
            } else {
                alert(result.error);
            }
        } catch (err) { alert('통신 오류'); }
    };
    


    // 사이트 폼 제출
    document.getElementById('site-form').onsubmit = async (e) => {
        e.preventDefault();
        await saveSite();
    };

    // 사이트 그리드 위임
    document.getElementById('site-grid').onclick = async (e) => {
        const card = e.target.closest('.site-card');
        if (!card) return;
        const id = card.dataset.id;
        const site = appData.sites.find(s => s.id === id);

        if (e.target.closest('.edit-btn')) {
            ui.showModal(site, 'modal-site');
        } else if (e.target.closest('.delete-btn')) {
            if (confirm(`'${site.name}' 사이트를 삭제하시겠습니까?`)) {
                await storage.deleteSite(id);
                await refreshData();
            }
        } else if (e.target.closest('.check-btn')) {
            const btn = e.target.closest('.check-btn');
            btn.innerHTML = '<i class="ri-loader-4-line spin"></i>';
            btn.disabled = true;
            await checkSingleSite(site);
        } else if (e.target.closest('.logs-btn') || e.target.closest('.site-preview')) {
            // 로그 버튼 또는 스파크라인 그래프 클릭 시 로그 모달
            openLogsModal(site);
        }
    };
}

/**
 * 체크 로그 모달 열기 (서버에 쌓인 로그 조회)
 */
let currentLogSite = null;
async function openLogsModal(site, hours = 24) {
    if (!site) return;
    currentLogSite = site;

    document.querySelectorAll('.logs-tab').forEach(t =>
        t.classList.toggle('active', Number(t.dataset.hours) === hours)
    );
    ui.showLogsModal(site);

    const auth = storage.getAuth();
    if (!auth) {
        document.getElementById('logs-body').innerHTML = '<div class="logs-empty"><p>로그인이 필요합니다.</p></div>';
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/logs?siteId=${encodeURIComponent(site.id)}&hours=${hours}&limit=2000`, {
            headers: { 'Authorization': `Bearer ${auth.token}` }
        });
        if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
        const logs = await res.json();
        ui.renderLogs(logs, hours, appData.settings.responseTimeThresholds);
    } catch (err) {
        document.getElementById('logs-body').innerHTML = `<div class="logs-empty"><p>로그를 불러오지 못했습니다.<br>${err.message}</p></div>`;
    }
}

/**
 * 개별 사이트 상태 체크
 */
async function checkSingleSite(site) {
    if (!site) return;

    // 현재 결과 배열에서 해당 사이트의 인덱스 찾기
    let index = appData.results.findIndex(r => r.id === site.id);
    if (index === -1) {
        appData.results.push({ id: site.id, online: false, status: 'pending', checkResults: (site.checks || []).map(c => ({ ...c, status: 'pending' })) });
        index = appData.results.length - 1;
    } else {
        appData.results[index] = { ...appData.results[index], status: 'pending', checkResults: (site.checks || []).map(c => ({ ...c, status: 'pending' })) };
    }
    
    render(); // 로딩 상태 렌더링

    const result = await monitor.checkSite(site);
    
    // 응답 시간 히스토리 관리 (최근 15개)
    if (!site.history) site.history = [];
    if (result.responseTime) {
        site.history.push({
            time: Date.now(),
            value: result.responseTime,
            online: result.online
        });
    } else {
        // 오프라인인 경우 0으로 기록
        site.history.push({
            time: Date.now(),
            value: 0,
            online: false
        });
    }
    
    // 15개 초과 시 오래된 순으로 삭제
    if (site.history.length > 15) {
        site.history.shift();
    }

    // 변경된 히스토리 저장
    await storage.updateSite(site);

    appData.results[index] = result;
    notifyCheckResult(site, result);
    render(); // 최종 결과와 그래프를 함께 렌더링
}

/**
 * 모든 사이트 상태 체크
 */
async function checkAllSites() {
    if (appData.sites.length === 0) return;
    
    const refreshBtn = document.getElementById('refresh-all');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="ri-loader-4-line spin"></i> 체크 중...';
    }

    // 결과 배열 초기화
    appData.results = appData.sites.map(site => ({
        id: site.id, online: false, status: 'pending',
        checkResults: site.checks.map(c => ({ ...c, status: 'pending' }))
    }));
    render();

    // 사이트별로 비동기적으로 체크 수행 (서로 방해하지 않음)
    const checkPromises = appData.sites.map(async (site, index) => {
        try {
            const result = await monitor.checkSite(site);
            appData.results[index] = result;
        } catch (err) {
            console.warn(`[체크 건너뜀] ${site.name}: ${err.message}`);
            appData.results[index] = {
                id: site.id, online: false, status: 'error',
                checkResults: site.checks.map(c => ({ ...c, status: 'error', exists: false }))
            };
        }
        notifyCheckResult(site, appData.results[index]);
        render();
    });

    await Promise.allSettled(checkPromises);

    // 카드 미니 그래프용 최근 1시간 로그 갱신 (서버가 5분마다 쌓는 데이터)
    await loadRecentLogs();
    render();

    if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="ri-refresh-line"></i> 전체 체크';
    }
}

/**
 * 사이트 저장
 */
async function saveSite() {
    const id = document.getElementById('site-id').value;
    const name = document.getElementById('site-name').value;
    const url = document.getElementById('site-url').value;
    
    // 두 리스트에서 모든 항목 수집
    const webRows = document.querySelectorAll('.web-mode-row');
    const apiRows = document.querySelectorAll('.api-mode-row');
    
    const collectChecks = (rows) => Array.from(rows).map(row => ({
        id: row.dataset.id || Date.now().toString() + Math.random(),
        type: row.querySelector('.check-type').value,
        name: row.querySelector('.check-name').value,
        url: row.querySelector('.check-url').value,
        keyword: row.querySelector('.check-keyword').value,
        enabled: true
    }));

    const checks = [...collectChecks(webRows), ...collectChecks(apiRows)];
    
    // 메타데이터(이미지, 파비콘) 가져오기
    let ogImage = null;
    let favicon = null;
    try {
        const metaRes = await fetch(`${API_BASE}/api/metadata?url=${encodeURIComponent(url)}`);
        const metaData = await metaRes.json();
        ogImage = metaData.ogImage;
        favicon = metaData.favicon;
    } catch (e) {
        console.warn('메타데이터 추출 실패:', e);
    }

    const siteData = { id, name, url, checks, ogImage, favicon, enabled: true };

    if (id) {
        await storage.updateSite(siteData);
    } else {
        siteData.id = Date.now().toString();
        await storage.addSite(siteData);
    }

    await refreshData(false); // 데이터 갱신
    ui.hideModal('modal-site');
    
    // 방금 저장한 해당 사이트만 즉시 개별 체크
    checkSingleSite(siteData);
}

/**
 * 데이터 리프레시
 */
async function refreshData(shouldCheck = true) {
    const newData = await storage.load();
    appData.sites = newData.sites || [];
    appData.settings = newData.settings || { refreshInterval: 300, responseTimeThresholds: { normal: 2000, slow: 5000 } };
    render();
    if (shouldCheck && appData.sites.length > 0) await checkAllSites();
}

/**
 * 화면 렌더링
 */
function render() {
    ui.renderStats(appData.results, appData.settings.responseTimeThresholds);
    ui.renderSiteGrid(appData.sites, appData.results, appData.settings.responseTimeThresholds, siteLogsMap);
    // 렌더링 후에 드래그 정렬 기능을 다시 초기화해야 함
    initSortable();
}

/**
 * 드래그 앤 드롭 정렬 초기화
 */
function initSortable() {
    const grid = document.getElementById('site-grid');
    if (!grid) return;

    // 기존 인스턴스가 있다면 파괴하고 새로 생성 (중복 바인딩 방지)
    const existingSortable = Sortable.get(grid);
    if (existingSortable) {
        existingSortable.destroy();
    }

    Sortable.create(grid, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: async () => {
            const cards = grid.querySelectorAll('.site-card');
            const newOrderIds = Array.from(cards).map(card => card.dataset.id);
            
            // 현재 메모리의 사이트 목록을 새로운 순서대로 재정렬
            const reorderedSites = newOrderIds.map(id => 
                appData.sites.find(s => s.id === id)
            ).filter(Boolean);

            appData.sites = reorderedSites;
            
            // DB에 저장
            const siteData = {
                sites: appData.sites,
                settings: appData.settings
            };
            await storage.save(siteData);
            console.log('순서 변경 저장 완료');
        }
    });
}

init();
initSortable();
