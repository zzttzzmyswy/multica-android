import { NextRequest, NextResponse } from 'next/server';

/**
 * Desktop Callback API
 *
 * Server-side redirect to deep link (multica://auth?...)
 * This is more reliable than client-side window.location.href
 *
 * Reference: Cap/apps/web/app/api/desktop/[...route]/session.ts
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const sid = searchParams.get('sid');
  const user = searchParams.get('user');
  const port = searchParams.get('port');
  const platform = searchParams.get('platform') || 'desktop';

  // Validate required params
  if (!sid || !user) {
    return NextResponse.json(
      { error: 'Missing sid or user parameter' },
      { status: 400 }
    );
  }

  // Build callback URL
  const params = new URLSearchParams({ sid, user });

  if (platform === 'web' && port) {
    // Dev mode: redirect to local server
    const callbackUrl = `http://127.0.0.1:${port}/callback?${params}`;
    return NextResponse.redirect(callbackUrl);
  } else {
    // Production mode: redirect to deep link
    const deepLinkUrl = `multica://auth?${params}`;
    return NextResponse.redirect(deepLinkUrl);
  }
}
