const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase 설정
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 인증용 클라이언트 (회원가입/로그인/토큰 검증) — 요청 간 세션이 공유되지 않도록 저장 금지
const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
});

// DB 작업용 클라이언트 — service_role 키로 RLS를 우회 (서버 전용, 절대 클라이언트에 노출 금지)
const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
});

if (!supabaseServiceKey) {
    console.warn('[Server] SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다. RLS가 켜진 테이블은 조회/저장이 실패할 수 있습니다.');
}

app.use(cors());
app.use(express.json());
// Render 등 배포 환경에서는 상대 경로 주의
const distPath = path.join(__dirname, 'client/dist'); 
// (참고: 서버와 클라이언트가 분리 배포될 것이므로 이 부분은 실제로는 사용되지 않을 가능성이 높음)

// JWT 검증 미들웨어 (Supabase Auth 연동)
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: '인증이 필요합니다.' });

    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);

    if (error || !user) {
        return res.status(403).json({ error: '유효하지 않은 토큰입니다.' });
    }

    req.user = user;
    next();
};

// --- 인증 API (Supabase Auth 연동) ---

// 회원가입
app.post('/api/auth/register', async (req, res) => {
    console.log('[API] /api/auth/register 호출됨:', req.body.email);
    const { email, username, password } = req.body;

    const { data, error } = await supabaseAuth.auth.signUp({
        email,
        password,
        options: {
            data: { display_name: username }
        }
    });

    if (error) {
        console.error('[API] 회원가입 오류:', error.message);
        return res.status(400).json({ error: error.message });
    }
    console.log('[API] 회원가입 성공:', data.user ? data.user.id : 'user data missing');
    res.status(201).json({ message: '회원가입 성공. 이메일 확인이 필요할 수 있습니다.' });
});

// 로그인
app.post('/api/auth/login', async (req, res) => {
    console.log('[API] /api/auth/login 호출됨:', req.body.email);
    const { email, password } = req.body;

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        console.error('[API] 로그인 오류:', error.message);
        return res.status(401).json({ error: '이메일 또는 비밀번호가 잘못되었습니다.' });
    }

    console.log('[API] 로그인 성공:', data.user.id);
    res.json({
        token: data.session.access_token,
        username: data.user.user_metadata.display_name || email.split('@')[0]
    });
});

// --- 사이트 관리 API (Supabase DB 연동) ---

// 사이트 데이터 불러오기
app.get('/api/sites', authenticateToken, async (req, res) => {
    console.log('[API] /api/sites GET 호출됨 - user_id:', req.user.id);
    const { data, error } = await supabase
        .from('sites')
        .select('data')
        .eq('user_id', req.user.id)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('[API] 사이트 조회 오류:', error.message);
        return res.status(500).json({ error: error.message });
    }

    res.json(data ? data.data : { sites: [], settings: {} });
});

// 사이트 데이터 저장하기
app.post('/api/sites', authenticateToken, async (req, res) => {
    console.log('[API] /api/sites POST 호출됨 - user_id:', req.user.id);
    const { error } = await supabase
        .from('sites')
        .upsert({
            user_id: req.user.id,
            data: req.body,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

    if (error) {
        console.error('[API] 사이트 저장 오류:', error.message);
        return res.status(500).json({ error: error.message });
    }
    console.log('[API] 사이트 저장 성공');
    res.json({ message: '저장 성공' });
});

// --- 모니터링 기능 API ---

// 사이트 상태 및 응답 속도 체크 (메인 페이지)
app.get('/api/check', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL이 필요합니다.' });

    const start = Date.now();
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            validateStatus: () => true
        });

        res.json({
            status: response.status,
            statusText: response.statusText,
            responseTime: Date.now() - start
        });
    } catch (error) {
        console.error(`[API] 메인 체크 실패 (${url}):`, error.message);
        res.status(500).json({
            error: '요청 실패',
            message: error.message,
            responseTime: Date.now() - start
        });
    }
});

