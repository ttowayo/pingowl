import { API_BASE } from './config.js';

export const monitor = {
    /**
     * 사이트 하나의 상태를 체크합니다.
     */
    async checkSite(site) {
        // 백엔드 프록시 서버 API 엔드포인트 사용
        const CHECK_API_URL = `${API_BASE}/api/check?url=`;
        const KEYWORD_BASE_URL = `${API_BASE}/api/check-keyword`;

        try {
            console.log(`[Monitor] Checking Main Site: ${site.name} (${site.url})`);
            
            // 1. 메인 사이트 상태 체크
            const response = await fetch(`${CHECK_API_URL}${encodeURIComponent(site.url)}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || '백엔드 프록시 에러');
            }

            // 2. 하위 페이지 키워드 체크
            const checkResults = await Promise.all((site.checks || []).map(async (check) => {
                try {
                    console.log(`  └ [Sub-page] Checking: ${check.name} -> ${check.url}`);
                    const urlParams = new URLSearchParams({
                        url: check.url,
                        keyword: check.keyword,
                        type: check.type || 'text',
                        apiPath: check.apiPath || ''
                    });
                    const checkRes = await fetch(`${KEYWORD_BASE_URL}?${urlParams.toString()}`);
                    const checkData = await checkRes.json();
                    
                    if (!checkRes.ok) throw new Error('하위 페이지 체크 실패');

                    return {
                        ...check,
                        status: checkData.status,
                        exists: checkData.exists,
                        checkedAt: new Date().toISOString()
                    };
                } catch (e) {
                    return { ...check, status: 'error', exists: false, checkedAt: new Date().toISOString() };
                }
            }));

            return {
                id: site.id,
                online: data.status >= 200 && data.status < 400,
                status: data.status,
                responseTime: data.responseTime,
                checkResults,
                lastChecked: new Date().toISOString()
            };
        } catch (error) {
            console.error('[Monitor Error]', error);
            return {
                id: site.id,
                online: false,
                status: 'error',
                message: error.message,
                checkResults: [],
                lastChecked: new Date().toISOString()
            };
        }
    }
};
