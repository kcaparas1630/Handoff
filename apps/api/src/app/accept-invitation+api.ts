// Server-rendered invitation landing page. Clerk hosts the sign-in and acceptance flow and then
// redirects here, so this page only tells the invitee how to finish in the app. It is a server
// route rather than a static screen because the app links come from server-only configuration
// (APP_LINK_PARENTS, APP_LINK_DAYCARE) that must never reach a client bundle.
import { getHandler, getServerEnv } from "../server-runtime";

/** Clerk's redirect states. Anything else falls back to the neutral copy. */
const statusHeadlines: Record<string, string> = {
  sign_up: "Almost there",
  sign_in: "Almost there",
  complete: "You have joined",
};

const statusMessages: Record<string, string> = {
  sign_up:
    "Finish creating your account in the Handoff app using the email this invitation was sent to.",
  sign_in: "Open the Handoff app and sign in with the email this invitation was sent to.",
  complete: "Open the Handoff app and sign in with the email this invitation was sent to.",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPage({
  headline,
  message,
  parentsLink,
  daycareLink,
}: {
  headline: string;
  message: string;
  parentsLink: string;
  daycareLink: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Finish joining Handoff</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:2rem;line-height:1.5;color:#1b1b1f}main{max-width:32rem;margin:0 auto}a{display:block;margin:.75rem 0;padding:.75rem 1rem;border:1px solid #1b1b1f;border-radius:.5rem;text-decoration:none;color:inherit}</style>
</head>
<body>
<main>
<h1>${escapeHtml(headline)}</h1>
<p>${escapeHtml(message)}</p>
<p>Open the Handoff app to finish joining. Your access appears once you are signed in with the same email address.</p>
<a href="${escapeHtml(parentsLink)}">Open Handoff for parents</a>
<a href="${escapeHtml(daycareLink)}">Open Handoff for daycare</a>
<p>If the app is not installed yet, install it first and then sign in with that email address.</p>
</main>
</body>
</html>
`;
}

export function GET(request: Request): Promise<Response> {
  return getHandler().handle(
    request,
    { auth: "none", operation: "invitations.landing" },
    (context) => {
      const env = getServerEnv();
      // The ticket and status only select stored copy; neither value is written into the page.
      const status = new URL(context.request.url).searchParams.get("__clerk_status") ?? "";
      const html = renderPage({
        headline: statusHeadlines[status] ?? "Almost there",
        message:
          statusMessages[status] ??
          "Open the Handoff app and sign in with the email this invitation was sent to.",
        parentsLink: env.appLinkParents,
        daycareLink: env.appLinkDaycare,
      });
      return Promise.resolve(
        new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            // No scripts at all, so a copied invitation URL cannot execute anything.
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
          },
        }),
      );
    },
  );
}
