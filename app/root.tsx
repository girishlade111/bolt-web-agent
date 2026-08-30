import { useStore } from '@nanostores/react';
import type { LinksFunction, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useRouteError } from '@remix-run/react';
import { createSessionCookie, generateSessionId, getSessionId } from '~/lib/.server/rate-limiter';
import tailwindReset from '@unocss/reset/tailwind-compat.css?url';
import { themeStore } from './lib/stores/theme';
import { stripIndents } from './utils/stripIndent';
import { createHead } from 'remix-island';
import { useEffect } from 'react';

import reactToastifyStyles from 'react-toastify/dist/ReactToastify.css?url';
import globalStyles from './styles/index.scss?url';
import xtermStyles from '@xterm/xterm/css/xterm.css?url';

import 'virtual:uno.css';

export async function loader({ request }: LoaderFunctionArgs) {
  // Set random session ID cookie on first visit so session-based rate limiting
  // works even before the first /api/chat or /api/enhancer call.
  const existing = getSessionId(request);

  if (!existing) {
    const sessionId = generateSessionId();
    const cookieHeader = createSessionCookie(sessionId, request);

    return json({}, { headers: { 'Set-Cookie': cookieHeader } });
  }

  return json({});
}

export const links: LinksFunction = () => [
  {
    rel: 'icon',
    href: '/favicon.svg',
    type: 'image/svg+xml',
  },
  { rel: 'stylesheet', href: reactToastifyStyles },
  { rel: 'stylesheet', href: tailwindReset },
  { rel: 'stylesheet', href: globalStyles },
  { rel: 'stylesheet', href: xtermStyles },

];

const inlineThemeCode = stripIndents`
  setTutorialKitTheme();

  function setTutorialKitTheme() {
    let theme = localStorage.getItem('bolt_theme');

    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.querySelector('html')?.setAttribute('data-theme', theme);
  }
`;

export const Head = createHead(() => (
  <>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <Meta />
    <Links />
    <script dangerouslySetInnerHTML={{ __html: inlineThemeCode }} />
  </>
));

export function Layout({ children }: { children: React.ReactNode }) {
  const theme = useStore(themeStore);

  useEffect(() => {
    document.querySelector('html')?.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <>
      {children}
      <ScrollRestoration />
      <Scripts />
    </>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const timestamp = new Date().toISOString();

  let message: string;
  let status: number | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    message = `${error.status} ${error.statusText || ''}`.trim();
    if (!message && error.data) {
      message = typeof error.data === 'string' ? error.data : JSON.stringify(error.data);
    }
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }

  // Log with enough context for debugging (route, message, status, timestamp)
  console.error('[ErrorBoundary:root]', {
    route: 'root',
    message,
    status,
    timestamp,
    error,
  });

  const handleRetry = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1 p-6 text-bolt-elements-textPrimary">
      <div className="max-w-md w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 shadow-lg text-center">
        <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-sm text-bolt-elements-textSecondary mb-2">
          The application encountered an unexpected error. You can try again or report the issue if it persists.
        </p>
        {message && (
          <pre className="text-xs text-left bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded p-3 mb-4 overflow-auto whitespace-pre-wrap break-words">
            {status ? `Error ${status}: ` : ''}
            {message}
          </pre>
        )}
        <p className="text-xs text-bolt-elements-textTertiary mb-4">{timestamp}</p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={handleRetry}
            className="inline-flex items-center justify-center rounded-md bg-bolt-elements-button-primary-background px-4 py-2 text-sm font-medium text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover transition-colors"
          >
            Try again
          </button>
          <a
            href="https://github.com/stackblitz/bolt.new/issues"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-md border border-bolt-elements-borderColor px-4 py-2 text-sm font-medium hover:bg-bolt-elements-background-depth-3 transition-colors"
          >
            Report issue
          </a>
        </div>
      </div>
    </div>
  );
}
