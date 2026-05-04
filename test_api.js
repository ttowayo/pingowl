const url = 'https://api.rchada.com/api_secure/newepdata_list.php';
(async () => {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        console.log('Status:', response.status);
        const text = await response.text();
        console.log('Data typeof string, length:', text.length);
        console.log('Data preview:', text.substring(0, 100));
    } catch (e) {
        console.error('Error:', e.message);
    }
})();
