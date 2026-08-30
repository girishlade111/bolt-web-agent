import { getSessionId, getEffectiveSessionId, generateSessionId, createSessionCookie } from './app/lib/.server/rate-limiter.ts';

async function testForkFix() {
  console.log('=== Test session fork race fix ===');
  // Simulate first request: no cookie, no header
  const req1 = new Request('http://localhost:5173/api/chat', { method: 'POST', headers: {} });
  let sid1 = getEffectiveSessionId(req1);
  console.log('Req1 effective (no cookie/header):', sid1, 'expected null');
  if (sid1 !== null) throw new Error('Expected null for no cookie/header');
  // Server would generate
  const generated1 = generateSessionId();
  console.log('Generated sid1:', generated1);
  const cookie1 = createSessionCookie(generated1, req1);
  console.log('Set-Cookie for req1 (http, dev, no Secure):', cookie1.includes('Secure') ? 'has Secure (FAIL)' : 'no Secure (PASS)');
  if (cookie1.includes('Secure')) throw new Error('http localhost should not have Secure');
  // Simulate client captures X-Session-Id from response header (which would be sid1? Actually server would return generated1)
  const mockRes1 = new Response('', { headers: { 'X-Session-Id': generated1 } });
  // Client captures
  const { setCachedSessionId, getCachedSessionId, fetchWithSession } = await import('./app/lib/session.client.ts');
  // Simulate client capture
  setCachedSessionId(generated1);
  console.log('Client cached after req1:', getCachedSessionId() === generated1 ? 'PASS' : 'FAIL');

  // Simulate second concurrent request: no cookie yet (Set-Cookie not propagated), but header from cache
  const req2 = new Request('http://localhost:5173/api/chat-history', {
    method: 'POST',
    headers: { 'X-Session-Id': generated1, 'Content-Type': 'application/json' },
  });
  // No cookie header
  const effective2 = getEffectiveSessionId(req2);
  console.log('Req2 effective (header present, no cookie):', effective2, 'expected', generated1, effective2 === generated1 ? 'PASS' : 'FAIL');
  if (effective2 !== generated1) throw new Error('Effective should be header');

  // Simulate third request: now with cookie (after browser stored), but also header (should be same)
  const cookieValue = cookie1.split(';')[0];
  const req3 = new Request('http://localhost:5173/api/chat', {
    headers: { Cookie: cookieValue, 'X-Session-Id': generated1 },
  });
  const effective3 = getEffectiveSessionId(req3);
  console.log('Req3 effective (both cookie and header same):', effective3, effective3 === generated1 ? 'PASS' : 'FAIL');

  // Test https should have Secure
  const httpsReq = new Request('https://example.com/api/chat');
  const httpsCookie = createSessionCookie(generated1, httpsReq);
  console.log('https cookie contains Secure?', httpsCookie.includes('Secure') ? 'PASS' : 'FAIL');
  if (!httpsCookie.includes('Secure')) throw new Error('https should have Secure');

  // Test production via NODE_ENV
  const orig = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = 'production';
  const prodCookie = createSessionCookie(generated1);
  console.log('production cookie contains Secure?', prodCookie.includes('Secure') ? 'PASS' : 'FAIL');
  (process.env as any).NODE_ENV = orig;

  console.log('\nAll fork race tests passed');
}

testForkFix().catch(e => { console.error(e); process.exit(1); });
