import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { isRouteErrorResponse, useRouteError } from '@remix-run/react';
import { default as IndexRoute } from './_index';

export async function loader(args: LoaderFunctionArgs) {
  return json({ id: args.params.id });
}

export default IndexRoute;

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

  console.error('[ErrorBoundary:chat.$id]', {
    route: 'chat.$id',
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
    <div className="flex flex-col h-full w-full items-center justify-center p-6 bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary">
      <div className="max-w-md w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 shadow-lg text-center">
        <h2 className="text-lg font-semibold mb-2">Chat failed to load</h2>
        <p className="text-sm text-bolt-elements-textSecondary mb-2">
          Something went wrong while loading this chat. Try again or report the issue.
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
