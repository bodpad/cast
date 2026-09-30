/**
 * Hosts of identity providers and SSO hops. They are visited while logging in but are not where
 * the person works, so cast does not suggest remembering them as sites.
 */
const SIGN_IN_HOSTS = [
    /^login\.microsoftonline\.com$/,
    /^device\.login\.microsoftonline\.com$/,
    /^login\.microsoft\.com$/,
    /^login\.live\.com$/,
    /^login\.windows\.net$/,
    /^autologon\.microsoftazuread-sso\.com$/,
    /^account\.activedirectory\.windowsazure\.com$/,
    /^mysignins\.microsoft\.com$/,
    /^accounts\.google\.com$/,
    /^appleid\.apple\.com$/,
    /(^|\.)okta(preview|-emea)?\.com$/,
    /(^|\.)auth0\.com$/,
    /(^|\.)onelogin\.com$/,
    /(^|\.)duosecurity\.com$/,
    /(^|\.)pingidentity\.com$/,
    /(^|\.)pingone\.(com|eu|asia)$/,
    /(^|\.)jumpcloud\.com$/,
    /^(sso|login|signin|auth|adfs|idp|fs|sts)\./,
];
export function isSignInHost(host) {
    const h = host.toLowerCase().replace(/:\d+$/, '');
    return SIGN_IN_HOSTS.some(re => re.test(h));
}
/** `landed`: hosts with at least one visit that ended a redirect chain (a page actually shown). */
export function classifyHosts(hosts, landed) {
    const sites = [];
    const signIn = [];
    for (const h of hosts)
        (landed.has(h) && !isSignInHost(h) ? sites : signIn).push(h);
    return { sites, signIn };
}
