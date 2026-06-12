
const http = require('http');
async function run() {
  try {
    console.log('1. Logging in...');
    const res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pakipark.com', password: 'password123' })
    });
    const data = await res.json();
    console.log('Login Response:', data);

    if (!data.success) return;

    console.log('\n2. Fetching /me...');
    const meRes = await fetch('http://localhost:5000/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + data.data.token }
    });
    console.log('Me status:', meRes.status);
    console.log('Me response:', await meRes.text());
  } catch (e) { console.error(e); }
}
run();

