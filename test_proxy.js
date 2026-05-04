(async () => {
    try {
        const urlParams = new URLSearchParams({
            url: 'https://api.rchada.com/api_secure/newepdata_list.php',
            keyword: 'OK_STATUS_CHECK',
            type: 'api',
            apiPath: ''
        });
        const checkRes = await fetch(`http://localhost:3001/api/check-keyword?${urlParams.toString()}`);
        const checkData = await checkRes.json();
        console.log('Status:', checkRes.status);
        console.log('Data:', checkData);
    } catch (e) {
        console.error('Error:', e.message);
    }
})();
