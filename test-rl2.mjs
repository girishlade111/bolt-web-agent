import { checkRateLimit, createRateLimitResponse } from './app/lib/.server/rate-limiter.ts';

async function test() {
  const env = {};
  const ip = '1.2.3.4';
  const sessionId = 'testsession123456789012345';
  let cookie = `bolt_session=${sessionId}`;
  for (let i=1; i<=22; i++) {
    const req = new Request('https://example.com/api/chat', { method: 'POST', headers: { Cookie: cookie, 'cf-connecting-ip': ip }});
    const res = await checkRateLimit(req, env);
    console.log(`attempt ${i}: allowed=${res.allowed} sessionCount=${res.sessionCount} ipCount=${res.ipCount} ${res.errorMessage||''}`);
    if (!res.allowed) {
      const resp = createRateLimitResponse(res);
      console.log('429 status', resp.status, 'retry-after', resp.headers.get('Retry-After'), await resp.text());
      break;
    }
  }
  console.log('--- IP limit test ---');
  const env2 = {};
  const ip2 = '5.6.7.8';
  for (let i=1; i<=101; i++) {
    const sid = `sess${i}abcdef1234567890${i}`;
    const req = new Request('https://example.com/api/chat', { method: 'POST', headers: { Cookie: `bolt_session=${sid}`, 'cf-connecting-ip': ip2 }});
    const res = await checkRateLimit(req, env2);
    if (!res.allowed) {
      console.log(`IP blocked at attempt ${i}: ${res.errorMessage} limitType=${res.limitType} ipCount=${res.ipCount}`);
      break;
    }
    if (i===100) console.log(`attempt ${i} still allowed ipCount=${res.ipCount}`);
  }
  console.log('--- new session cookie ---');
  const reqNoCookie = new Request('https://example.com/api/chat', { method: 'POST', headers: { 'cf-connecting-ip': '9.9.9.9' }});
  const resNoCookie = await checkRateLimit(reqNoCookie, {});
  console.log('new session allowed', resNoCookie.allowed, 'isNew', resNoCookie.isNewSession, 'cookie', !!resNoCookie.cookieHeader, 'sessionId len', resNoCookie.sessionId.length);
}
test().catch(e=>{console.error(e); process.exit(1)});
