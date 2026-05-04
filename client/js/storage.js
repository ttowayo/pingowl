import { API_BASE } from './config.js';

const STORAGE_KEY = 'site_monitor_data';
const AUTH_KEY = 'site_monitor_auth';

const DEFAULT_DATA = {
    sites: [],
    settings: {
        refreshInterval: 300,
        responseTimeThresholds: {
            normal: 2000,
            slow: 5000
        }
    }
};

export const storage = {
    getAuth() {
        const auth = localStorage.getItem(AUTH_KEY);
        return auth ? JSON.parse(auth) : null;
    },

    setAuth(auth) {
        localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    },

    clearAuth() {
        localStorage.removeItem(AUTH_KEY);
    },

    async save(data) {
        const auth = this.getAuth();
        if (!auth) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            return;
        }

        try {
            await fetch(`${API_BASE}/api/sites`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`
                },
                body: JSON.stringify(data)
            });
        } catch (error) {
            console.error('서버 저장 실패:', error);
        }
    },

    async load() {
        const auth = this.getAuth();
        if (!auth) {
            const localData = localStorage.getItem(STORAGE_KEY);
            return localData ? JSON.parse(localData) : DEFAULT_DATA;
        }

        try {
            const response = await fetch(`${API_BASE}/api/sites`, {
                headers: {
                    'Authorization': `Bearer ${auth.token}`
                }
            });
            if (response.status === 401 || response.status === 403) {
                this.clearAuth();
                window.location.reload();
                return DEFAULT_DATA;
            }
            return await response.json();
        } catch (error) {
            console.error('서버 로드 실패:', error);
            return DEFAULT_DATA;
        }
    },

    async addSite(site) {
        const data = await this.load();
        data.sites.push({
            ...site,
            id: Date.now().toString(),
            enabled: true
        });
        await this.save(data);
    },

    async updateSite(updatedSite) {
        const data = await this.load();
        data.sites = data.sites.map(site => site.id === updatedSite.id ? updatedSite : site);
        await this.save(data);
    },

    async deleteSite(id) {
        const data = await this.load();
        data.sites = data.sites.filter(site => site.id !== id);
        await this.save(data);
    }
};