// 사이트 메타데이터 / OG 이미지 등 가져오기
app.get('/api/metadata', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL이 필요합니다.' });

    try {
        const response = await axios.get(url, {
            timeout: 8000, // 타임아웃 단축 (8초)
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            validateStatus: () => true // 502 등 에러 상태코드도 catch로 가지 않고 직접 처리
        });

        if (response.status !== 200) {
            console.warn(`[Metadata] ${url} 응답 에러: ${response.status}`);
            return res.json({ ogImage: null, favicon: null });
        }

        const html = typeof response.data === 'string' ? response.data : '';

        const metaPatterns = [
            /(<meta[^>]*property=["']og:image["'][^>]*>)/i,
            /(<meta[^>]*name=["']twitter:image(?::src)?["'][^>]*>)/i,
        ];

        let ogImage = null;
        for (const pattern of metaPatterns) {
            const metaTagMatch = html.match(pattern);
            if (metaTagMatch) {
                const contentMatch = metaTagMatch[1].match(/content=["']([^"']+)["']/i);
                if (contentMatch && contentMatch[1]) {
                    ogImage = contentMatch[1];
                    break;
                }
            }
        }

        const baseUrl = new URL(url).origin;
        if (ogImage && !ogImage.startsWith('http')) {
            try { ogImage = new URL(ogImage, baseUrl).href; } catch (e) { ogImage = null; }
        }

        // 파비콘 추출
        const faviconPatterns = [
            /<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["'][^>]*>/i,
            /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["'][^>]*>/i
        ];
        
        let favicon = null;
        for (const pattern of faviconPatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                favicon = match[1];
                break;
            }
        }

        if (favicon && !favicon.startsWith('http')) {
            try { favicon = new URL(favicon, baseUrl).href; } catch (e) { favicon = null; }
        } else if (!favicon) {
            favicon = `${baseUrl}/favicon.ico`;
        }

        console.log(`[Metadata] ${url} -> ogImage: ${ogImage || '없음'}, favicon: ${favicon}`);
        res.json({ ogImage, favicon });
    } catch (error) {
        console.warn(`[Metadata] ${url} 가져오기 실패: ${error.message}`);
        res.json({ ogImage: null, favicon: null });
    }
});

// 키워드 존재 여부 체크
app.get('/api/check-keyword', async (req, res) => {
    const { url, keyword, type } = req.query;
    if (!url || !keyword) return res.status(400).json({ error: 'URL과 키워드가 필요합니다.' });

    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            validateStatus: () => true
        });

        let exists = false;
        const responseData = response.data;
        const isJsonResponse = typeof responseData === 'object';

        if (type === 'api' || isJsonResponse || keyword === 'OK_STATUS_CHECK') {
            exists = response.status >= 200 && response.status < 300;
            console.log(`[API 체크 결과] URL: ${url}, Status: ${response.status}, Success: ${exists}`);
        } else {
            const html = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
            exists = html.includes(keyword);
            if (!exists) {
                console.log(`[키워드 체크] 키워드 미검출(${keyword}) - 응답 길이: ${html.length}`);
            }
        }

        res.json({
            status: response.status,
            exists: exists
        });
    } catch (error) {
        console.error('[API] 체크 실패:', error.message);
        res.status(500).json({ error: '데이터 로드 실패', message: error.message });
    }
});

// 체크 로그 조회 (본인 로그만)
// 쿼리: siteId(선택), hours(기본 24), limit(기본 500, 최대 2000)
app.get('/api/logs', authenticateToken, async (req, res) => {
    const { siteId } = req.query;
    const hours = Math.max(parseInt(req.query.hours, 10) || 24, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);

    let query = supabase
        .from('check_logs')
        .select('site_id, site_name, url, checked_at, response_time, status_code, online')
        .eq('user_id', req.user.id)
        .gte('checked_at', new Date(Date.now() - hours * 3600 * 1000).toISOString())
        .order('checked_at', { ascending: false })
        .limit(limit);

    if (siteId) query = query.eq('site_id', siteId);

    const { data, error } = await query;
    if (error) {
        console.error('[API] 로그 조회 오류:', error.message);
        return res.status(500).json({ error: error.message });
    }
    res.json(data);
});

// 헬스체크
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA 라우팅
app.get(/.*/, (req, res) => {
    const indexPath = path.join(__dirname, '../client/dist/index.html');
    if (require('fs').existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('백엔드 서버가 실행 중입니다. 프론트엔드는 5600번 포트를 사용하세요.');
    }
});

// --- 서버 백그라운드 모니터링 로직 ---

async function runBackgroundMonitor() {
    console.log('[Background] 모니터링 시작:', new Date().toLocaleString());
    
    try {
        // 모든 사용자의 사이트 데이터 가져오기
        const { data: allUserSites, error } = await supabase
            .from('sites')
            .select('*');

        if (error) throw error;
        if (!allUserSites || allUserSites.length === 0) {
            console.log('[Background] 체크할 사이트가 없습니다.');
            return;
        }

        for (const record of allUserSites) {
            const userId = record.user_id;
            const appData = record.data; // { sites: [], settings: {} }
            
            if (!appData || !appData.sites || appData.sites.length === 0) continue;

            let isUpdated = false;
            const logRows = []; // check_logs 테이블에 쌓을 로그

            // 해당 사용자의 모든 사이트 체크
            for (const site of appData.sites) {
                if (site.enabled === false) continue;

                const start = Date.now();
                try {
                    // 1. 메인 사이트 체크
                    const response = await axios.get(site.url, {
                        timeout: 10000,
                        headers: { 'User-Agent': 'PingOwl-Monitor/1.0' },
                        validateStatus: () => true
                    });

                    const responseTime = Date.now() - start;
                    const online = response.status >= 200 && response.status < 400;

                    // 2. 히스토리 업데이트
                    if (!site.history) site.history = [];
                    site.history.push({
                        time: Date.now(),
                        value: responseTime,
                        online: online
                    });

                    // 15개 유지
                    if (site.history.length > 15) site.history.shift();

                    site.lastChecked = new Date().toISOString();
                    isUpdated = true;

                    logRows.push({
                        user_id: userId,
                        site_id: String(site.id),
                        site_name: site.name || null,
                        url: site.url,
                        checked_at: new Date().toISOString(),
                        response_time: responseTime,
                        status_code: response.status,
                        online: online
                    });

                    // (옵션) 키워드 체크 등 추가 로직이 필요하면 여기서 수행 가능
                } catch (err) {
                    console.error(`[Background] 체크 실패 (${site.url}):`, err.message);
                    if (!site.history) site.history = [];
                    site.history.push({ time: Date.now(), value: 0, online: false });
                    if (site.history.length > 15) site.history.shift();
                    isUpdated = true;

                    logRows.push({
                        user_id: userId,
                        site_id: String(site.id),
                        site_name: site.name || null,
                        url: site.url,
                        checked_at: new Date().toISOString(),
                        response_time: Date.now() - start,
                        status_code: null,
                        online: false
                    });
                }
            }

            // 변경 사항이 있으면 DB에 저장
            if (isUpdated) {
                await supabase
                    .from('sites')
                    .update({ data: appData, updated_at: new Date().toISOString() })
                    .eq('user_id', userId);
            }

            // 체크 로그 적재 (테이블이 없어도 모니터링 자체는 계속 동작)
            if (logRows.length > 0) {
                const { error: logError } = await supabase
                    .from('check_logs')
                    .insert(logRows);
                if (logError) {
                    console.error('[Background] 체크 로그 저장 실패:', logError.message);
                } else {
                    console.log(`[Background] 체크 로그 ${logRows.length}건 저장`);
                }
            }
        }
        console.log('[Background] 모든 사이트 체크 완료');
    } catch (err) {
        console.error('[Background] 치명적 오류:', err.message);
    }
}

// 서버 시작 1분 후 첫 실행, 이후 5분마다 반복 (300,000ms)
setTimeout(() => {
    runBackgroundMonitor();
    setInterval(runBackgroundMonitor, 300000); 
}, 60000);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
