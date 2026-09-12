// gitremote.js - parse a git remote URL into {host, owner, repo}.
// Accepts HTTPS, SSH (scp-like + ssh://) and owner/repo shorthand so the
// Settings form can be filled from the remote you already use locally.
// Pure functions, testable in Node and the browser.

const GitRemote = (() => {
  function cleanRepo(s) {
    return String(s || "").trim().replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
  }

  // Returns {host, owner, repo} or null when nothing repo-like is found.
  function parseGitRemote(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;

    // owner/repo shorthand (GitHub usernames have no dots, so a dotted first
    // segment like github.com/owner falls through to URL parsing instead)
    let short = raw.match(/^([A-Za-z0-9-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (short) {
      return { host: "github.com", owner: short[1], repo: short[2] };
    }

    // scp-like SSH: git@github.com:owner/repo(.git)
    let m = raw.match(/^(?:[\w.-]+@)?([\w.-]+):(.+)$/);
    if (m && !raw.includes("://")) {
      const parts = cleanRepo(m[2]).split("/").filter(Boolean);
      if (parts.length >= 2) {
        return { host: m[1].toLowerCase(), owner: parts[0], repo: parts[1] };
      }
      return null;
    }

    // ssh:// / https:// URLs (also tolerates missing scheme on github.com/owner/repo)
    let url = raw;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = "https://" + url;
    try {
      const u = new URL(url);
      const parts = cleanRepo(u.pathname).split("/").filter(Boolean);
      if (parts.length >= 2) {
        return { host: u.hostname.toLowerCase(), owner: parts[0], repo: parts[1] };
      }
      return null;
    } catch { return null; }
  }

  function isGitHubHost(host) {
    return host === "github.com" || host === "www.github.com";
  }

  function canonicalHttps(host, owner, repo) {
    return `https://${host}/${owner}/${repo}.git`;
  }

  return { parseGitRemote, isGitHubHost, canonicalHttps };
})();

// Node export for tests (browser ignores)
if (typeof module !== "undefined" && module.exports) {
  module.exports = GitRemote;
}
